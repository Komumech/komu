import os
import time
import requests
import trafilatura
import urllib3
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
DOMAIN_LIMIT = 100  
MAX_DEPTH = 3 
BLACKLIST = ["facebook.com", "twitter.com", "instagram.com", "tiktok.com", "quora.com", "reddit.com", "amazon.com", "ebay.com"]

SEARCH_TOPICS = [
    "freelancer platforms 2026",
    "modern day celebrities and youtubers",
    "most used apps in the 2026 era",
    "2026 latest government news",
    "latest movies to watch 2026",
    "Latest animes 2026",
    "Latest google and microsoft apps",
    "remove bg from images",
    "image editing software 2026",
    "new top animation software 2026",
    "new top development software 2026",
    "history of hand-drawn vs 3D animation techniques",
    "recent breakthroughs in quantum entanglement 2026",
    "modern stoicism vs epicureanism in the digital age",
    "ethics of artificial intelligence and digital rights"
]

# --- INIT ENGINES ---
print(f"🛰️  KOMU SCOUT v16.1 - VERBOSE WORKER LOGGING")
model = SentenceTransformer('all-mpnet-base-v2')
pc = Pinecone(api_key=PINECONE_KEY)
pc_index = pc.Index(INDEX_NAME)

ai_client = OpenAI(api_key=AI_API_KEY, base_url=AI_BASE_URL)

url_queue = Queue()
visited = set()          
runtime_indexed = [] 
domain_counts = {}  
active_workers = 0 
data_lock = threading.Lock()
pbar = None 

# --- CORE LOGIC ---
def is_high_quality(url):
    parsed = urlparse(url.lower())
    domain = parsed.netloc
    path = parsed.path.strip('/')
    if any(bad in domain for bad in BLACKLIST): return False
    if re.search(r'\.(zip|exe|mp4|pdf|png|jpg|jpeg|gif|css|js|json|xml|iso)$', url.lower()): return False
    if path and path.count('/') >= MAX_DEPTH: return False
    return True

def get_seeds_robust(queries):
    seeds = []
    try:
        with DDGS() as ddgs:
            for q in queries:
                tqdm.write(f"🔍 [SYSTEM] Seed Scouting: {q}")
                results = ddgs.text(q, max_results=5)
                for r in results: seeds.append(r['href'])
                time.sleep(1.0)
    except: pass
    return list(set(seeds))

def index_to_pinecone(url, text, domain):
    try:
        vector = model.encode(text).tolist()
        v_id = re.sub(r'\W+', '_', url)[:512]
        pc_index.upsert(
            vectors=[{"id": v_id, "values": vector, "metadata": {"url": url, "domain": domain, "text": text[:800]}}],
            namespace=NAMESPACE
        )
        return True
    except: return False

def crawler_worker():
    global active_workers
    t_name = threading.current_thread().name
    while True:
        try:
            url = url_queue.get(timeout=20) 
        except Empty: 
            tqdm.write(f"😴 [{t_name}] Queue empty, waiting...")
            break

        with data_lock: active_workers += 1
        clean_url = url.lower().strip().rstrip('/')
        parsed_current = urlparse(clean_url)
        domain = parsed_current.netloc
        
        # --- CLIMB UP FIX ---
        root_url = f"{parsed_current.scheme}://{domain}"
        with data_lock:
            if root_url not in visited:
                url_queue.put(root_url)

        with data_lock:
            if clean_url in visited or not is_high_quality(clean_url):
                # tqdm.write(f"⏩ [{t_name}] Skipping: {clean_url[:50]}...") # Optional: verbose skip
                active_workers -= 1
                url_queue.task_done()
                continue
            visited.add(clean_url)

        try:
            tqdm.write(f"🌐 [{t_name}] Fetching: {clean_url}")
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
            resp = session.get(url, headers=headers, timeout=10, verify=False)
            
            if resp.status_code == 200:
                text = trafilatura.extract(resp.text) or ""
                is_root = parsed_current.path in ["", "/"]
                
                if is_root and len(text) < 300:
                    meta_match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']', resp.text, re.I)
                    title_match = re.search(r'<title>(.*?)</title>', resp.text, re.I)
                    text = f"{title_match.group(1) if title_match else ''} {meta_match.group(1) if meta_match else ''} {text}"
                
                if len(text) > (50 if is_root else 400): 
                    if index_to_pinecone(url, text, domain):
                        tqdm.write(f"✨ [{t_name}] SUCCESS: Indexed {domain}")
                        with data_lock:
                            runtime_indexed.append(clean_url)
                            domain_counts[domain] = domain_counts.get(domain, 0) + 1
                            pbar.update(1)

                # --- SUB-LINK DISCOVERY ---
                raw_links = re.findall(r'href=["\'](https?://[^\s"\']+|/[^\s"\']+)["\']', resp.text)
                found_count = 0
                for l in raw_links:
                    full_link = urljoin(url, l).split('#')[0].rstrip('/')
                    l_domain = urlparse(full_link).netloc
                    with data_lock:
                        if l_domain and full_link not in visited:
                            if l_domain == domain:
                                if domain_counts.get(l_domain, 0) < DOMAIN_LIMIT:
                                    url_queue.put(full_link)
                                    found_count += 1
                            else:
                                if domain_counts.get(l_domain, 0) < 3:
                                    url_queue.put(full_link)
                
                if found_count > 0:
                    tqdm.write(f"🔗 [{t_name}] Deep-Dive: Found {found_count} links on {domain}")

        except Exception as e:
            tqdm.write(f"❌ [{t_name}] Error on {domain}: {str(e)[:50]}")
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

    seeds = get_seeds_robust(SEARCH_TOPICS)
    for url in seeds: url_queue.put(url)

    print(f"🚀 Launching {MAX_THREADS} Agents...")
    pbar = tqdm(total=None, desc="Total Indexed", unit="site", colour="cyan")
    
    for i in range(MAX_THREADS):
        threading.Thread(target=crawler_worker, name=f"Agent-{i+1}", daemon=True).start()

    try:
        while True:
            time.sleep(10)
            if len(runtime_indexed) >= 5:
                with data_lock:
                    with open(LOG_FILE, "a") as f:
                        for url in runtime_indexed:
                            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {url}\n")
                    runtime_indexed = []
                    
            if len(visited) > 20000:
                with data_lock: visited.clear()
                tqdm.write("🧹 [SYSTEM] Visited cache cleared to save memory.")

    except KeyboardInterrupt:
        print(f"\n🛑 Manual Stop. Finalizing logs...")
    finally:
        pbar.close()

if __name__ == "__main__":
    run_komu_autonomous()