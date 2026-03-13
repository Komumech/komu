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
from urllib.parse import urlparse, urljoin
from urllib3.poolmanager import PoolManager
from requests.adapters import HTTPAdapter

# --- 0. THE SSL & SESSION PATCH ---
class TLSAdapter(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ctx.options |= getattr(ssl, "OP_IGNORE_UNEXPECTED_EOF", 0)
        self.poolmanager = PoolManager(num_pools=connections, maxsize=maxsize, block=block, ssl_context=ctx)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
session = requests.Session()
# Higher pool size for MAX_THREADS efficiency
session.mount("https://", TLSAdapter(pool_connections=30, pool_maxsize=30))

try:
    from indexer import index_website
except ImportError:
    def index_website(url): return True 

# --- 1. CONFIGURATION ---
LOG_FILE = "indexed_sites.txt"
TARGET_COUNT = 1000 
MAX_THREADS = 15 
DOMAIN_LIMIT = 40  # Max pages per domain to ensure diversity

SEED_SITES = [
    "https://www.france24.com/en",
    "https://www.theguardian.com/international",
    "https://www.scmp.com",
    "https://phys.org",
    "https://www.smithsonianmag.com",
    "https://nautil.us",
    "https://blog.archive.org",
    "https://knowyourmeme.com",
    "https://openlibrary.org",
    "https://www.artsy.net/articles",
    "https://thisiscolossal.com",
    "https://publicdomainreview.org",
    "https://eyeondesign.aiga.org",
    "https://lobste.rs",
    "https://arxiv.org/list/cs/new",
    "https://curlie.org",
    "https://www.themarginalian.org",
    "https://github.com/trending",
    "https://news.ycombinator.com"
]

TRUSTED_DOMAINS = [
    "france24.com", "theguardian.com", "scmp.com", "phys.org", 
    "smithsonianmag.com", "nautil.us", "archive.org", 
    "knowyourmeme.com", "openlibrary.org", "artsy.net", 
    "thisiscolossal.com", "publicdomainreview.org", 
    "aiga.org", "lobste.rs", "arxiv.org", "curlie.org", 
    "themarginalian.org", "indieweb.org", "bbc.co.uk", "github.com", "ycombinator.com"
]

# --- 2. SHARED DATA ---
url_queue = Queue()
visited = set()         
runtime_indexed = set() 
domain_counts = {}  
data_lock = threading.Lock()
pbar = None 

# --- 3. UTILS ---

def load_history():
    if not os.path.exists(LOG_FILE): return set()
    history = set()
    with open(LOG_FILE, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.split("] ")
            if len(parts) > 1:
                history.add(parts[1].strip().lower())
    return history

def log_indexed_site(url):
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {url}\n")

# --- 4. THE CRAWLER WORKER ---

def crawler_worker():
    global pbar
    while True:
        try:
            url = url_queue.get(timeout=10)
        except Empty:
            continue # Orchestrator handles the shutdown logic

        clean_url = url.lower().strip()
        domain = urlparse(clean_url).netloc
        
        with data_lock:
            if pbar.n >= TARGET_COUNT or clean_url in visited:
                url_queue.task_done()
                continue
            
            # Domain Capping check
            if domain_counts.get(domain, 0) >= DOMAIN_LIMIT:
                url_queue.task_done()
                continue
                
            visited.add(clean_url)

        try:
            headers = {'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            resp = session.get(url, headers=headers, timeout=12)
            
            if resp.status_code == 200:
                # Filter out traps
                blacklist = ["/events/", "/calendar/", "/tag/", "/category/", "/search/"]
                if any(p in clean_url for p in blacklist):
                    url_queue.task_done()
                    continue

                content = trafilatura.extract(resp.text) or ""
                
                if len(content) > 450:
                    success = index_website(url)
                    if success:
                        with data_lock:
                            if clean_url not in runtime_indexed:
                                runtime_indexed.add(clean_url)
                                domain_counts[domain] = domain_counts.get(domain, 0) + 1
                                log_indexed_site(url)
                                pbar.update(1)
                                pbar.set_postfix({"added": domain[:10], "cnt": f"{domain_counts[domain]}/{DOMAIN_LIMIT}"})

                # Discovery logic
                raw_links = re.findall(r'href=["\'](.*?)["\']', resp.text)
                random.shuffle(raw_links)
                
                added_from_this_page = 0
                for link in raw_links:
                    if added_from_this_page >= 15: break
                    
                    full_url = urljoin(url, link).split('#')[0].split('?')[0].rstrip('/')
                    link_domain = urlparse(full_url).netloc
                    
                    parsed_path = urlparse(full_url).path.strip('/')
                    slash_count = parsed_path.count('/') if parsed_path else 0
                    
                    is_trusted = any(td in link_domain for td in TRUSTED_DOMAINS)
                    max_depth = 3 if is_trusted else 1
                    
                    if slash_count <= max_depth and link_domain:
                        with data_lock:
                            if domain_counts.get(link_domain, 0) < DOMAIN_LIMIT:
                                if full_url.lower() not in visited:
                                    url_queue.put(full_url)
                                    added_from_this_page += 1

            time.sleep(random.uniform(0.2, 0.5))
        except Exception:
            pass
        finally:
            url_queue.task_done()

# --- 5. ORCHESTRATOR ---

def run_master_crawler():
    global pbar
    print("🔍 Loading history...")
    history = load_history()
    runtime_indexed.update(history)
    visited.update(history)

    # RE-BOOTSTRAP SEEDS: Remove seeds from 'visited' so we can re-scan them for new links
    for site in SEED_SITES: 
        clean_seed = site.lower().strip()
        if clean_seed in visited:
            visited.remove(clean_seed)
        url_queue.put(site)

    print(f"🌍 Komu Scout starting. Existing database: {len(history)}")
    pbar = tqdm(total=TARGET_COUNT, initial=0, desc="Session Progress", unit="site")

    

    threads = []
    for _ in range(MAX_THREADS):
        t = threading.Thread(target=crawler_worker)
        t.daemon = True 
        t.start()
        threads.append(t)

    # 1. BOOTSTRAP PHASE: Let threads start working before we check if the queue is empty
    print("🚀 Bootstrapping queue (12 seconds)...")
    time.sleep(12) 

    try:
        consecutive_empty = 0
        while True:
            with data_lock:
                if pbar.n >= TARGET_COUNT:
                    print("\n🎯 Target reached!")
                    break
            
            if url_queue.empty():
                consecutive_empty += 1
                # Exit only if queue is empty for 30 seconds straight
                if consecutive_empty >= 3: 
                    print("\n🏁 Queue exhausted naturally.")
                    break
            else:
                consecutive_empty = 0 # Reset if we found work
            
            time.sleep(10) # Monitor every 10 seconds
            
    except KeyboardInterrupt:
        print("\n🛑 Stop requested.")

    pbar.close()
    print(f"\n✅ Complete. Logged: {len(runtime_indexed)} unique sites.")

if __name__ == "__main__":
    run_master_crawler()