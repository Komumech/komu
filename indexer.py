import os
import trafilatura
from google import genai
from pinecone import Pinecone
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup

# --- 1. HYBRID SETUP ---
# Try to get keys from GitHub Environment first
GEMINI_KEY = os.getenv("GEMINI_KEY")
PINECONE_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX = os.getenv("PINECONE_INDEX_NAME", "plex-index")

# If they aren't in Environment, try to load from your local config.py
if not GEMINI_KEY or not PINECONE_KEY:
    try:
        from config import GEMINI_KEY, PINECONE_KEY
    except ImportError:
        print("⚠️ Warning: No API keys found in Environment or config.py")

client = genai.Client(api_key=GEMINI_KEY)
pc = Pinecone(api_key=PINECONE_KEY)
index = pc.Index(PINECONE_INDEX) 



def index_website(url):
    try:
        print(f"🔍 Analyzing: {url}")
        
        # --- A. CONTENT EXTRACTION ---
        downloaded = trafilatura.fetch_url(url)
        if not downloaded: return False
        
        main_text = trafilatura.extract(downloaded, include_comments=False)
        metadata = trafilatura.extract_metadata(downloaded)
        title = (metadata.title if metadata and metadata.title else url)
        domain = urlparse(url).netloc
        
        if not main_text: return False

        # --- B. INDEX WEB PAGE (Text) ---
        res = client.models.embed_content(
            model="gemini-embedding-001",
            contents=main_text[:3000], 
            config={"task_type": "RETRIEVAL_DOCUMENT", "title": title, "output_dimensionality": 768}
        )
        
        index.upsert(vectors=[{
            "id": url, 
            "values": res.embeddings[0].values, 
            "metadata": {
                "type": "web",
                "title": title, 
                "url": url,
                "domain": domain,
                "text": main_text[:1000]
            }
        }])

        # --- C. IMAGE DISCOVERY & INDEXING ---
        soup = BeautifulSoup(downloaded, 'html.parser')
        images_found = soup.find_all('img')
        
        img_vectors = []
        indexed_count = 0

        for img in images_found:
            img_url = img.get('src')
            alt_text = img.get('alt', '').strip()
            
            # Filter: skip tiny icons or empty alts
            if not img_url or len(alt_text) < 10: continue
            
            full_img_url = urljoin(url, img_url)
            
            img_res = client.models.embed_content(
                model="gemini-embedding-001",
                contents=f"Image from {title}: {alt_text}",
                config={"task_type": "RETRIEVAL_DOCUMENT", "output_dimensionality": 768}
            )
            
            img_vectors.append({
                "id": f"img_{full_img_url}",
                "values": img_res.embeddings[0].values,
                "metadata": {
                    "type": "image",
                    "title": alt_text,
                    "url": url,
                    "image_url": full_img_url,
                    "domain": domain
                }
            })
            indexed_count += 1
            if indexed_count >= 5: break 

        if img_vectors:
            index.upsert(vectors=img_vectors)
        
        print(f"✅ Indexed: {domain} (+{indexed_count} images)")
        return True

    except Exception as e:
        print(f"❌ Snag on {url}: {e}")
        return False

if __name__ == "__main__":
    # Test with a high-image-content page
    index_website("https://www.theguardian.com/international")
