import os
import io
import time
import requests
import trafilatura
import urllib3
import re
import threading
from datetime import datetime
import psutil # You might need to run 'pip install psutil'
from queue import Queue, Empty
from tqdm import tqdm
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup

# --- VECTOR ENGINE ---
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer

# --- CONFIGURATION ---
INPUT_FILE = 'formatted_high_signal.txt'
PROCESSED_LOG = 'processed_log.txt'
CRAWL_LOG = "indexed_sites.txt" # Detailed URL log
BATCH_SIZE = 100
MAX_THREADS = 10
DOMAIN_LIMIT = 25  # How many sub-pages to crawl per site
IMAGE_DOMAIN_LIMIT = 15 # 📸 Quota for images per domain

# --- IMAGE FILTERING ---
UI_IMAGE_KEYWORDS = [
    "icon", "avatar", "nav", "button", "spacer", "pixel", 
    "loading", "ad", "advertisement", "search", "menu"
]

# --- LOAD SECURE KEYS ---
try:
    import config
    PINECONE_KEY = config.PINECONE_KEY
    INDEX_NAME = config.INDEX_NAME
    NAMESPACE = config.NAMESPACE
except (ImportError, AttributeError):
    print("❌ ERROR: Ensure config.py exists with PINECONE_KEY, INDEX_NAME, and NAMESPACE.")
    exit()

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
session = requests.Session()

# --- INIT ENGINES ---
model = SentenceTransformer('all-mpnet-base-v2')
pc = Pinecone(api_key=PINECONE_KEY)
pc_index = pc.Index(INDEX_NAME)

url_queue = Queue()
total_at_start = psutil.net_io_counters().bytes_recv
pages_indexed_counter = 0
visited = set()         
domain_counts = {}  
domain_image_counts = {}
data_lock = threading.Lock()

def parse_source_file(filepath):
    """Reads domains from the formatted txt file."""
    domains = []
    if not os.path.exists(filepath): return domains
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            clean = line.strip().replace('"', '').replace(',', '').strip()
            if clean:
                if not clean.startswith('http'):
                    clean = f"https://{clean}"
                domains.append(clean)
    return domains

def is_useful_image(img_url, alt_text):
    """Filters out UI junk like logos and icons to find real content."""
    u, a = img_url.lower(), alt_text.lower()
    if any(k in u for k in UI_IMAGE_KEYWORDS): return False
    if any(k in a for k in UI_IMAGE_KEYWORDS): return False
    return True

def index_to_pinecone(url, content, domain, is_image=False, alt_text="", t_name="Unknown"):
    try:
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
            metadata = {"url": url, "domain": domain, "text": str(content)[:800]}
            
        pc_index.upsert(vectors=[{"id": v_id, "values": vector, "metadata": metadata}], namespace=NAMESPACE)
        return True
    except Exception as e:
        return False

def crawler_worker(pbar):
    global pages_indexed_counter
    while True:
        try:
            url = url_queue.get(timeout=5) 
        except Empty: break

        clean_url = url.lower().strip().rstrip('/')
        parsed = urlparse(clean_url)
        domain = parsed.netloc

        with data_lock:
            if clean_url in visited:
                url_queue.task_done()
                continue
            visited.add(clean_url)

        tqdm.write(f"📡 [Fetching] {url}")
        try:
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
            resp = session.get(url, headers=headers, timeout=10, verify=False)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, 'html.parser')
                
                # --- IMAGE INDEXING LOGIC ---
                # 1. OpenGraph Image
                og_img = soup.find("meta", property="og:image")
                if og_img and og_img.get("content"):
                    img_url = urljoin(url, og_img["content"]).split('?')[0].rstrip('/')
                    site_title = soup.title.string if soup.title else domain
                    with data_lock:
                        if img_url not in visited and domain_image_counts.get(domain, 0) < IMAGE_DOMAIN_LIMIT:
                            if index_to_pinecone(img_url, None, domain, is_image=True, alt_text=f"Featured image for {site_title}"):
                                visited.add(img_url)
                                domain_image_counts[domain] = domain_image_counts.get(domain, 0) + 1

                # 2. Content Images (img tags)
                img_tags = soup.find_all('img', src=True)
                for img in img_tags:
                    alt_text = (img.get('alt') or img.get('title') or "").strip()
                    src = img.get('src')
                    
                    # Filter: Require some descriptive text or recognize it's a content-heavy image
                    if len(alt_text) > 8 and src:
                        full_img_url = urljoin(url, src).split('?')[0].rstrip('/')
                        
                        # Check extensions and quality
                        valid_ext = any(full_img_url.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.webp', '.avif'])
                        if valid_ext and is_useful_image(full_img_url, alt_text):
                            with data_lock:
                                current_img_count = domain_image_counts.get(domain, 0)
                                if full_img_url not in visited and current_img_count < IMAGE_DOMAIN_LIMIT:
                                    if index_to_pinecone(full_img_url, None, domain, is_image=True, alt_text=alt_text):
                                        visited.add(full_img_url)
                                        domain_image_counts[domain] = current_img_count + 1
                                        tqdm.write(f"🖼️  Indexed Image: {full_img_url}")

                img_count = domain_image_counts.get(domain, 0)
                
                text = trafilatura.extract(resp.text) or ""
                if len(text) > 200:
                    if index_to_pinecone(url, text, domain):
                        with data_lock:
                            pages_indexed_counter += 1
                            current_id = pages_indexed_counter
                            domain_counts[domain] = domain_counts.get(domain, 0) + 1
                            tqdm.write(f"✅ [{current_id}] Indexed: {url} | 🖼️  Images: {img_count}")
                            pbar.update(1)
                        # Log individual URL
                        with open(CRAWL_LOG, "a", encoding="utf-8") as f:
                            f.write(f"[{current_id}] {url}\n")
                else:
                    tqdm.write(f"☁️ [Skip] {url} (Low content)")
                
                # Find sub-links for Deep Crawl
                links = re.findall(r'href=["\'](https?://[^\s"\']+|/[^\s"\']+)["\']', resp.text)
                for l in links:
                    full_link = urljoin(url, l).split('#')[0].rstrip('/')
                    if domain in full_link and full_link not in visited:
                        with data_lock:
                            if domain_counts.get(domain, 0) < DOMAIN_LIMIT:
                                url_queue.put(full_link)
            else:
                tqdm.write(f"⚠️ [Skip] {url} (Status: {resp.status_code})")

        except Exception:
            tqdm.write(f"❌ [Error] {url}")
        finally:
            url_queue.task_done()

def run_batch_crawl():
    global domain_counts, domain_image_counts
    print(f"🛰️  KOMU SCOUT: Starting Batch Crawler")
    
    # Load state
    processed_domains = set()
    if os.path.exists(PROCESSED_LOG):
        with open(PROCESSED_LOG, 'r') as f:
            processed_domains = set(line.strip() for line in f)

    all_targets = parse_source_file(INPUT_FILE)
    remaining = [d for d in all_targets if d not in processed_domains]

    print(f"📊 Total Domains: {len(all_targets)} | Remaining: {len(remaining)}")

    # Process in chunks of 100
    for i in range(0, len(remaining), BATCH_SIZE):
        try:
            current_chunk = remaining[i : i + BATCH_SIZE]
            print(f"\n📦 Processing Batch {(i//BATCH_SIZE)+1} ({len(current_chunk)} seeds)...")
            
            domain_counts = {} # Reset counts for this batch to allow DOMAIN_LIMIT per site
            domain_image_counts = {}
            for url in current_chunk:
                url_queue.put(url)

            pbar = tqdm(total=len(current_chunk), desc="Indexing Progress", unit="page")
            
            # Start Threads
            for _ in range(MAX_THREADS):
                t = threading.Thread(target=crawler_worker, args=(pbar,), daemon=True)
                t.start()

            # Wait for this batch to be fully crawled (allows Ctrl+C)
            while not url_queue.empty() or url_queue.unfinished_tasks > 0:
                time.sleep(1)
            
            pbar.close()

            # --- REAL-TIME DATA MONITOR ---
            current_recv = psutil.net_io_counters().bytes_recv
            session_data = (current_recv - total_at_start) / (1024 * 1024) # Convert to MB
            tqdm.write(f"📊 [SESSION DATA USAGE]: {session_data:.2f} MB")
            # Mark batch as finished in log
            with open(PROCESSED_LOG, "a") as f:
                for d in current_chunk:
                    f.write(f"{d}\n")
            
            print(f"✅ Batch complete. Memory cleared.")
            with data_lock:
                visited.clear() # Clear URL memory between batches to save RAM

        except KeyboardInterrupt:
            print("\n🛑 [STOP] Interrupt detected. Shutting down gracefully...")
            break

if __name__ == "__main__":
    run_batch_crawl()
