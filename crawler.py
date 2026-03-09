import threading
import time
import requests
import random
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from indexer import index_website

# --- SETTINGS ---
MAX_THREADS = 2 
SEED_URLS = ["https://github.com", "https://www.bbc.com"]

# --- STATE ---
visited = set()
queue = SEED_URLS.copy()
queue_lock = threading.Lock()
write_lock = threading.Lock()

def worker():
    thread_name = threading.current_thread().name
    while True:
        with queue_lock:
            if not queue:
                break
            url = queue.pop(0)
            if url in visited:
                continue
            visited.add(url)

        print(f"\n[{thread_name}] 🎯 TARGET: {url}")
        
        # Call the indexer
        success = index_website(url)
        
        if success:
            with write_lock:
                with open("indexed_sites.txt", "a") as f:
                    f.write(url + "\n")
            
            # Find new links
            try:
                resp = requests.get(url, timeout=7)
                soup = BeautifulSoup(resp.text, 'html.parser')
                found = 0
                for link in soup.find_all('a', href=True):
                    full_url = urljoin(url, link['href'])
                    if full_url.startswith('http') and full_url not in visited:
                        with queue_lock:
                            if len(queue) < 1000:
                                queue.append(full_url)
                                found += 1
                print(f"🔗 {thread_name} added {found} new links to queue.")
            except Exception as e:
                print(f"⚠️ Link extraction error: {e}")
                
        # Nigerian connection/API safety sleep
        time.sleep(random.uniform(2, 4))

def start_crawl():
    print("🚀 KOMU SCOUT STARTING (RAW LOGS MODE)...")
    print(f"Seeds: {SEED_URLS}")
    
    threads = []
    for i in range(MAX_THREADS):
        t = threading.Thread(target=worker, name=f"Scout-{i+1}")
        t.start()
        threads.append(t)
        
    for t in threads:
        t.join()
        
    print("\n🏁 ALL THREADS FINISHED.")

if __name__ == "__main__":
    start_crawl()
          
