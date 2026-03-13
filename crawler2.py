import os
import time
import requests
import threading
from queue import Queue, Empty
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
session.mount("https://", TLSAdapter())

from config import GEMINI_KEY
try:
    from indexer import index_website
except ImportError:
    def index_website(url): return True 

# --- 1. CONFIGURATION ---
LOG_FILE = "indexed_sites.txt"
TARGET_COUNT = 1000 
MAX_THREADS = 12 

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
    "https://www.thisiscolossal.com",
    "https://publicdomainreview.org",
    "https://eyeondesign.aiga.org",
    "https://lobste.rs",
    "https://arxiv.org/list/cs/new",
    "https://curlie.org",
    "https://www.themarginalian.org",
    "https://indieweb.org"
]

# --- 2. SHARED DATA & LOCKS ---
url_queue = Queue()
visited = set()         
runtime_indexed = set() 
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
            current_url = url_queue.get(timeout=15)
        except Empty:
            with data_lock:
                if pbar.n >= TARGET_COUNT: break
            continue

        clean_url = url.lower().strip()
        
        with data_lock:
            if pbar.n >= TARGET_COUNT:
                url_queue.task_done()
                break
            if clean_url in visited or clean_url in runtime_indexed:
                url_queue.task_done()
                continue
            visited.add(clean_url)

        try:
            headers = {'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            resp = session.get(url, headers=headers, timeout=10)
            
            if resp.status_code == 200:
                content = trafilatura.extract(resp.text) or ""
                domain = urlparse(url).netloc

                if len(content) > 400:
                    success = index_website(url)
                    if success:
                        with data_lock:
                            if clean_url not in runtime_indexed:
                                runtime_indexed.add(clean_url)
                                log_indexed_site(url)
                                pbar.update(1)
                                pbar.set_postfix({"added": domain[:15]})

                # Discovery with Improved Slash Filter
                raw_links = re.findall(r'href=["\'](.*?)["\']', resp.text)
                for link in raw_links:
                    full_url = urljoin(url, link).split('#')[0].split('?')[0].rstrip('/')
                    
                    # Better Slash Counting: only looks at the path after the domain
                    parsed_path = urlparse(full_url).path.strip('/')
                    slash_count = parsed_path.count('/') if parsed_path else 0
                    
                    # 1 slash limit (Allows site.com/folder but not site.com/folder/page)
                    if slash_count <= 1:
                        link_domain = urlparse(full_url).netloc
                        # Added common patterns for the seeds provided
                        trusted = ["france24.com", "theguardian.com", "scmp.com", "phys.org", 
                                   "smithsonianmag.com", "nautil.us", "archive.org", 
                                   "knowyourmeme.com", "openlibrary.org", "artsy.net", 
                                   "thisiscolossal.com", "publicdomainreview.org", 
                                   "aiga.org", "lobste.rs", "arxiv.org", "curlie.org", 
                                   "themarginalian.org", "indieweb.org", "bbc.co.uk"]
                        
                        if any(td in link_domain for td in trusted):
                            with data_lock:
                                if full_url.lower() not in visited and full_url.lower() not in runtime_indexed:
                                    url_queue.put(full_url)

            time.sleep(random.uniform(0.3, 0.7))

        except Exception: pass
        finally: url_queue.task_done()

# --- 5. ORCHESTRATOR ---

def run_master_crawler():
    global pbar
    print("🔍 Loading history...")
    history = load_history()
    runtime_indexed.update(history)
    
    # Fill queue with seeds
    for site in SEED_SITES: 
        url_queue.put(site)

    print(f"🌍 Komu Scout starting. Already indexed: {len(history)}")
    pbar = tqdm(total=TARGET_COUNT, initial=0, desc="Session Progress", unit="site")

    threads = []
    for _ in range(MAX_THREADS):
        t = threading.Thread(target=crawler_worker)
        t.daemon = True 
        t.start()
        threads.append(t)

    try:
        # Give seeds a moment to process
        time.sleep(8) 
        
        while True:
            # If the queue is empty, we are done
            if url_queue.empty():
                # Final 5-second grace period for slow connections
                time.sleep(5)
                if url_queue.empty():
                    print("\n🏁 Queue finished naturally.")
                    break
            
            with data_lock:
                if pbar.n >= TARGET_COUNT:
                    print("\n🎯 Target reached!")
                    break
            time.sleep(2)
            
    except KeyboardInterrupt:
        print("\n🛑 Stop requested.")

    pbar.close()
    print(f"\n✅ Session complete. Total indexed: {len(runtime_indexed)}")

if __name__ == "__main__":
    print(f"🚀 KOMU PROFILE-SPIDER: Starting at depth {MAX_PATH_SLASHES}...")
    threads = [threading.Thread(target=scout_worker, name=f"Scout-{i+1}") for i in range(MAX_THREADS)]
    for t in threads: t.start()
    for t in threads: t.join()
        
