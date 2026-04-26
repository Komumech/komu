import os
import time
import requests
import trafilatura
import urllib3
from bs4 import BeautifulSoup
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
LOG_FILE = "indexed_images.txt"
MAX_THREADS = 8 
DOMAIN_LIMIT = 25  
IMAGES_PER_DOMAIN_LIMIT = 10 # Limits images per site to ensure index diversity
BLACKLIST = [
  "wikipedia.org", "wikimedia.org", "mediawiki.org", "wikidata.org", "play.google.com",
  "facebook.com", "twitter.com", "instagram.com", "tiktok.com", "quora.com", "reddit.com"
]

# --- INITIAL SEED TOPICS ---
IMAGE_SEARCH_TOPICS = [
    "modern architecture high res",
    "nature photography 4k",
    "abstract art inspiration",
    "minimalist interior design",
    "tech gadgets photography",
    "culinary arts food plating",
    "wildlife conservation photos",
    "space exploration imagery",
    "fashion editorial shots",
    "urban street photography"
]

# --- INIT ENGINES ---
print(f"🖼️  KOMU IMAGE SCOUT v1.0 - Autonomous Image Indexing")
model = SentenceTransformer('all-mpnet-base-v2') 
print("✅ Model Loaded: all-mpnet-base-v2 (768 Dimensions)")

pc = Pinecone(api_key=PINECONE_KEY)
pc_index = pc.Index(INDEX_NAME)

ai_client = OpenAI(api_key=AI_API_KEY, base_url=AI_BASE_URL)

url_queue = Queue()
visited_urls = set() 
visited_image_urls = set()
runtime_indexed_images = [] 
domain_counts = {}  
domain_image_counts = {}
active_workers = 0 
data_lock = threading.Lock()
pbar = None 

# --- GOOGLE SUGGESTIONS & AI ---
def get_google_suggestions(query):
    try:
        url = f"http://suggestqueries.google.com/complete/search?client=chrome&q={query}"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            return [s for s in data[1] if len(s) > 3]
        return []
    except: return []

def generate_ai_topics(existing_topics):
    try:
        prompt = f"Generate 5 specific, visually rich search queries based on these topics: {existing_topics}. Return only the list of queries."
        response = ai_client.chat.completions.create(
            model="gpt-3.5-turbo", 
            messages=[{"role": "user", "content": prompt}],
            max_tokens=150
        )
        return [q.strip() for q in response.choices[0].message.content.strip().split('\n') if len(q) > 5]
    except: return []

# --- CORE LOGIC ---
def is_high_quality_domain(url):
    parsed = urlparse(url.lower())
    domain = parsed.netloc
    return not any(bad in domain for bad in BLACKLIST)

def get_seeds_robust(queries):
    seeds = []
    try:
        with DDGS() as ddgs:
            for q in queries:
                results = list(ddgs.text(q, max_results=5))
                for r in results: seeds.append(r['href'])
                time.sleep(1.0)
    except: pass
    return list(set(seeds))

def index_image_to_pinecone(img_data, t_name="Unknown"):
    try:
        # Vectorize the alt text for semantic retrieval
        vector = model.encode(img_data['alt_text'][:1000]).tolist()
        v_id = f"img-{re.sub(r'\W+', '_', img_data['url'])[:50]}"
        
        metadata = {
            "url": img_data['url'], 
            "domain": img_data['domain'],
            "title": img_data['alt_text'][:200] or img_data['page_title'][:200],
            "text": img_data['alt_text'][:800],
            "image": img_data['url'],
            "is_image": True,
            "page_found_on": img_data['page_url'],
            "timestamp": datetime.now().isoformat()
        }

        pc_index.upsert(
            vectors=[{"id": v_id, "values": vector, "metadata": metadata}],
            namespace=NAMESPACE
        )
        return True
    except Exception as e:
        tqdm.write(f"❌ [{t_name}] Pinecone Image Indexing Error: {str(e)[:100]}")
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
            if clean_url in visited_urls or not is_high_quality_domain(clean_url):
                active_workers -= 1
                url_queue.task_done()
                continue
            visited_urls.add(clean_url)

        try:
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
            resp = session.get(url, headers=headers, timeout=12, verify=False)
            
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, 'html.parser')
                page_title = soup.title.string if soup.title else "Untitled Page"
                
                # Extract Images
                img_tags = soup.find_all('img', src=True)
                images_indexed_on_page = 0
                
                for img in img_tags:
                    alt_text = img.get('alt', '').strip()
                    src = img['src']
                    
                    # Heuristic: Prefer images with descriptive alt text (avoiding icons/spacers)
                    if len(alt_text) > 8:
                        img_url = urljoin(url, src).split('?')[0].rstrip('/')
                        if any(img_url.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.webp']):
                            
                            with data_lock:
                                should_index = img_url not in visited_image_urls and \
                                               domain_image_counts.get(domain, 0) < IMAGES_PER_DOMAIN_LIMIT
                            
                            if should_index:
                                img_data = {
                                    'url': img_url,
                                    'alt_text': alt_text,
                                    'page_url': clean_url,
                                    'page_title': page_title,
                                    'domain': domain
                                }
                                if index_image_to_pinecone(img_data, t_name):
                                    with data_lock:
                                        visited_image_urls.add(img_url)
                                        domain_image_counts[domain] = domain_image_counts.get(domain, 0) + 1
                                        runtime_indexed_images.append(img_url)
                                        pbar.update(1)
                                        images_indexed_on_page += 1
                
                if images_indexed_on_page > 0:
                    tqdm.write(f"🖼️ [{t_name}] INDEXED {images_indexed_on_page} images from {domain}")

                # Find new links for recursive crawling
                raw_links = re.findall(r'href=["\'](https?://[^\s"\']+|/[^\s"\']+)["\']', resp.text)
                for l in raw_links:
                    full_link = urljoin(url, l).split('#')[0].rstrip('/')
                    l_domain = urlparse(full_link).netloc
                    with data_lock:
                        if l_domain and full_link not in visited_urls:
                            if l_domain == domain:
                                if domain_counts.get(l_domain, 0) < DOMAIN_LIMIT:
                                    url_queue.put(full_link)
                            else:
                                if domain_counts.get(l_domain, 0) < 5:
                                    url_queue.put(full_link)

        except: pass
        finally:
            with data_lock: active_workers -= 1
            url_queue.task_done()

def run_image_scout_autonomous():
    global pbar, runtime_indexed_images
    
    seeds = get_seeds_robust(IMAGE_SEARCH_TOPICS)
    for url in seeds: url_queue.put(url)

    print(f"🚀 KOMU IMAGE SCOUT READY. Focus: Descriptive imagery & Alt-text semantic indexing.")
    pbar = tqdm(total=None, desc="Live Image Indexing", unit="image", colour="yellow")
    
    for i in range(MAX_THREADS):
        threading.Thread(target=crawler_worker, name=f"ImageAgent-{i+1}", daemon=True).start()

    try:
        while True:
            time.sleep(15)
            
            # Evolution Engine: AI + Google Suggestions
            if url_queue.qsize() < 10:
                new_queries = generate_ai_topics(IMAGE_SEARCH_TOPICS[-3:])
                if new_queries:
                    new_seeds = get_seeds_robust(new_queries)
                    for s in new_seeds: url_queue.put(s)

            # Save indexed URLs to local log file
            if len(runtime_indexed_images) >= 5:
                with data_lock:
                    with open(LOG_FILE, "a") as f:
                        for url in runtime_indexed_images:
                            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {url}\n")
                    runtime_indexed_images = []
                    
            if len(visited_urls) > 30000:
                with data_lock: visited_urls.clear()

    except KeyboardInterrupt:
        print(f"\n🛑 Manual Stop. Finalizing logs...")
    finally:
        pbar.close()

if __name__ == "__main__":
    run_image_scout_autonomous()