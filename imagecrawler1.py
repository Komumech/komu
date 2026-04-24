import os
import io
import time
import requests
import trafilatura
import urllib3
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET
from PIL import Image
import re
import random
import threading
from datetime import datetime
from queue import Queue, Empty
from tqdm import tqdm
from urllib.parse import urlparse, urljoin
from ddgs import DDGS 
from openai import OpenAI 

# --- VECTOR ENGINE ---
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer

# --- LOAD SECURE KEYS ---
try:
    import config
    PINECONE_KEY = config.PINECONE_KEY
    INDEX_NAME = config.INDEX_NAME
    NAMESPACE = config.NAMESPACE
    AI_API_KEY = getattr(config, 'AI_API_KEY', "your_key_here")
    AI_BASE_URL = getattr(config, 'AI_BASE_URL', "https://api.openai.com/v1") 
except (ImportError, AttributeError):
    print("❌ ERROR: Ensure config.py exists with keys."); exit()

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
session = requests.Session()

# --- GLOBAL CONFIG ---
LOG_FILE = "indexed_images.txt"
MAX_THREADS = 8 
DOMAIN_LIMIT = 50  # 🚀 Higher limit for dedicated image harvesting
sitemaps_processed = set()
sitemap_lock = threading.Lock()
BLACKLIST = [
  "wikipedia.org", "wikimedia.org", "mediawiki.org", "wikidata.org",
  "facebook.com", "twitter.com", "instagram.com", "tiktok.com",
  "quora.com", "reddit.com", "amazon.com", "ebay.com", "play.google.com"
]

# --- DICTIONARY & PHRASE SEEDS FOR AUTONOMY ---
POPULAR_PREFIXES = ["latest", "photography", "gallery of", "best images of", "visual guide to", "high res", "infographic"]
DICTIONARY_NOUNS = ["technology", "architecture", "nature", "space", "design", "engineering", "travel", "art"]

def generate_random_seed_query():
    prefix = random.choice(POPULAR_PREFIXES)
    noun = random.choice(DICTIONARY_NOUNS)
    return f"{prefix} {noun}"

def get_autonomous_seeds(count=5):
    final_seeds = []
    for _ in range(count):
        spark = generate_random_seed_query()
        suggestions = get_google_suggestions(spark)
        final_seeds.append(random.choice(suggestions) if suggestions else spark)
    return final_seeds

# --- INIT ENGINES ---
print(f"🖼️  KOMU IMAGE SCOUT v1.0 - DEDICATED VISUAL INDEXER")
model = SentenceTransformer('all-mpnet-base-v2') # Standardized 768-dim Semantic Brain
pc = Pinecone(api_key=PINECONE_KEY)
pc_index = pc.Index(INDEX_NAME)
ai_client = OpenAI(api_key=AI_API_KEY, base_url=AI_BASE_URL)

url_queue = Queue()
visited = set()         
runtime_indexed = [] 
domain_image_counts = {}
active_workers = 0 
data_lock = threading.Lock()
pbar = None 

def get_google_suggestions(query):
    try:
        url = f"http://suggestqueries.google.com/complete/search?client=chrome&q={query}"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            return [s for s in resp.json()[1] if len(s) > 3]
        return []
    except: return []

def generate_ai_topics(existing_topics, recent_finds):
    try:
        prompt = f"You are an autonomous web scout. Recent: {recent_finds[:5]}. Generate 5 NEW, hyper-specific image search queries for 2026. Return ONLY a list of strings."
        response = ai_client.chat.completions.create(
            model="gpt-3.5-turbo", 
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200
        )
        new_queries = response.choices[0].message.content.strip().split('\n')
        return [re.sub(r'^\d+\.\s*|-\s*', '', q).strip() for q in new_queries if len(q) > 5]
    except:
        return [f"high resolution {random.choice(DICTIONARY_NOUNS)}" for _ in range(3)]

def is_high_quality(url):
    parsed = urlparse(url.lower())
    domain = parsed.netloc
    if any(bad in domain for bad in BLACKLIST): return False
    if re.search(r'\.(zip|exe|mp4|pdf|iso)$', url.lower()): return False
    return True

def process_sitemap(sitemap_url, domain, t_name):
    with sitemap_lock:
        if sitemap_url in sitemaps_processed: return
        sitemaps_processed.add(sitemap_url)
    try:
        resp = session.get(sitemap_url, timeout=10, verify=False)
        if resp.status_code != 200: return
        root = ET.fromstring(resp.content)
        ns = {'ns': root.tag.split('}')[0].strip('{')} if '}' in root.tag else {}
        locs = root.findall('.//ns:loc', ns) if ns else root.findall('.//loc')
        count = 0
        for loc in locs:
            url = loc.text.strip()
            with data_lock:
                if url not in visited:
                    url_queue.put(url); count += 1
        if count > 0: tqdm.write(f"🗺️ [{t_name}] Sitemap Extracted: {count} URLs from {sitemap_url}")
    except: pass

def discover_sitemaps(root_url, domain, t_name):
    try:
        robots_url = urljoin(root_url, "/robots.txt")
        resp = session.get(robots_url, timeout=5, verify=False)
        if resp.status_code == 200:
            for sm in re.findall(r'^Sitemap:\s*(.*)', resp.text, re.M | re.I):
                process_sitemap(sm.strip(), domain, t_name)
    except: pass
    for loc in ["/sitemap.xml", "/sitemap_index.xml"]:
        process_sitemap(urljoin(root_url, loc), domain, t_name)

def index_to_pinecone(url, alt_text, domain, t_name):
    try:
        # Alt text limited to 400 chars to prevent metadata bloat
        clean_alt = alt_text[:400]
        vector = model.encode(clean_alt).tolist()
        v_id = re.sub(r'\W+', '_', url)[:512]
        
        metadata = {
            "url": url, 
            "domain": domain, 
            "text": clean_alt,
            "image": url,
            "title": clean_alt,
            "is_image": True
        }

        pc_index.upsert(
            vectors=[{"id": v_id, "values": vector, "metadata": metadata}],
            namespace=NAMESPACE
        )
        return True
    except Exception as e:
        tqdm.write(f"❌ [{t_name}] Pinecone Error: {str(e)[:100]}")
        return False

def crawler_worker():
    global active_workers
    t_name = threading.current_thread().name
    while True:
        try:
            url = url_queue.get(timeout=30) 
        except Empty: break

        with data_lock: active_workers += 1
        clean_url = url.lower().strip().rstrip('/')
        parsed_current = urlparse(clean_url)
        domain = parsed_current.netloc

        with data_lock:
            if clean_url in visited or not is_high_quality(clean_url):
                active_workers -= 1
                url_queue.task_done()
                continue
            visited.add(clean_url)

        if parsed_current.path not in ["", "/"]:
            root_url = f"{parsed_current.scheme}://{domain}"
            with data_lock:
                if root_url not in visited: url_queue.put(root_url)

        try:
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
            resp = session.get(url, headers=headers, timeout=12, verify=False)

            if resp.status_code == 200:
                # --- IMAGE HARVESTING MODE ---
                try:
                    soup = BeautifulSoup(resp.text, 'html.parser')
                    imgs_found = 0
                    for img in soup.find_all('img', alt=True):
                        alt_text = img.get('alt', '').strip()
                        # REQUIRE: Min 15 chars for categorization quality
                        if len(alt_text) > 15:
                            src = img.get('src', '')
                            if not src: continue
                            img_url = urljoin(url, src).split('?')[0].rstrip('/')
                            
                            if any(img_url.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.webp']):
                                if not any(bad in img_url for bad in BLACKLIST):
                                    with data_lock:
                                        needs_indexing = domain_image_counts.get(domain, 0) < DOMAIN_LIMIT and img_url not in visited
                                    
                                    if needs_indexing:
                                        if index_to_pinecone(img_url, alt_text, domain, t_name):
                                            with data_lock:
                                                visited.add(img_url)
                                                domain_image_counts[domain] = domain_image_counts.get(domain, 0) + 1
                                                imgs_found += 1
                    if imgs_found > 0:
                        tqdm.write(f"🖼️ [{t_name}] Harvested {imgs_found} images from {domain}")
                        with data_lock: runtime_indexed.append(clean_url); pbar.update(1)
                except: pass

                if parsed_current.path in ["", "/"]:
                    discover_sitemaps(url, domain, t_name)

                # --- DEEP-CRAWL DISCOVERY ---
                raw_links = re.findall(r'href=["\'](https?://[^\s"\']+|/[^\s"\']+)["\']', resp.text)
                for l in raw_links:
                    full_link = urljoin(url, l).split('#')[0].rstrip('/')
                    l_domain = urlparse(full_link).netloc
                    with data_lock:
                        if l_domain and full_link not in visited:
                            if l_domain == domain:
                                url_queue.put(full_link)
                            else:
                                # Limit branching to prevent queue explosion
                                if len(visited) % 50 == 0: url_queue.put(full_link)
        except: pass
        finally:
            with data_lock: active_workers -= 1
            url_queue.task_done()

def run_komu_autonomous():
    global pbar, runtime_indexed
    
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r") as f:
            for line in f:
                if "] " in line:
                    try: visited.add(line.split("] ")[1].strip().lower())
                    except: pass

    # Seeds for Image Discovery
    current_topics = [
"https://www.figma.com/",
"https://huggingface.co/",
"https://perplexity.ai/",
"https://www.anthropic.com/",
"https://m3.material.io/",
"https://fonts.google.com/",
"https://color.adobe.com/",
"https://vercel.com/",
"https://www.netlify.com/",
"https://firebase.google.com/",
"https://supabase.com/",
"https://railway.app/",
"https://postman.com/",
"https://carbon.now.sh/",
"https://www.producthunt.com/",
"https://www.indiehackers.com/",
"https://www.ycombinator.com/",
"https://techcrunch.com/",
"https://www.theverge.com/",
"https://wired.com/",
"https://www.technologyreview.com/",
"https://arxiv.org/",
"https://www.sciencedaily.com/",
"https://www.eurekalert.org/",
"https://www.space.com/",
"https://www.glassdoor.com/",
"https://wellfound.com/",
"https://www.w3schools.com/",
"https://www.geeksforgeeks.org/",
"https://www.hackerrank.com/",
"https://www.sololearn.com/",
"https://www.pexels.com/",
"https://unsplash.com/",
"https://pixabay.com/",
"https://www.obsidian.md/",
"https://proton.me/",
"https://haveibeenpwned.com/",
"https://brave.com/",
"https://www.theatlantic.com/",
"https://www.newyorker.com/",
"https://www.ft.com/",
"https://www.motleyfool.com/",
"https://seekingalpha.com/",
"https://www.thespruceeats.com/",
"https://www.charitynavigator.org/",
"https://www.givewell.org/",
"https://www.un.org/",
"https://www.worldbank.org/",
"https://www.loc.gov/",
"https://www.britannica.com/",
"https://www.howstuffworks.com/",
"https://www.snopes.com/",
"https://www.politifact.com/",
"https://www.factcheck.org/",
"https://www.urbandictionary.com/",
"https://knowyourmeme.com/",
"https://www.theonion.com/",
"https://www.clickhole.com/",
"https://www.framer.com/",
"https://webflow.com/",
"https://www.awwwards.com/",
"https://www.siteinspire.com/",
"https://www.smashingmagazine.com/",
"https://alistapart.com/",
"https://css-tricks.com/",
"https://www.creativebloq.com/",
"https://www.99designs.com/",
"https://www.fiverr.com/",
"https://www.upwork.com/",
"https://www.toptal.com/",
"https://www.guru.com/",
"https://www.freelancer.com/",
"https://www.adobe.com/",
"https://www.autodesk.com/",
"https://www.blender.org/",
"https://unity.com/",
"https://www.unrealengine.com/",
"https://store.steampowered.com/",
"https://www.epicgames.com/",
"https://www.gog.com/",
"https://www.humblebundle.com/",
"https://pitchfork.com/",
"https://www.rollingstone.com/",
"https://www.vogue.com/",
"https://www.gq.com/",
"https://www.fastcompany.com/",
"https://hbr.org/",
"https://www.inc.com/",
"https://www.entrepreneur.com/",
"https://www.thebalance.com/",
"https://www.kiplinger.com/",
"https://www.morningstar.com/",
"https://www.tradingview.com/",
"https://www.coinmarketcap.com/",
"https://www.coindesk.com/",
"https://www.realtor.com/",
"https://www.apartments.com/",
"https://www.ziprecruiter.com/",
"https://www.simplyhired.com/",
"https://www.careerbuilder.com/",
"https://www.dice.com/",
"https://www.theladders.com/",
"https://www.crunchbase.com/",
"https://www.owler.com/",
"https://www.builtwith.com/",
"https://www.similarweb.com/",
"https://www.semrush.com/",
"https://www.spyfu.com/",
"https://www.ubersuggest.com/",
"https://www.moz.com/",
"https://www.ahrefs.com/",
"https://www.buffer.com/",
"https://www.hootsuite.com/",
"https://www.sproutsocial.com/",
"https://www.mailchimp.com/",
"https://www.constantcontact.com/",
"https://www.sendgrid.com/",
"https://www.twilio.com/",
"https://www.stripe.com/",
"https://www.paypal.com/",
"https://www.square.com/",
"https://www.shopify.com/",
"https://www.magento.com/",
"https://www.bigcommerce.com/",
"https://www.woocommerce.com/",
"https://www.wix.com/",
"https://www.squarespace.com/",
"https://www.weebly.com/",
"https://www.jimdo.com/",
"https://www.godaddy.com/",
"https://www.bluehost.com/",
"https://www.siteground.com/",
"https://www.dreamhost.com/",
"https://www.hostgator.com/",
"https://www.a2hosting.com/",
"https://www.inmotionhosting.com/",
"https://www.wpengine.com/",
"https://www.kinsta.com/",
"https://www.cloudflare.com/",
"https://www.akamai.com/",
"https://www.fastly.com/",
"https://www.linode.com/",
"https://www.vultr.com/",
"https://www.mongodb.com/",
"https://www.oracle.com/",
"https://www.sap.com/",
"https://www.salesforce.com/",
"https://www.hubspot.com/",
"https://www.zendesk.com/",
"https://www.intercom.com/",
"https://www.drift.com/",
"https://www.g2.com/",
"https://www.capterra.com/",
"https://www.trustpilot.com/",
"https://www.yelp.com/",
"https://www.vrbo.com/",
"https://www.hotels.com/",
"https://www.priceline.com/",
"https://www.orbitz.com/",
"https://www.travelocity.com/",
"https://www.agoda.com/",
"https://www.trivago.com/",
"https://www.hostelworld.com/",
"https://www.couchsurfing.com/",
"https://www.viamichelin.com/",
"https://www.rome2rio.com/",
"https://www.google.com/flights",
"https://www.uber.com/",
"https://www.lyft.com/",
"https://www.blablacar.com/",
"https://www.turo.com/",
"https://www.getaround.com/",
"https://www.zipcar.com/",
"https://www.enterprise.com/",
"https://www.hertz.com/",
"https://www.avis.com/",
"https://www.budget.com/",
"https://www.sixt.com/",
"https://www.thrifty.com/",
"https://www.dollar.com/",
"https://www.nationalcar.com/",
"https://www.alamo.com/",
"https://www.europcar.com/",
"https://www.momondo.com/",
"https://www.cheapflights.com/",
"https://www.kiwi.com/",
"https://www.bing.com/maps",
"https://www.openstreetmap.org/",
"https://www.waze.com/",
"https://www.mapquest.com/",
"https://www.citymapper.com/",
"https://www.transitapp.com/",
"https://www.moovitapp.com/",
"https://www.strava.com/",
"https://www.komoot.com/",
"https://www.alltrails.com/",
"https://www.trailforks.com/",
"https://www.mtbproject.com/",
"https://www.hikingproject.com/",
"https://www.powderproject.com/",
"https://www.mountainproject.com/",
"https://www.adventureprojects.net/",
"https://www.1password.com/",
"https://www.lastpass.com/",
"https://www.dashlane.com/",
"https://www.bitwarden.com/",
"https://www.speedtest.net/",
"https://www.downdetector.com/",
"https://www.isitdownrightnow.com/",
"https://www.waybackmachine.org/",
"https://www.tineye.com/",
"https://www.virustotal.com/",
"https://www.malwarebytes.com/",
"https://www.avast.com/",
"https://www.mcafee.com/",
"https://www.norton.com/",
"https://www.kaspersky.com/",
"https://www.bitdefender.com/",
"https://www.eset.com/",
"https://www.sophos.com/",
"https://www.fireeye.com/",
"https://www.crowdstrike.com/",
"https://www.splunk.com/",
"https://www.datadog.com/",
"https://www.newrelic.com/",
"https://www.appdynamics.com/",
"https://www.dynatrace.com/",
"https://www.elastic.co/",
"https://www.loggly.com/",
"https://www.sumologic.com/",
"https://www.graylog.org/",
"https://www.grafana.com/",
"https://www.prometheus.io/",
"https://www.sentry.io/",
"https://www.rollbar.com/",
"https://www.airbrake.io/",
"https://www.bugsnag.com/",
"https://www.raygun.com/",
"https://www.honeybadger.io/",
"https://www.glitch.com/",
"https://www.replit.com/",
"https://www.codesandbox.io/",
"https://www.stackblitz.com/",
"https://www.jsfiddle.net/",
"[suspicious link removed]",
"https://www.scrimba.com/",
"https://www.frontendmentor.io/",
"https://www.hashnode.com/",
"https://www.sitepoint.com/",
"https://www.creativebloq.com/",
"https://www.99designs.com/",
"https://www.fiverr.com/",
"https://www.upwork.com/",
"https://www.toptal.com/",
"https://www.guru.com/",
"https://www.freelancer.com/",
"https://www.behance.net/",
"https://dribbble.com/",
"https://www.blender.org/",
"https://unity.com/",
"https://www.unrealengine.com/",
"https://store.steampowered.com/",
"https://www.epicgames.com/",
"https://www.gog.com/",
"https://www.humblebundle.com/",
"https://pitchfork.com/",
"https://www.rollingstone.com/",
"https://www.vogue.com/",
"https://www.gq.com/",
"https://www.fastcompany.com/",
"https://hbr.org/",
"https://www.inc.com/",
"https://www.entrepreneur.com/",
"https://www.thebalance.com/",
"https://www.kiplinger.com/",
"https://www.morningstar.com/",
"https://www.tradingview.com/",
"https://www.coinmarketcap.com/",
"https://www.coindesk.com/",
"https://www.realtor.com/",
"https://www.apartments.com/",
"https://www.ziprecruiter.com/",
"https://www.simplyhired.com/",
"https://www.careerbuilder.com/",
"https://www.dice.com/",
"https://www.theladders.com/",
"https://www.crunchbase.com/",
"https://www.owler.com/",
"https://www.builtwith.com/",
"https://www.similarweb.com/",
"https://www.semrush.com/",
"https://www.spyfu.com/",
"https://www.ubersuggest.com/",
"https://www.moz.com/",
"https://www.ahrefs.com/",
"https://www.buffer.com/",
"https://www.hootsuite.com/",
"https://www.sproutsocial.com/",
"https://www.mailchimp.com/",
"https://www.constantcontact.com/",
"https://www.sendgrid.com/",
"https://www.twilio.com/",
"https://www.stripe.com/",
"https://www.paypal.com/",
"https://www.square.com/",
"https://www.shopify.com/",
"https://www.magento.com/",
"https://www.bigcommerce.com/",
"https://www.woocommerce.com/",
"https://www.wix.com/",
"https://www.squarespace.com/",
"https://www.weebly.com/",
"https://www.jimdo.com/",
"https://www.godaddy.com/",
"https://www.bluehost.com/",
"https://www.siteground.com/",
"https://www.dreamhost.com/",
"https://www.hostgator.com/",
"https://www.a2hosting.com/",
"https://www.inmotionhosting.com/",
"https://www.wpengine.com/",
"https://www.kinsta.com/",
"https://www.cloudflare.com/",
"https://www.akamai.com/",
"https://www.fastly.com/",
"https://www.linode.com/",
"https://www.vultr.com/",
"https://www.mongodb.com/",
"https://www.oracle.com/",
"https://www.sap.com/",
"https://www.salesforce.com/",
"https://www.hubspot.com/",
"https://www.zendesk.com/",
"https://www.intercom.com/",
"https://www.drift.com/",
"https://www.g2.com/",
"https://www.capterra.com/",
"https://www.trustpilot.com/",
"https://www.yelp.com/",
"https://www.vrbo.com/",
"https://www.hotels.com/",
"https://www.priceline.com/",
"https://www.orbitz.com/",
"https://www.travelocity.com/",
"https://www.agoda.com/",
"https://www.trivago.com/",
"https://www.hostelworld.com/",
"https://www.couchsurfing.com/",
"https://www.viamichelin.com/",
"https://www.rome2rio.com/",
"https://www.google.com/flights",
"https://www.uber.com/",
"https://www.lyft.com/",
"https://www.blablacar.com/",
"https://www.turo.com/",
"https://www.getaround.com/",
"https://www.zipcar.com/",
"https://www.enterprise.com/",
"https://www.hertz.com/",
"https://www.avis.com/",
"https://www.budget.com/",
"https://www.sixt.com/",
"https://www.thrifty.com/",
"https://www.dollar.com/",
"https://www.nationalcar.com/",
"https://www.alamo.com/",
"https://www.europcar.com/",
"https://www.momondo.com/",
"https://www.cheapflights.com/",
"https://www.kiwi.com/",
"https://www.bing.com/maps",
"https://www.openstreetmap.org/",
"https://www.waze.com/",
"https://www.mapquest.com/",
"https://www.citymapper.com/",
"https://www.transitapp.com/",
"https://www.moovitapp.com/",
"https://www.strava.com/",
"https://www.komoot.com/",
"https://www.alltrails.com/",
"https://www.trailforks.com/",
"https://www.mtbproject.com/",
"https://www.hikingproject.com/",
"https://www.powderproject.com/",
"https://www.mountainproject.com/",
"https://www.adventureprojects.net/",
 "https://github.com/",
"https://stackoverflow.com/",
"https://www.codecademy.com/",
"https://news.ycombinator.com/",
"https://leetcode.com/",
"https://codepen.io/",
"https://www.freecodecamp.org/",
"https://developer.mozilla.org/",
"https://www.khanacademy.org/",
"https://www.coursera.org/",
"https://www.edx.org/",
"https://www.jstor.org/",
"https://quizlet.com/",
"https://www.udemy.com/",
"https://scholar.google.com/",
"https://www.ted.com/",
"https://www.mayoclinic.org/",
"https://www.webmd.com/",
"https://www.myfitnesspal.com/",
"https://pubmed.ncbi.nlm.nih.gov/",
"https://www.healthline.com/",
"https://www.nih.gov/",
"https://www.who.int/",
"https://www.reuters.com/",
"https://apnews.com/",
"https://www.bbc.com/news",
"https://www.npr.org/",
"https://www.wsj.com/",
"https://www.theguardian.com/",
"https://www.aljazeera.com/",
"https://www.investopedia.com/",
"https://www.bloomberg.com/",
"https://www.nerdwallet.com/",
"https://finance.yahoo.com/",
"https://www.forbes.com/",
"https://www.cnbc.com/",
"https://www.tripadvisor.com/",
"https://www.booking.com/",
"https://www.airbnb.com/",
"https://www.skyscanner.net/",
"https://www.expedia.com/",
"https://www.kayak.com/",
"https://www.lonelyplanet.com/",
"https://www.ifixit.com/",
"https://www.instructables.com/",
"https://www.familyhandyman.com/",
"https://www.houzz.com/",
"https://www.thespruce.com/",
"https://www.allrecipes.com/",
"https://www.seriouseats.com/",
"https://www.foodnetwork.com/",
"https://tasty.co/",
"https://www.epicurious.com/",
"https://www.nasa.gov/",
"https://www.nature.com/",
"https://www.scientificamerican.com/",
"https://www.nationalgeographic.com/",
"https://www.smithsonianmag.com/",
"https://www.behance.net/",
"https://dribbble.com/",
"https://www.deviantart.com/",
"https://www.artstation.com/",
"https://trello.com/",
"https://slack.com/",
"https://notion.so/",
"https://www.wolframalpha.com/",
"https://asana.com/",
"https://zoom.us/",
"https://www.wikipedia.org/",
"https://archive.org/",
"https://www.gutenberg.org/",
"https://openlibrary.org/",
"https://www.merriam-webster.com/",
"https://www.dictionary.com/",
"https://www.imdb.com/",
"https://www.rottentomatoes.com/",
"https://www.goodreads.com/",
"https://www.ign.com/",
"https://www.gamespot.com/"
    ] + get_autonomous_seeds(5)

    try:
        with DDGS() as ddgs:
            for q in current_topics:
                if q.startswith("http"): url_queue.put(q)
                else:
                    results = ddgs.text(q, max_results=5)
                    for r in results: url_queue.put(r['href'])
                    time.sleep(1)
    except: pass

    print(f"🚀 KOMU IMAGE SCOUT READY. Parallel harvesting active.")
    pbar = tqdm(total=None, desc="Images Harvested", unit="site", colour="green")
    
    for i in range(MAX_THREADS):
        threading.Thread(target=crawler_worker, name=f"Scout-{i+1}", daemon=True).start()

    try:
        while True:
            time.sleep(15)
            if url_queue.qsize() < 10:
                recent_domains = [urlparse(u).netloc for u in list(visited)[-5:]]
                ai_topics = generate_ai_topics(current_topics[-3:], recent_domains)
                random_injects = get_autonomous_seeds(2)
                combined_new = list(set(ai_topics + random_injects))
                
                if combined_new:
                    tqdm.write(f"🌟 Evolution: Brainstorming {len(combined_new)} new visual paths")
                    try:
                        with DDGS() as ddgs:
                            for s in combined_new[:5]:
                                results = ddgs.text(s, max_results=5)
                                for r in results: url_queue.put(r['href'])
                                time.sleep(1.2)
                    except: pass

            if len(runtime_indexed) >= 5:
                with data_lock:
                    with open(LOG_FILE, "a") as f:
                        for url in runtime_indexed:
                            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {url}\n")
                    runtime_indexed = []
                    
            if len(visited) > 25000:
                with data_lock: visited.clear()

    except KeyboardInterrupt:
        print(f"\n🛑 Scout stopped manually. Progress saved.")
    finally:
        pbar.close()

if __name__ == "__main__":
    run_komu_autonomous()