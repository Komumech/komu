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
import hashlib
import importlib
import sys
import json
import shutil
from datetime import datetime
from queue import Queue, Empty
from tqdm import tqdm
from urllib.parse import urlparse, urljoin
from ddgs import DDGS 
from openai import OpenAI 

# --- GOOGLE COLAB OPTIMIZATION ---
def _run_colab_setup():
    """Ensures all necessary libraries are installed and ready for Google Colab."""
    try:
        import google.colab
        print("☁️ Detected Google Colab. Verifying system dependencies...")
        import subprocess
        required = [
            "trafilatura", "pinecone", "sentence-transformers", 
            "duckduckgo-search", "openai", "google-genai", "tqdm"
        ]
        for package in required:
            try:
                # Map package names to import names
                check_name = package.replace('-', '_')
                if check_name == "google_genai": check_name = "google.genai"
                __import__(check_name)
                
                # Deep check for Pinecone integrity
                if package == "pinecone":
                    import pinecone
                    if not hasattr(pinecone, 'Pinecone'):
                        raise ImportError("Pinecone class missing")

            except (ImportError, AttributeError, Exception):
                print(f"📦 Installing/Repairing {package}...")
                
                if package == "pinecone":
                    # 1. Remove local folder that might be shadowing the library
                    if os.path.isdir("pinecone"):
                        print("🗑️ Removing local 'pinecone' directory shadowing the library.")
                        shutil.rmtree("pinecone", ignore_errors=True)
                    
                    # 2. Force clean install
                    subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "pinecone-client", "pinecone"], capture_output=True)
                
                subprocess.check_call([sys.executable, "-m", "pip", "install", "--upgrade", package])
                importlib.invalidate_caches()
                # Clear the module from cache to force Python to re-scan the site-packages directory
                if "pinecone" in sys.modules:
                    del sys.modules["pinecone"]
        print("✅ Environment ready.")
        return True
    except ImportError:
        return False

# Run environment setup BEFORE importing third-party vector libs
IS_COLAB = _run_colab_setup()

# --- VECTOR ENGINE ---
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer

# --- LINK TO INDEXER MODULE ---
try:
    import indexer
    print("✅ Indexer module linked successfully.")
except ImportError:
    print("⚠️ Warning: indexer.py not found in the same directory. Using internal crawler logic.")
    indexer = None

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
SUGGESTIONS_LOG = "search_suggestions_history.txt"
STATE_FILE = "crawler_state.json"
MAX_THREADS = 8 
DOMAIN_LIMIT = 20  # 🚀 Limit to 20 pages per domain to ensure index diversity
sitemaps_processed = set()
sitemap_lock = threading.Lock()
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

def clean_suggestions_file():
    """Removes duplicates from the suggestions log and returns unique queries."""
    if not os.path.exists(SUGGESTIONS_LOG):
        tqdm.write(f"⚠️ {SUGGESTIONS_LOG} not found.")
        return []

    tqdm.write(f"🧹 Cleaning duplicates from {SUGGESTIONS_LOG}...")
    seen_queries = set()
    cleaned_entries = []
    
    with open(SUGGESTIONS_LOG, "r", encoding="utf-8") as f:
        for line in f:
            if "] " in line:
                parts = line.split("] ", 1)
                query = parts[1].strip()
                if query.lower() not in seen_queries:
                    seen_queries.add(query.lower())
                    cleaned_entries.append(line)
    
    with open(SUGGESTIONS_LOG, "w", encoding="utf-8") as f:
        f.writelines(cleaned_entries)
        
    # Return just the query strings for the crawler to use as topics
    return [line.split("] ", 1)[1].strip() for line in cleaned_entries]

SEARCH_TOPICS = [ 
]

# --- INIT ENGINES ---
print(f"🛰️  KOMU SCOUT v15.2 - DEEP-DIVE & AI ENABLED")

# Shared Visual Brain: Link to indexer model if available to save RAM on Colab
if indexer and hasattr(indexer, 'visual_engine'):
    model = indexer.visual_engine
    print("✅ Using shared AI model from Indexer module.")
else:
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

# --- STATE PERSISTENCE ---
def save_state(pointer):
    """Saves the current suggestion pointer to disk."""
    try:
        with open(STATE_FILE, "w") as f:
            json.dump({"suggestion_pointer": pointer}, f)
    except Exception as e:
        tqdm.write(f"⚠️ Failed to save state: {e}")

def load_state():
    """Loads the suggestion pointer from disk."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f).get("suggestion_pointer", 0)
        except: pass
    return 0

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
            suggestions = [s for s in data[1] if len(s) > 3]
            
            # Log suggestions to file with a timestamp for later analysis
            if suggestions:
                timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                with data_lock:
                    with open(SUGGESTIONS_LOG, "a", encoding="utf-8") as f:
                        for s in suggestions:
                            f.write(f"[{timestamp}] {s}\n")
            
            return suggestions
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
                time.sleep(0.5) # Reduced sleep for faster cycle time
    except: pass
    return list(set(seeds))

def process_sitemap(sitemap_url, domain, t_name):
    """Parses XML sitemaps and index files to extract URLs."""
    with sitemap_lock:
        if sitemap_url in sitemaps_processed: return
        sitemaps_processed.add(sitemap_url)

    try:
        resp = session.get(sitemap_url, timeout=10, verify=False)
        if resp.status_code != 200: return
        
        root = ET.fromstring(resp.content)
        ns = {'ns': root.tag.split('}')[0].strip('{')} if '}' in root.tag else {}
        
        if 'sitemapindex' in root.tag:
            locs = root.findall('.//ns:loc', ns) if ns else root.findall('.//loc')
            for loc in locs:
                process_sitemap(loc.text.strip(), domain, t_name)
        else:
            locs = root.findall('.//ns:loc', ns) if ns else root.findall('.//loc')
            count = 0
            for loc in locs:
                url = loc.text.strip()
                with data_lock:
                    if url not in visited:
                        url_queue.put(url)
                        count += 1
            if count > 0:
                tqdm.write(f"🗺️ [{t_name}] Sitemap Extracted: {count} URLs from {sitemap_url}")
    except: pass

def discover_sitemaps(root_url, domain, t_name):
    """Attempts to find sitemaps via robots.txt or common paths."""
    try:
        robots_url = urljoin(root_url, "/robots.txt")
        resp = session.get(robots_url, timeout=5, verify=False)
        if resp.status_code == 200:
            for sm in re.findall(r'^Sitemap:\s*(.*)', resp.text, re.M | re.I):
                process_sitemap(sm.strip(), domain, t_name)
    except: pass
    for loc in ["/sitemap.xml", "/sitemap_index.xml"]:
        process_sitemap(urljoin(root_url, loc), domain, t_name)

def extract_structured_data(soup):
    """Parses JSON-LD to find high-value SEO signals like FAQs and How-Tos."""
    structured_info = {"faqs": [], "how_to": [], "product": None, "article_headline": None}
    scripts = soup.find_all('script', type='application/ld+json')
    
    for script in scripts:
        try:
            if not script.string: continue
            data = json.loads(script.string)
            # Handle lists of objects or single objects
            items = data if isinstance(data, list) else [data]
            
            for item in items:
                stype = item.get('@type')
                
                # 1. FAQ Schema
                if stype == 'FAQPage':
                    for entry in item.get('mainEntity', []):
                        q = entry.get('name')
                        a = entry.get('acceptedAnswer', {}).get('text')
                        if q and a: structured_info["faqs"].append({"q": q, "a": a})
                
                # 2. How-To Schema
                elif stype == 'HowTo':
                    steps = [s.get('text') or s.get('itemListElement', {}).get('text') for s in item.get('step', [])]
                    structured_info["how_to"] = [s for s in steps if s]
                
                # 3. Product/Review
                elif stype in ['Product', 'Review']:
                    rating = item.get('aggregateRating', {}).get('ratingValue')
                    name = item.get('name')
                    if name: structured_info["product"] = {"name": name, "rating": rating}
                
                # 4. Article Headline
                elif stype in ['Article', 'NewsArticle', 'BlogPosting']:
                    structured_info["article_headline"] = item.get('headline')
        except: continue
    return structured_info

def get_semantic_segments(soup):
    """Splits content based on HTML hierarchy (Main content first, segmented by headings)."""
    # Strategy 1: Find Main Container
    main_container = soup.find(['main', 'article']) or soup.find('div', class_=re.compile(r'content|body|article|post', re.I))
    root = main_container if main_container else soup.find('body')
    if not root: return []

    segments = []
    current_chunk = []
    
    # Strategy 2 & 3: Iterate through elements to find headings and QA lists
    for element in root.find_all(['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'dt', 'dd']):
        text = element.get_text(separator=' ', strip=True)
        if not text: continue

        # Treat Headings as new segment boundaries
        if element.name in ['h1', 'h2', 'h3']:
            if current_chunk:
                segments.append(" ".join(current_chunk))
                current_chunk = []
            # Prefix chunk with its heading for context
            current_chunk.append(f"[{text}]") 
        else:
            current_chunk.append(text)

        # Periodically flush large chunks to prevent dilution
        if len(" ".join(current_chunk)) > 800:
            segments.append(" ".join(current_chunk))
            current_chunk = []

    if current_chunk:
        segments.append(" ".join(current_chunk))
        
    return [s for s in segments if len(s) > 100]

def index_to_pinecone(url, content, domain, is_image=False, alt_text="", t_name="Unknown", chunk_idx=0, extra_meta=None):
    try:
        # Encoding content (truncating text to maintain performance)
        # For images, we vectorize the alt_text since MPNet is text-only
        input_data = (alt_text if is_image else str(content))[:1000]
        vector = model.encode(input_data).tolist()
        
        # Use MD5 hash for ID to guarantee ASCII and unique fixed length
        # This prevents the "Vector ID must contain only ASCII characters" error
        url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()
        v_id = f"{url_hash}_{chunk_idx}"
        
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
            metadata = {"url": url, "domain": domain, "text": str(content)[:800]}
            
        # Merge in structured data signals
        if extra_meta:
            if extra_meta.get("faqs"): metadata["is_faq"] = "true"
            if extra_meta.get("product"): metadata["has_rating"] = "true"
            if extra_meta.get("article_headline"): metadata["official_headline"] = extra_meta["article_headline"][:200]

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
        # Remove timeout to prevent agents from dying during the long scouting phase
        url = url_queue.get() 
        
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
                # Use BeautifulSoup for both image and content prioritization
                soup = BeautifulSoup(resp.text, 'html.parser')
                raw_html_len = len(resp.text)
                
                # NEW: Extract Structured Data (Strategy 4)
                # Use refined extraction logic from indexer if linked
                if indexer and hasattr(indexer, 'extract_structured_data'):
                    structured_data = indexer.extract_structured_data(soup)
                else:
                    structured_data = extract_structured_data(soup)
                
                # NEW: Get Meta Tags (OG / Twitter)
                og_desc = soup.find("meta", property="og:description")
                page_desc = og_desc["content"] if og_desc else ""

                # --- IMAGE INDEXING: Max 3 per site, requiring Alt Text ---
                try:
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
                                            if index_to_pinecone(img_url, None, domain, is_image=True, alt_text=alt_text, t_name=t_name, chunk_idx=0):
                                                with data_lock:
                                                    visited.add(img_url)
                                                    domain_image_counts[domain] = domain_image_counts.get(domain, 0) + 1
                                                    tqdm.write(f"🖼️ [{t_name}] IMAGE INDEXED: {img_url}")
                                        except Exception: pass
                except Exception: pass

                # NEW: High-Value Indexing (FAQs)
                for i, faq in enumerate(structured_data["faqs"]):
                    faq_content = f"Question: {faq['q']} Answer: {faq['a']}"
                    index_to_pinecone(url, faq_content, domain, chunk_idx=f"faq_{i}", extra_meta={"faqs": True})

                # NEW: Semantic Extraction (Strategy 1, 2, 3)
                # Link to indexer's segmentation logic for consistency
                if indexer and hasattr(indexer, 'get_semantic_segments'):
                    chunks = indexer.get_semantic_segments(soup)
                else:
                    chunks = get_semantic_segments(soup)
                
                # Fallback to Trafilatura if hierarchy extraction was too thin
                if not chunks or len("".join(chunks)) < 500:
                    fallback_text = trafilatura.extract(resp.text, include_comments=False, target_language='en') or ""
                    if fallback_text: chunks = [fallback_text[i:i+800] for i in range(0, len(fallback_text), 700)]

                # Limit to 10 semantic chunks per page to optimize vector usage
                chunks = chunks[:10]

                indexed_any = False
                for i, chunk in enumerate(chunks):
                    if index_to_pinecone(url, chunk, domain, chunk_idx=i, extra_meta=structured_data):
                        indexed_any = True

                # Explicitly clean up soup to free RAM
                del soup
                del structured_data

                if indexed_any:
                    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    tqdm.write(f"✅ [{now}] [{t_name}] INDEXED: {url} ({len(chunks)} chunks) | HTML: {raw_html_len//1024}KB")
                    with data_lock:
                        runtime_indexed.append(clean_url)
                        domain_counts[domain] = domain_counts.get(domain, 0) + 1
                        pbar.update(1)
                        if parsed_current.path in ["", "/"]: discover_sitemaps(url, domain, t_name)

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
    
    # 1. Clean and load topics from suggestion history
    all_suggestions = clean_suggestions_file()
    suggestion_pointer = load_state()
    if suggestion_pointer > 0:
        tqdm.write(f"⏯️  Resuming from history index: {suggestion_pointer}")

    # 2. Load visited URLs from log
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r") as f:
            for line in f:
                if "] " in line:
                    try: visited.add(line.split("] ")[1].strip().lower())
                    except: pass

    print(f"🚀 KOMU SCOUT READY. Injection from history file every 30s active.")
    pbar = tqdm(total=None, desc="Live Indexing", unit="site", colour="magenta")
    
    for i in range(MAX_THREADS):
        threading.Thread(target=crawler_worker, name=f"Agent-{i+1}", daemon=True).start()

    try:
        while True:
            # 3. Batch Seed Injection from file (Pull 200 queries when the queue becomes empty)
            if url_queue.empty() and suggestion_pointer < len(all_suggestions):
                # Extract next batch of 200 topics from the cleaned list
                batch = all_suggestions[suggestion_pointer : suggestion_pointer + 200]
                suggestion_pointer += len(batch)
                save_state(suggestion_pointer)

                tqdm.write(f"📥 Batch Injection: Refilling queue with {len(batch)} topics from history file...")
                new_seeds = get_seeds_robust(batch)
                
                # Fallback if the search engine is being stubborn or rate-limited
                if not new_seeds:
                    tqdm.write("⚠️  Search returned no seeds. Injecting autonomous emergency topics...")
                    new_seeds = get_seeds_robust(get_autonomous_seeds(5))
                
                if new_seeds:
                    for s in new_seeds: url_queue.put(s)
                
                # Update pointer only after scouting attempt
                suggestion_pointer += len(batch)
                save_state(suggestion_pointer)
            
            # 4. Infinite Loop Fix: If we reached the end of the history file, restart from beginning
            elif url_queue.empty() and suggestion_pointer >= len(all_suggestions) and active_workers == 0:
                tqdm.write("🔄 Reached end of history file. Restarting from the beginning to ensure deep index coverage...")
                suggestion_pointer = 0
                save_state(0)

            # Save progress
            if len(runtime_indexed) >= 5:
                with data_lock:
                    with open(LOG_FILE, "a") as f:
                        for url in runtime_indexed:
                            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {url}\n")
                    runtime_indexed = []

            time.sleep(20) 

    except KeyboardInterrupt:
        print(f"\n🛑 Manual Stop. Saving final data...")
    finally:
        pbar.close()

if __name__ == "__main__":
    run_komu_autonomous()