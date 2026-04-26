import os
import io
import time
import requests
import trafilatura
import urllib3
from bs4 import BeautifulSoup
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
    print("❌ ERROR: Ensure config.py exists with PINECONE_KEY, INDEX_NAME, NAMESPACE, and AI_API_KEY."); exit()

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
session = requests.Session()

# --- GLOBAL CONFIG ---
LOG_FILE = "indexed_sites.txt"
MAX_THREADS = 8 
DOMAIN_LIMIT = 20  # 🚀 Limit to 20 pages per domain to ensure index diversity
BLACKLIST = [
  "wikipedia.org",
  "wikimedia.org",
  "mediawiki.org",
  "wikidata.org",
  "foundation.wikimedia.org",
  
 "en.wikipedia.org",
  "grokipedia.com",
  "wikiwand.com",
  "simple.wikipedia.org",
  "mirror.wikipedia.org",

 
  "creativecommons.org",
  "donate.wikimedia.org",
  "wikipedia.org",
  "wikimedia.org",
  "wikimediafoundation.org",
  "mediawiki.org",
  "wikibooks.org",
  "wikidata.org",
  "wikinews.org",
  "wikiquote.org",
  "wikisource.org",
  "wikiversity.org",
  "wikivoyage.org",
  "wiktionary.org",
  "wikispecies.org",
  "wikifunctions.org",

  "wikitech.wikimedia.org",
  "meta.wikimedia.org",
  "outreach.wikimedia.org",
  "incubator.wikimedia.org",
  "answers.com",
  "wikiwand.com",
  "everipedia.org",
  "infogalactic.com",
  "wikipediamirror.com",
  "avid.wiki",
  "play.google.com"
  ]

# --- DICTIONARY & PHRASE SEEDS FOR AUTONOMY ---
POPULAR_PREFIXES = [
    "how to", "best", "future of", "trends in", "guide to", "latest", 
    "review of", "why is", "top 10", "new", "advanced", "history of"
]

DICTIONARY_NOUNS = [
    "technology", "science", "coding", "medicine", "space", "finance", "cooking",
    "engineering", "philosophy", "history", "gaming", "sustainability", "art",
    "architecture", "psychology", "marketing", "biology", "physics", "automation",
    "cryptography", "ecology", "robotics", "agriculture", "astronomy", "sociology"
]

def generate_random_seed_query():
    """Generates a random query using dictionary words and popular patterns."""
    prefix = random.choice(POPULAR_PREFIXES)
    noun = random.choice(DICTIONARY_NOUNS)
    # 50% chance to add a year for 'freshness'
    year = " 2026" if random.random() > 0.5 else ""
    return f"{prefix} {noun}{year}"

def get_autonomous_seeds(count=5):
    """Generates real-world trending seeds starting from random dictionary words."""
    final_seeds = []
    for _ in range(count):
        spark = generate_random_seed_query()
        # Tap into Google to turn our random word into a popular phrase
        suggestions = get_google_suggestions(spark)
        if suggestions:
            final_seeds.append(random.choice(suggestions))
        else:
            final_seeds.append(spark)
    return final_seeds

SEARCH_TOPICS = [ 
"https://komunotes.vercel.app/",
"https://komumech.vercel.app/",
"https://komucalendar.vercel.app/",
"https://komuthemedashboard.vercel.app/",
"https://komu-t8i7.vercel.app/",
"Komumech",
"Gmail",
"Chatgpt",
"Claude",
"Copilot",
"Microsoft",
"Hillsong",
"Gospel songs lyrics",
"Songs lyrics",
"Gospel",
"Churches",
"Countries and their national anthem",
"Popular Nigerian organization",
"Well known world organization",
"Web design competition",
"Web design services",
"Hospitals in the world",
"Most rich families and companies",
"Nations and their president and rulers",
"Popular designers",
"Apps for projector",
"Online shopping apps",
"mr beast",
"Most popular YouTube channel",
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
]

# --- INIT ENGINES ---
print(f"🛰️  KOMU SCOUT v15.2 - DEEP-DIVE & AI ENABLED")
# Standardizing to MPNet for maximum text retrieval accuracy (768-dim)
model = SentenceTransformer('all-mpnet-base-v2')
print("✅ Model Loaded: all-mpnet-base-v2 (768 Dimensions)")
# Double check the dimension before starting the crawl
sample_encoding = model.encode("Verify 768")
print(f"📐 Verified Vector Size: {len(sample_encoding)}")

pc = Pinecone(api_key=PINECONE_KEY)
pc_index = pc.Index(INDEX_NAME)

ai_client = OpenAI(api_key=AI_API_KEY, base_url=AI_BASE_URL)

url_queue = Queue()
visited = set()         
runtime_indexed = [] 
domain_counts = {}  
domain_image_counts = {}
active_workers = 0 
data_lock = threading.Lock()
pbar = None 

# --- GOOGLE SUGGESTIONS ENGINE ---
def get_google_suggestions(query):
    """Taps into live Google Search trends to find new indexing paths."""
    try:
        # Using the chrome client returns a clean JSON list of suggestions
        url = f"http://suggestqueries.google.com/complete/search?client=chrome&q={query}"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            suggestions = data[1] # The list of suggestion strings
            return [s for s in suggestions if len(s) > 3]
        return []
    except Exception as e:
        tqdm.write(f"⚠️ Google Suggest API failed: {e}")
        return []

# --- AI TOPIC GENERATOR ---
def generate_ai_topics(existing_topics, recent_finds):
    tqdm.write(f"🧠 [{datetime.now().strftime('%H:%M:%S')}] AI is brainstorming new research directions...")
    try:
        prompt = f"""
        You are an autonomous web scout. Seed topics: {existing_topics}
        Recently discovered: {recent_finds[:5]}
        Generate 5 NEW, hyper-specific search queries for 2026 focusing on general topics totaly general.
        Return ONLY a list of strings. No numbering.
        """
        response = ai_client.chat.completions.create(
            model="gpt-3.5-turbo", 
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200
        )
        new_queries = response.choices[0].message.content.strip().split('\n')
        return [re.sub(r'^\d+\.\s*|-\s*', '', q).strip() for q in new_queries if len(q) > 5]
    except Exception as e:
        tqdm.write(f"⚠️ AI Generation failed. Using shuffle.")
        return [f"advanced {random.choice(existing_topics)}" for _ in range(3)]

# --- CORE LOGIC ---
def is_high_quality(url):
    parsed = urlparse(url.lower())
    domain = parsed.netloc
    if any(bad in domain for bad in BLACKLIST): return False
    # Filter out non-content files
    if re.search(r'\.(zip|exe|mp4|pdf|png|jpg|jpeg|gif|css|js|json|xml|iso)$', url.lower()): return False
    return True

def get_seeds_robust(queries):
    seeds = []
    try:
        with DDGS() as ddgs:
            for q in queries:
                tqdm.write(f"🔍 [{datetime.now().strftime('%H:%M:%S')}] Seed Scouting: {q}")
                results = ddgs.text(q, max_results=5)
                for r in results: seeds.append(r['href'])
                time.sleep(1.2)
    except: pass
    return list(set(seeds))

def index_to_pinecone(url, content, domain, is_image=False, alt_text="", t_name="Unknown"):
    try:
        # Encoding content (truncating text to maintain performance)
        # For images, we vectorize the alt_text since MPNet is text-only
        input_data = (alt_text if is_image else str(content))[:1000]
        vector = model.encode(input_data).tolist()
        v_id = re.sub(r'\W+', '_', url)[:512]
        
        if is_image:
            metadata = {
                "url": url, 
                "domain": domain, 
                "text": alt_text[:800],
                "image": url,
                "title": alt_text[:200],
                "is_image": True
            }
        else:
            # content is text string
            metadata = {"url": url, "domain": domain, "text": str(content)[:800]}

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

        # --- 1. CLIMB UP FIX: Ensure we index the Homepage too ---
        if parsed_current.path not in ["", "/"]:
            root_url = f"{parsed_current.scheme}://{domain}"
            with data_lock:
                if root_url not in visited and domain_counts.get(domain, 0) < DOMAIN_LIMIT:
                    url_queue.put(root_url)

        try:
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
            resp = session.get(url, headers=headers, timeout=12, verify=False)

            if resp.status_code == 200:
                # --- IMAGE INDEXING: Max 3 per site, requiring Alt Text ---
                try:
                    soup = BeautifulSoup(resp.text, 'html.parser')
                    for img in soup.find_all('img', alt=True):
                        alt_text = img.get('alt', '').strip()
                        src = img.get('src', '')
                        # Only index if alt text is meaningful (avoid icons/spacers)
                        if len(alt_text) > 5 and src:
                            img_url = urljoin(url, src).split('?')[0].rstrip('/')
                            if any(img_url.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.webp']):
                                if not any(bad in img_url for bad in BLACKLIST):
                                    with data_lock:
                                        needs_indexing = domain_image_counts.get(domain, 0) < 3 and img_url not in visited
                                    
                                    if needs_indexing:
                                        try:
                                            # Using None for img_obj because MPNet only needs the alt_text
                                            if index_to_pinecone(img_url, None, domain, is_image=True, alt_text=alt_text, t_name=t_name):
                                                with data_lock:
                                                    visited.add(img_url)
                                                    domain_image_counts[domain] = domain_image_counts.get(domain, 0) + 1
                                                    tqdm.write(f"🖼️ [{t_name}] IMAGE INDEXED: {img_url}")
                                        except Exception: pass
                except Exception: pass

                text = trafilatura.extract(resp.text) or ""

                # --- 2. MAIN DOMAIN FIX: Lower thresholds & Metadata fallback ---
                is_root = parsed_current.path in ["", "/"]

                if is_root and len(text) < 300:
                    meta_match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']', resp.text, re.I)
                    desc = meta_match.group(1) if meta_match else ""
                    text = f"{desc}\n{text}".strip()

                # Lower barrier for Root Domains (100 chars) vs Articles (400 chars)
                if len(text) > (100 if is_root else 400):
                    if index_to_pinecone(url, text, domain, is_image=False, t_name=t_name):
                        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        tqdm.write(f"✅ [{now}] [{t_name}] INDEXED: {url}")

                        with data_lock:
                            runtime_indexed.append(clean_url)
                            domain_counts[domain] = domain_counts.get(domain, 0) + 1
                            pbar.update(1)

                # --- ROBUST DEEP-CRAWL ENGINE ---
                raw_links = re.findall(r'href=["\'](https?://[^\s"\']+|/[^\s"\']+)["\']', resp.text)

                new_sub_links = 0
                for l in raw_links:
                    full_link = urljoin(url, l).split('#')[0].rstrip('/')
                    l_parsed = urlparse(full_link)
                    l_domain = l_parsed.netloc

                    with data_lock:
                        if l_domain and full_link not in visited:
                            if l_domain == domain:
                                if domain_counts.get(l_domain, 0) < DOMAIN_LIMIT:
                                    url_queue.put(full_link)
                                    new_sub_links += 1
                            else:
                                if domain_counts.get(l_domain, 0) < 5: # Limit initial discovery
                                    url_queue.put(full_link)

                if new_sub_links > 0:
                    tqdm.write(f"📂 [{t_name}] Deep-Dive: Found {new_sub_links} secondary pages on {domain}")
        except Exception:
            pass
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

    # Start with a mix of static topics and purely random autonomous seeds
    current_topics = SEARCH_TOPICS.copy() + get_autonomous_seeds(10)
    seeds = get_seeds_robust(current_topics)
    for url in seeds: url_queue.put(url)

    print(f"🚀 KOMU SCOUT READY. Deep-Crawl & Sub-site indexing active.")
    pbar = tqdm(total=None, desc="Live Indexing", unit="site", colour="magenta")
    
    for i in range(MAX_THREADS):
        threading.Thread(target=crawler_worker, name=f"Agent-{i+1}", daemon=True).start()

    try:
        while True:
            time.sleep(15)
            
            # --- EVOLUTION ENGINE: AI + GOOGLE + DICTIONARY ---
            if url_queue.qsize() < 15:
                recent_domains = [urlparse(u).netloc for u in list(visited)[-5:]]
                
                # 1. Stay Relevant: Get Google Suggestions for a successful recent topic
                base_topic = random.choice(current_topics[-15:])
                trending_topics = get_google_suggestions(base_topic)
                
                # 2. Stay Smart: Augment with AI for hyper-specific 2026 niches
                ai_topics = generate_ai_topics(current_topics[-3:], recent_domains)
                
                # 3. Stay Random: Inject 2 purely random dictionary-based trending topics
                random_injects = get_autonomous_seeds(2)
                
                combined_new = list(set(trending_topics + ai_topics + random_injects))
                
                if combined_new:
                    tqdm.write(f"🌟 Evolution: Found {len(combined_new)} new paths (Google + AI + Dictionary)")
                    current_topics.extend(combined_new)
                    new_seeds = get_seeds_robust(combined_new[:8])
                    for s in new_seeds: url_queue.put(s)
                
                if len(current_topics) > 100: current_topics = current_topics[-50:]

            # Save progress
            if len(runtime_indexed) >= 5:
                with data_lock:
                    with open(LOG_FILE, "a") as f:
                        for url in runtime_indexed:
                            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {url}\n")
                    runtime_indexed = []
                    
            if len(visited) > 20000: # Increased memory limit
                with data_lock: visited.clear()

    except KeyboardInterrupt:
        print(f"\n🛑 Manual Stop. Saving final data...")
    finally:
        pbar.close()

if __name__ == "__main__":
    run_komu_autonomous()