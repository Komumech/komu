import os
import time
import requests
import threading
from queue import Queue, Empty
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup
from indexer import index_website

# --- SETTINGS ---
MAX_THREADS = 6
SEEDS = [
    'https://about.google/products/',
    'https://duolingo.com',
    'https://www.people.com',
    'https://www.theverge.com',
    'https://www.wired.com',
    'https://github.com/trending',
    'https://dev.to',
    'https://en.wikipedia.org/wiki/Special:Random'
]
PAGES_PER_DOMAIN_LIMIT = 50 # Increased since we are staying "shallow"
TOTAL_CRAWL_LIMIT = 500
MAX_PATH_SLASHES = 1 # <--- This ensures people.com/Ariana works but not people.com/a/b/c

url_queue = Queue()
for url in SEEDS:
    url_queue.put(url)

visited_urls = set()
domain_counts = {}
stats_lock = threading.Lock()

def get_domain(url):
    return urlparse(url).netloc

def get_path_depth(url):
    """Counts slashes in the path only (ignores the https://)"""
    path = urlparse(url).path.strip('/')
    if not path:
        return 0
    return path.count('/') + 1

def scout_worker():
    while True:
        try:
            current_url = url_queue.get(timeout=15)
        except Empty:
            break

        # Clean URL
        if "?" in current_url: current_url = current_url.split("?")[0]
        current_url = current_url.rstrip('/')
        
        domain = get_domain(current_url)
        depth = get_path_depth(current_url)

        with stats_lock:
            # FILTER: If path is deeper than 1 slash, skip it
            if depth > MAX_PATH_SLASHES:
                url_queue.task_done()
                continue
                
            if current_url in visited_urls or len(visited_urls) >= TOTAL_CRAWL_LIMIT:
                url_queue.task_done()
                continue
                
            if domain_counts.get(domain, 0) >= PAGES_PER_DOMAIN_LIMIT:
                url_queue.task_done()
                continue

        # Indexing
        success = index_website(current_url)
        
        if success:
            with stats_lock:
                visited_urls.add(current_url)
                domain_counts[domain] = domain_counts.get(domain, 0) + 1
            
            # Extract Links
            try:
                res = requests.get(current_url, timeout=5)
                soup = BeautifulSoup(res.text, 'html.parser')
                for a in soup.find_all('a', href=True):
                    link = urljoin(current_url, a['href']).split('#')[0].rstrip('/')
                    if link.startswith('http') and link not in visited_urls:
                        url_queue.put(link)
            except Exception:
                pass 
        
        url_queue.task_done()
        time.sleep(0.2)

if __name__ == "__main__":
    print(f"🚀 KOMU PROFILE-SPIDER: Starting at depth {MAX_PATH_SLASHES}...")
    threads = [threading.Thread(target=scout_worker, name=f"Scout-{i+1}") for i in range(MAX_THREADS)]
    for t in threads: t.start()
    for t in threads: t.join()
        
