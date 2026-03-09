import threading
import time
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from indexer import index_website

# --- SETTINGS ---
MAX_THREADS = 2  # Keep this low for stability
SEED_URLS = ["https://github.com", "https://www.bbc.com"]

# --- STATE ---
visited = set()
queue = SEED_URLS.copy()
queue_lock = threading.Lock()
write_lock = threading.Lock()

def worker():
    while True:
        with queue_lock:
            if not queue:
                break
            url = queue.pop(0)
            
            if url in visited:
                continue
            visited.add(url)

        print(f"\n[{threading.current_thread().name}] --- Target: {url} ---")
        
        # Send to the indexer
        success = index_website(url)
        
        if success:
            # 1. Save to text file immediately
            with write_lock:
                with open("indexed_sites.txt", "a") as f:
                    f.write(url + "\n")
            
            # 2. Find new links to keep the crawler moving
            try:
                resp = requests.get(url, timeout=5)
                soup = BeautifulSoup(resp.text, 'html.parser')
                new_links = 0
                for link in soup.find_all('a', href=True):
                    next_url = urljoin(url, link['href'])
                    if next_url.startswith('http'):
                        with queue_lock:
                            # Keep queue manageable
                            if next_url not in visited and len(queue) < 1500:
                                queue.append(next_url)
                                new_links += 1
                print(f"🔗 Found {new_links} new links.")
            except Exception as e:
                print(f"⚠️ Could not extract new links from {url}: {e}")
                
        # Give the APIs a breather
        time.sleep(1.5)

def start_crawl():
    print("🚀 STARTING KOMU SCOUT (RAW LOGS MODE)...")
    threads = []
    
    # Start the worker threads
    for i in range(MAX_THREADS):
        t = threading.Thread(target=worker, name=f"Thread-{i+1}")
        t.start()
        threads.append(t)
        
    for t in threads:
        t.join()
        
    print("\n🏁 CRAWL FINISHED.")

if __name__ == "__main__":
    start_crawl()
