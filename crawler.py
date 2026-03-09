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
# "Hub" seeds that link to many different external domains
SEEDS = [
    'https://github.com/trending',
    'https://www.bbc.com',
    'https://en.wikipedia.org/wiki/Special:Random',
    'https://dev.to',
    'https://www.producthunt.com',
    'https://news.ycombinator.com',
    'https://www.theverge.com',
    'https://www.medium.com',
    'https://www.wired.com'
]
PAGES_PER_DOMAIN_LIMIT = 4
TOTAL_CRAWL_LIMIT = 500
MAX_URL_SLASHES = 4 # Blocks deep paths like /a/b/c/d/e/f

# --- SHARED STATE ---
url_queue = Queue()
for url in SEEDS:
    url_queue.put(url)

visited_urls = set()
domain_counts = {}
stats_lock = threading.Lock()

def get_domain(url):
    return urlparse(url).netloc

def is_too_deep(url):
    """Returns True if the URL has too many sub-directories."""
    path = urlparse(url).path
    return path.count('/') > MAX_URL_SLASHES

def scout_worker():
    while True:
        try:
            current_url = url_queue.get(timeout=15)
        except Empty:
            break

        # 1. Clean and Filter URL
        if "?" in current_url:
            current_url = current_url.split("?")[0]
        current_url = current_url.rstrip('/')
        
        domain = get_domain(current_url)

        with stats_lock:
            if current_url in visited_urls or len(visited_urls) >= TOTAL_CRAWL_LIMIT:
                url_queue.task_done()
                continue
            if domain_counts.get(domain, 0) >= PAGES_PER_DOMAIN_LIMIT:
                url_queue.task_done()
                continue
            if is_too_deep(current_url):
                url_queue.task_done()
                continue

        # 2. Index the page
        success = index_website(current_url)
        
        if success:
            with stats_lock:
                visited_urls.add(current_url)
                domain_counts[domain] = domain_counts.get(domain, 0) + 1
            
            # 3. Extract Links
            try:
                res = requests.get(current_url, timeout=5)
                soup = BeautifulSoup(res.text, 'html.parser')
                for a in soup.find_all('a', href=True):
                    link = urljoin(current_url, a['href'])
                    link = link.split('#')[0].rstrip('?') 
                    
                    if link.startswith('http') and link not in visited_urls:
                        url_queue.put(link)
            except Exception:
                pass 
        
        url_queue.task_done()
        time.sleep(0.3) # Stability delay to prevent memory 'Double Free'

if __name__ == "__main__":
    print(f"🚀 KOMU OMNI-SPIDER: Scanning the web with {MAX_THREADS} threads...")
    threads = []
    for i in range(MAX_THREADS):
        t = threading.Thread(target=scout_worker, name=f"Scout-{i+1}")
        t.daemon = True
        t.start()
        threads.append(t)

    for t in threads:
        t.join()
    print(f"🏁 CRAWL COMPLETE. Indexed {len(visited_urls)} pages.")
