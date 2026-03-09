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
# Diverse seeds to give the crawler different "neighborhoods" of the web
SEEDS = [
    'https://github.com',       # Open Source / Tech
    'https://www.bbc.com',      # News / Global
    'https://people.com',
    'https://en.wikipedia.org/wiki/Special:Random', # Random Knowledge
    'https://www.nature.com',   # Science
    'https://www.producthunt.com', # Startups / Apps
    'https://www.behance.net',  # Design / Creative
    'https://news.ycombinator.com' # Tech News
]
PAGES_PER_DOMAIN_LIMIT = 3  # Keep it moving to new sites quickly
TOTAL_CRAWL_LIMIT = 500     # Stop after 500 pages to save API credits

# --- SHARED STATE ---
url_queue = Queue()
for url in SEEDS:
    url_queue.put(url)

visited_urls = set()
domain_counts = {}
stats_lock = threading.Lock()

def get_domain(url):
    return urlparse(url).netloc

def scout_worker():
    while True:
        try:
            # If queue is empty for 10 seconds, thread exits
            current_url = url_queue.get(timeout=10)
        except Empty:
            break

        domain = get_domain(current_url)

        # Safety & Diversity Checks
        with stats_lock:
            if current_url in visited_urls or len(visited_urls) >= TOTAL_CRAWL_LIMIT:
                url_queue.task_done()
                continue
            if domain_counts.get(domain, 0) >= PAGES_PER_DOMAIN_LIMIT:
                url_queue.task_done()
                continue

        # 1. Index the page
        success = index_website(current_url)
        
        if success:
            with stats_lock:
                visited_urls.add(current_url)
                domain_counts[domain] = domain_counts.get(domain, 0) + 1
            
            # 2. Extract Links (Internal AND External)
            try:
                res = requests.get(current_url, timeout=5)
                soup = BeautifulSoup(res.text, 'html.parser')
                for a in soup.find_all('a', href=True):
                    link = urljoin(current_url, a['href'])
                    link = link.split('#')[0].rstrip('/') # Clean URL
                    
                    if link.startswith('http') and link not in visited_urls:
                        # Add to queue - this allows "jumping" to new sites
                        url_queue.put(link)
            except Exception:
                pass 
        
        url_queue.task_done()
        time.sleep(0.5) # Prevent CPU spiking

def start_omni_crawl():
    print(f"🚀 KOMU OMNI-CRAWLER: Launching {MAX_THREADS} threads...")
    threads = []
    for i in range(MAX_THREADS):
        t = threading.Thread(target=scout_worker, name=f"Scout-{i+1}")
        t.daemon = True
        t.start()
        threads.append(t)

    for t in threads:
        t.join()
    print(f"🏁 CRAWL COMPLETE. Indexed {len(visited_urls)} unique pages.")

if __name__ == "__main__":
    start_omni_crawl()
                
