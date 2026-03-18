import requests
from bs4 import BeautifulSoup
from pinecone import Pinecone
from urllib.parse import urlparse
import time
from tqdm import tqdm
import urllib3
import concurrent.futures # The secret for "more than one fixer"
from threading import Lock

# Suppress SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- CONFIG ---
try:
    import config
    PINECONE_KEY = config.PINECONE_KEY
    INDEX_NAME = config.INDEX_NAME
    NAMESPACE = config.NAMESPACE
except ImportError:
    print("🚨 config.py missing!")
    exit()

# Global Session for connection reuse (MUCH faster)
session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
})

# Global stats and locks for thread-safe reporting
stats = {"repair_count": 0, "blocked_sites": 0}
stats_lock = Lock()

def get_fast_metadata(url):
    """Fast scraping using requests."""
    try:
        resp = session.get(url, timeout=8, verify=False)
        if resp.status_code != 200:
            return None
        
        if "Just a moment" in resp.text or "enable cookies" in resp.text.lower():
            return {"blocked": True}

        soup = BeautifulSoup(resp.text, 'html.parser')
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"

        title_tag = soup.find("title")
        title = title_tag.get_text().strip() if title_tag else None

        img = None
        img_tag = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "twitter:image"})
        
        if img_tag:
            img = img_tag.get('content')
        else:
            icon_tag = soup.find("link", rel="apple-touch-icon") or soup.find("link", rel="icon")
            if icon_tag:
                img = icon_tag.get('href')

        if img:
            if img.startswith('//'): img = f"{parsed.scheme}:{img}"
            elif img.startswith('/'): img = f"{base}{img}"
            elif not img.startswith('http'): img = f"{base}/{img}"

        return {"title": title, "image_url": img}
    except:
        return None

def process_single_record(m, index):
    """The function each 'fixer' thread will run."""
    global stats
    meta = m.get('metadata', {})
    url = meta.get('url')
    
    needs_img = not meta.get('image_url') or "placeholder" in meta.get('image_url')
    needs_title = not meta.get('title') or "untitled" in meta.get('title', '').lower()

    if (needs_img or needs_title) and url:
        new_data = get_fast_metadata(url)
        
        if not new_data:
            return
        
        if new_data.get("blocked"):
            with stats_lock: stats["blocked_sites"] += 1
            return

        update_payload = {}
        if needs_title and new_data.get('title'):
            update_payload["title"] = new_data['title']
        if needs_img and new_data.get('image_url'):
            update_payload["image_url"] = new_data['image_url']

        if update_payload:
            try:
                index.update(id=m['id'], set_metadata=update_payload, namespace=NAMESPACE)
                with stats_lock: stats["repair_count"] += 1
            except:
                pass

def repair_index_parallel(max_workers=15):
    """Main runner that spawns multiple fixers."""
    pc = Pinecone(api_key=PINECONE_KEY)
    index = pc.Index(INDEX_NAME)

    print(f"\n📡 Connecting to Pinecone Index: {INDEX_NAME}...")
    
    # Using [0]*1536 or whatever your model dimension is (usually 768 or 1536)
    results = index.query(vector=[0]*768, top_k=10000, include_metadata=True, namespace=NAMESPACE)
    matches = results.get('matches', [])
    
    print(f"🔎 Scanning {len(matches)} records with {max_workers} threads...")
    print("-" * 80)

    # The ThreadPoolExecutor creates your "fixers"
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Wrapping the executor in tqdm for the progress bar
        list(tqdm(executor.map(lambda m: process_single_record(m, index), matches), total=len(matches)))

    print("-" * 80)
    print(f"✨ TURBO FINISHED!")
    print(f"✅ Records Patched: {stats['repair_count']}")
    print(f"🚫 Sites requiring Playwright (Skipped): {stats['blocked_sites']}")

if __name__ == "__main__":
    repair_index_parallel(max_workers=12) # Try 10-15 workers for home internet