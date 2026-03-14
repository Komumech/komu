import os
import time
import requests
import ssl
import trafilatura
import urllib3
import re
import random
import threading
from queue import Queue, Empty
from tqdm import tqdm
from urllib.parse import urlparse
from urllib3.poolmanager import PoolManager
from requests.adapters import HTTPAdapter

# --- VECTOR ENGINE ---
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer

# --- LOAD SECURE KEYS ---
try:
    import config
    PINECONE_KEY = config.PINECONE_KEY
    INDEX_NAME = config.INDEX_NAME
    NAMESPACE = config.NAMESPACE
except (ImportError, AttributeError):
    print("❌ ERROR: Ensure config.py exists with keys.")
    exit()

# --- SSL & SESSION STABILIZER ---
class TLSAdapter(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ctx.options |= getattr(ssl, "OP_IGNORE_UNEXPECTED_EOF", 0)
        self.poolmanager = PoolManager(num_pools=connections, maxsize=maxsize, block=block, ssl_context=ctx)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
session = requests.Session()
session.mount("https://", TLSAdapter(pool_connections=100, pool_maxsize=100))

# --- USER AGENT ROTATION ---
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
]

# --- GLOBAL CONFIG ---
LOG_FILE = "indexed_sites.txt"
TARGET_COUNT = 1500 
MAX_THREADS = 5   # Balanced for CPU/Network efficiency
DOMAIN_LIMIT = 40 # Max pages per single domain

SEED_SITES = [
    "https://news.ycombinator.com",
    "https://about.google/products/",
    "https://lobste.rs",
    "https://arxiv.org/list/cs/new",
    "https://slashdot.org",
    "https://blog.google/",
    "https://wordpress.org/",
    "https://people.com/celebrity/",
    "https://www.sciencedaily.com"
]

# --- INITIALIZE ENGINES ---
print(f"🛰️  KOMU SCOUT v10 - ACTIVATED")
try:
    print("🧠 Loading Sentence Transformer...")
    model = SentenceTransformer('all-mpnet-base-v2')
    print(f"📡 Connecting to Pinecone Index: {INDEX_NAME}...")
    pc = Pinecone(api_key=PINECONE_KEY)
    pc_index = pc.Index(INDEX_NAME)
except Exception as e:
    print(f"❌ Initialization Failed: {e}"); exit()

# --- SHARED DATA ---
url_queue = Queue()
visited = set()         
runtime_indexed = set() 
domain_counts = {}  
active_workers = 0 
data_lock = threading.Lock()
pbar = None 

# --- CORE FUNCTIONS ---
def index_to_pinecone(url, text, domain, t_name):
    try:
        # AI Vectorization
        vector = model.encode(text).tolist()
        v_id = re.sub(r'\W+', '_', url)[:512]
        
        pc_index.upsert(
            vectors=[{
                "id": v_id, 
                "values": vector, 
                "metadata": {
                    "url": url, 
                    "domain": domain, 
                    "text": text[:800], 
                    "scanned_at": time.time()
                }
            }],
            namespace=NAMESPACE
        )
        return True
    except Exception as e:
        tqdm.write(f"⚠️ [{t_name}] Pinecone Error: {str(e)[:40]}")
        return False

def crawler_worker():
    global pbar, active_workers
    t_name = threading.current_thread().name
    while True:
        try:
            url = url_queue.get(timeout=15) 
        except Empty:
            continue

        with data_lock: active_workers += 1

        clean_url = url.lower().strip().rstrip('/')
        domain = urlparse(clean_url).netloc
        
        with data_lock:
            if pbar.n >= TARGET_COUNT or clean_url in visited:
                active_workers -= 1
                url_queue.task_done()
                continue
            visited.add(clean_url)

        try:
            tqdm.write(f"🌐 [{t_name}] Fetching: {domain}")
            headers = {'User-Agent': random.choice(USER_AGENTS), 'Referer': 'https://www.google.com/'}
            resp = session.get(url, headers=headers, timeout=15)
            
            if resp.status_code == 200:
                tqdm.write(f"✂️  [{t_name}] Cleaning Content...")
                text = trafilatura.extract(resp.text) or ""
                
                if len(text) > 250: 
                    tqdm.write(f"🧬 [{t_name}] AI Processing & Uploading...")
                    if index_to_pinecone(url, text, domain, t_name):
                        with data_lock:
                            runtime_indexed.add(clean_url)
                            domain_counts[domain] = domain_counts.get(domain, 0) + 1
                            pbar.update(1)
                            tqdm.write(f"✅ [{t_name}] SUCCESS: {domain}")

                # RECURSIVE LINK DISCOVERY
                # This finds "links from links from links"
                links = re.findall(r'href=["\'](https?://[^\s"\']+)["\']', resp.text)
                random.shuffle(links)
                found_new = 0
                for l in links:
                    if found_new >= 30: break # Keep the queue healthy but not overflowing
                    l_clean = l.split('#')[0].split('?')[0].rstrip('/')
                    l_domain = urlparse(l_clean).netloc
                    
                    # Filter for quality
                    if any(x in l_clean for x in ["/tag/", "/search/", "/login", "facebook.com", "twitter.com"]):
                        continue

                    with data_lock:
                        if l_domain and l_clean not in visited and domain_counts.get(l_domain, 0) < DOMAIN_LIMIT:
                            url_queue.put(l_clean)
                            found_new += 1
            else:
                tqdm.write(f"❌ [{t_name}] HTTP {resp.status_code}: {domain}")

            time.sleep(random.uniform(1, 2)) 
        except Exception as e:
            tqdm.write(f"💥 [{t_name}] Request Error on {domain}")
        finally:
            with data_lock: active_workers -= 1
            url_queue.task_done()

# --- MASTER ORCHESTRATOR ---
def run_komu():
    global pbar
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r") as f:
            for line in f:
                parts = line.split("] ")
                if len(parts) > 1: visited.add(parts[1].strip().lower())

    for site in SEED_SITES: url_queue.put(site)

    print(f"🚀 KOMU SCOUT READY. Beginning Deep Recursive Crawl.")
    pbar = tqdm(total=TARGET_COUNT, desc="Indexing", unit="site", colour="cyan")

    # Start Threads
    for i in range(MAX_THREADS):
        t = threading.Thread(target=crawler_worker, name=f"Scout-{i+1}", daemon=True)
        t.start()

    # Smart Monitoring Loop
    try:
        while pbar.n < TARGET_COUNT:
            time.sleep(10)
            with data_lock:
                busy = active_workers
                pending = url_queue.qsize()
            
            if pending == 0 and busy == 0:
                tqdm.write("⏳ Discovery check... waiting for threads to report links.")
                time.sleep(40) # Extended wait for AI processing to finish
                if url_queue.empty() and active_workers == 0:
                    tqdm.write("🏁 Mission Finished: No more links found.")
                    break
    except KeyboardInterrupt:
        print("\n🛑 Safe Exit: Progress Saved.")

    # Final log of all unique sites found
    with open(LOG_FILE, "a") as f:
        for url in runtime_indexed:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {url}\n")

    pbar.close()
    print(f"✅ Mission Complete. Total Sites Indexed this session: {len(runtime_indexed)}")

if __name__ == "__main__":
    run_komu()