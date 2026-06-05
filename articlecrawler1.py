import os
import time
import requests
import trafilatura
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET
import re
import threading
import hashlib
from queue import Queue
from urllib.parse import urlparse, urljoin
import urllib3
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer
from colorama import init, Fore, Style

# Initialize colors for detailed terminal logs
init(autoreset=True)

# --- CONFIGURATION ---
try:
    import config
    PINECONE_KEY = config.PINECONE_KEY
    INDEX_NAME = config.INDEX_NAME
    NAMESPACE = getattr(config, 'NAMESPACE', "articles")
except ImportError:
    print(Fore.RED + "❌ ERROR: config.py missing with PINECONE_KEY and INDEX_NAME.")
    exit()

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
session = requests.Session()

# The sites you want to start crawling from
START_URLS = [
    "https://example-blog.blogspot.com", # Replace with real targets
    "https://techcrunch.com"
]

MAX_THREADS = 5
MAX_DEPTH_PER_DOMAIN = 500 # How many articles to index per site before moving on
DOMAIN_LIMITS = {} 

visited_urls = set()
url_queue = Queue()
data_lock = threading.Lock()

# --- INIT ENGINES ---
print(Fore.CYAN + Style.BRIGHT + "🛰️  KOMU SCOUT - ARTICLE DEEP-DIVE ENGINE INITIALIZING...")
print(Fore.YELLOW + "Loading Vector Engine (all-mpnet-base-v2)...")
model = SentenceTransformer('all-mpnet-base-v2')
pc = Pinecone(api_key=PINECONE_KEY)
pc_index = pc.Index(INDEX_NAME)
print(Fore.GREEN + "✅ Vector Engine & Pinecone Connected.")

def log(action, icon, message, color=Fore.WHITE):
    """Custom detailed logging function."""
    timestamp = time.strftime('%H:%M:%S')
    print(f"{Fore.LIGHTBLACK_EX}[{timestamp}] {color}{icon} [{action}] {message}")

def index_to_pinecone(url, content, domain, is_image=False, alt_text=""):
    """Embeds text or image descriptions and pushes to Pinecone."""
    try:
        input_data = (alt_text if is_image else str(content))[:1000]
        if len(input_data.strip()) < 10:
            return False # Skip empty data
            
        vector = model.encode(input_data).tolist()
        v_id = hashlib.md5((url + input_data[:50]).encode('utf-8')).hexdigest()
        
        metadata = {
            "url": url, 
            "domain": domain, 
            "text": input_data[:800],
            "is_image": is_image
        }
        
        pc_index.upsert(
            vectors=[{"id": v_id, "values": vector, "metadata": metadata}],
            namespace=NAMESPACE
        )
        return True
    except Exception as e:
        log("ERROR", "❌", f"Pinecone failure on {url}: {str(e)[:50]}", Fore.RED)
        return False

def extract_and_index_images(soup, url, domain):
    """Finds all images in the article and indexes their alt text."""
    images_found = 0
    for img in soup.find_all('img', alt=True):
        alt_text = img.get('alt', '').strip()
        src = img.get('src', '')
        
        if len(alt_text) > 10 and src: # Only meaningful images
            img_url = urljoin(url, src).split('?')[0]
            
            with data_lock:
                if img_url in visited_urls:
                    continue
                visited_urls.add(img_url)

            if index_to_pinecone(img_url, None, domain, is_image=True, alt_text=alt_text):
                log("IMAGE", "🖼️", f"Indexed image: {alt_text[:40]}... -> {img_url}", Fore.MAGENTA)
                images_found += 1
                
    if images_found > 0:
        log("IMAGE-SUMMARY", "📸", f"Indexed {images_found} images from {url}", Fore.LIGHTMAGENTA_EX)

def dig_for_links(soup, current_url):
    """Extracts every valid link on the page to crawl next."""
    links_added = 0
    for a_tag in soup.find_all('a', href=True):
        href = a_tag['href']
        # Convert relative links (like /about) to full links (https://site.com/about)
        full_link = urljoin(current_url, href).split('#')[0].rstrip('/')
        parsed_link = urlparse(full_link)
        
        # Only follow http/https, ignore mailto:, javascript:, etc.
        if parsed_link.scheme not in ['http', 'https']:
            continue
            
        # Ignore media files (we want HTML articles)
        if re.search(r'\.(zip|exe|mp4|pdf|css|js|json)$', full_link.lower()):
            continue

        with data_lock:
            domain = parsed_link.netloc
            if full_link not in visited_urls and DOMAIN_LIMITS.get(domain, 0) < MAX_DEPTH_PER_DOMAIN:
                url_queue.put(full_link)
                visited_urls.add(full_link)
                links_added += 1
                
    if links_added > 0:
        log("SPIDER", "🕸️", f"Dug deep and found {links_added} new links to crawl from {current_url}", Fore.CYAN)

def process_sitemap(sitemap_url):
    """Extracts mass amounts of links directly from a site's XML map."""
    try:
        log("SITEMAP", "🗺️", f"Cracking open sitemap: {sitemap_url}", Fore.YELLOW)
        resp = session.get(sitemap_url, timeout=10)
        if resp.status_code != 200: return
        
        root = ET.fromstring(resp.content)
        ns = {'ns': root.tag.split('}')[0].strip('{')} if '}' in root.tag else {}
        
        # If it's a sitemap of sitemaps
        if 'sitemapindex' in root.tag:
            for loc in (root.findall('.//ns:loc', ns) if ns else root.findall('.//loc')):
                url_queue.put(loc.text.strip()) # Add the sub-sitemap to queue
        else:
            # If it's a list of article URLs
            links = root.findall('.//ns:loc', ns) if ns else root.findall('.//loc')
            added = 0
            for loc in links:
                url = loc.text.strip()
                with data_lock:
                    if url not in visited_urls:
                        url_queue.put(url)
                        visited_urls.add(url)
                        added += 1
            log("SITEMAP", "✅", f"Extracted {added} massive article links from {sitemap_url}", Fore.GREEN)
    except Exception:
        pass

def crawler_worker():
    while True:
        url = url_queue.get()
        parsed_url = urlparse(url)
        domain = parsed_url.netloc

        # Update domain limits
        with data_lock:
            current_count = DOMAIN_LIMITS.get(domain, 0)
            if current_count >= MAX_DEPTH_PER_DOMAIN:
                url_queue.task_done()
                continue
            DOMAIN_LIMITS[domain] = current_count + 1

        log("FETCHING", "📡", f"Connecting to {url}", Fore.LIGHTBLUE_EX)

        try:
            # Check for sitemap if we are at the root domain
            if parsed_url.path in ['', '/'] and url.endswith('.xml'):
                process_sitemap(url)
                url_queue.task_done()
                continue
            elif parsed_url.path in ['', '/']:
                # Auto-guess sitemap locations for root domains
                url_queue.put(urljoin(url, "/sitemap.xml"))
                url_queue.put(urljoin(url, "/robots.txt"))

            headers = {'User-Agent': 'KomuScout/1.0 (+https://yourwebsite.com)'}
            resp = session.get(url, headers=headers, timeout=10)

            if resp.status_code == 200:
                # 1. Extract pure article text (ignores sidebars, ads, footers)
                article_text = trafilatura.extract(resp.text, include_comments=False)
                
                if article_text and len(article_text) > 200:
                    log("READING", "📖", f"Extracted {len(article_text)} characters of pure article data.", Fore.LIGHTGREEN_EX)
                    
                    # Split massive articles into readable chunks for the AI model
                    chunks = [article_text[i:i+800] for i in range(0, len(article_text), 750)]
                    indexed_chunks = 0
                    for chunk in chunks:
                        if index_to_pinecone(url, chunk, domain):
                            indexed_chunks += 1
                            
                    log("INDEXED", "✅", f"Article {url} saved as {indexed_chunks} vectors.", Fore.GREEN)
                else:
                    log("SKIPPED", "⏭️", f"Not enough article text found on {url}", Fore.LIGHTBLACK_EX)

                # 2. Parse HTML to find Images and deeply hidden Links
                soup = BeautifulSoup(resp.text, 'html.parser')
                extract_and_index_images(soup, url, domain)
                dig_for_links(soup, url)

        except Exception as e:
            log("TIMEOUT/ERR", "⚠️", f"Failed to load {url} - {str(e)[:40]}", Fore.RED)
        finally:
            url_queue.task_done()

if __name__ == "__main__":
    # Load initial URLs
    for start_url in START_URLS:
        url_queue.put(start_url)
        visited_urls.add(start_url)

    # Spin up crawler agents
    for i in range(MAX_THREADS):
        threading.Thread(target=crawler_worker, daemon=True).start()

    # Keep main thread alive while queue processes
    url_queue.join()
    print(Fore.GREEN + Style.BRIGHT + "\n🎉 Komu Scout has finished exploring the current queue!")