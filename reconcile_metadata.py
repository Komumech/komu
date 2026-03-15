import requests
from bs4 import BeautifulSoup
from pinecone import Pinecone
from urllib.parse import urlparse
import time
from tqdm import tqdm
import urllib3

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

def get_fast_metadata(url):
    """Fast scraping using requests for sites without heavy bot protection."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10, verify=False)
        if resp.status_code != 200:
            return None
        
        # If we see the Cloudflare 'Just a moment' screen, skip this site
        if "Just a moment" in resp.text or "enable cookies" in resp.text.lower():
            return {"blocked": True}

        soup = BeautifulSoup(resp.text, 'html.parser')
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"

        # 1. Title Extraction
        title_tag = soup.find("title")
        title = title_tag.get_text().strip() if title_tag else None

        # 2. Image Extraction (OG Image is best for preview logos)
        img = None
        img_tag = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "twitter:image"})
        
        if img_tag:
            img = img_tag.get('content')
        else:
            # Fallback to high-res icon
            icon_tag = soup.find("link", rel="apple-touch-icon") or soup.find("link", rel="icon")
            if icon_tag:
                img = icon_tag.get('href')

        # Clean relative URLs
        if img:
            if img.startswith('//'): img = f"{parsed.scheme}:{img}"
            elif img.startswith('/'): img = f"{base}{img}"
            elif not img.startswith('http'): img = f"{base}/{img}"

        return {"title": title, "image_url": img}
    except:
        return None

def repair_index():
    pc = Pinecone(api_key=PINECONE_KEY)
    index = pc.Index(INDEX_NAME)

    print(f"\n📡 Connecting to Pinecone Index: {INDEX_NAME}...")
    
    # Query records. Adjust vector size [0]*768 to your specific model.
    results = index.query(vector=[0]*768, top_k=10000, include_metadata=True, namespace=NAMESPACE)
    matches = results.get('matches', [])
    
    print(f"🔎 Scanning {len(matches)} records for missing data...")
    print("-" * 80)

    repair_count = 0
    blocked_sites = 0

    for m in tqdm(matches):
        meta = m.get('metadata', {})
        url = meta.get('url')
        
        # Check if we actually need a repair
        needs_img = not meta.get('image_url') or "placeholder" in meta.get('image_url')
        needs_title = not meta.get('title') or "untitled" in meta.get('title', '').lower()

        if (needs_img or needs_title) and url:
            new_data = get_fast_metadata(url)
            
            if not new_data:
                continue
            
            if new_data.get("blocked"):
                blocked_sites += 1
                continue # Skip sites like Envato that need Playwright

            # Build the update
            update_payload = {}
            if needs_title and new_data['title']:
                update_payload["title"] = new_data['title']
            if needs_img and new_data['image_url']:
                update_payload["image_url"] = new_data['image_url']

            if update_payload:
                index.update(id=m['id'], set_metadata=update_payload, namespace=NAMESPACE)
                repair_count += 1
            
            # Fast but polite
            time.sleep(0.2)

    print("-" * 80)
    print(f"✨ FINISHED!")
    print(f"✅ Records Patched: {repair_count}")
    print(f"🚫 Sites requiring Playwright (Skipped): {blocked_sites}")

if __name__ == "__main__":
    repair_index()