import os
import time
import trafilatura
from google import genai
from pinecone import Pinecone
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup

# --- 1. SETUP & KEYS ---
GEMINI_KEY = os.getenv("GEMINI_KEY")
PINECONE_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "plex-index")

if not GEMINI_KEY or not PINECONE_KEY:
    try:
        from config import GEMINI_KEY, PINECONE_KEY
    except ImportError:
        pass

def index_website(url):
    try:
        # Initialize clients inside for thread-safety
        client = genai.Client(api_key=GEMINI_KEY)
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index(PINECONE_INDEX_NAME)

        # A. PRE-CHECK: Skip if already exists
        check_before = index.fetch(ids=[url])
        if check_before and url in check_before.get('vectors', {}):
            print(f"⏩ Already indexed: {url}")
            return True

        # B. CONTENT EXTRACTION
        downloaded = trafilatura.fetch_url(url)
        if not downloaded: return False
        
        main_text = trafilatura.extract(downloaded, include_comments=False)
        metadata = trafilatura.extract_metadata(downloaded)
        title = (metadata.title if metadata and metadata.title else url)
        domain = urlparse(url).netloc
        if not main_text: return False

        # C. GENERATE EMBEDDING
        res = client.models.embed_content(
            model="gemini-embedding-001",
            contents=main_text[:3000], 
            config={"task_type": "RETRIEVAL_DOCUMENT", "title": title, "output_dimensionality": 768}
        )
        
        # D. UPSERT TO PINECONE
        index.upsert(vectors=[{
            "id": url, 
            "values": res.embeddings[0].values, 
            "metadata": {
                "type": "web", "title": title, "url": url, "domain": domain, "text": main_text[:1000]
            }
        }])

        # E. IMAGE EXTRACTION
        soup = BeautifulSoup(downloaded, 'html.parser')
        images = soup.find_all('img')
        img_vectors = []
        for img in images:
            img_url = img.get('src')
            alt = img.get('alt', '').strip()
            if not img_url or len(alt) < 10: continue
            
            full_img_url = urljoin(url, img_url)
            img_res = client.models.embed_content(
                model="gemini-embedding-001",
                contents=f"Image from {title}: {alt}",
                config={"task_type": "RETRIEVAL_DOCUMENT", "output_dimensionality": 768}
            )
            img_vectors.append({
                "id": f"img_{full_img_url}",
                "values": img_res.embeddings[0].values,
                "metadata": {"type": "image", "title": alt, "url": url, "image_url": full_img_url}
            })
            if len(img_vectors) >= 3: break
        
        if img_vectors:
            index.upsert(vectors=img_vectors)

        # F. FINAL VERIFICATION (The "Double Check")
        # Give Pinecone a tiny moment to process (optional but safer)
        time.sleep(1) 
        verify = index.fetch(ids=[url])
        if verify and url in verify.get('vectors', {}):
            print(f"✅ VERIFIED: {domain} is now live in Pinecone.")
            return True
        else:
            print(f"⚠️ FAILED VERIFICATION: {url} was sent but not found.")
            return False

    except Exception as e:
        print(f"❌ Snag on {url}: {e}")
        return False
        
