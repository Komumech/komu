import os
import trafilatura
from google import genai
from pinecone import Pinecone
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup

# --- 1. KEY LOADING ---
GEMINI_KEY = os.getenv("GEMINI_KEY")
PINECONE_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "plex-index")

if not GEMINI_KEY or not PINECONE_KEY:
    try:
        from config import GEMINI_KEY, PINECONE_KEY
    except ImportError:
        pass

def index_website(url):
    # --- 2. THREAD-SAFE INITIALIZATION ---
    # Initializing clients inside the function prevents the "Segmentation Fault" crash
    try:
        if not GEMINI_KEY or not PINECONE_KEY:
            return False
            
        client = genai.Client(api_key=GEMINI_KEY)
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index(PINECONE_INDEX_NAME)
        
        print(f"🔍 Analyzing: {url}")
        
        # --- A. CONTENT EXTRACTION ---
        downloaded = trafilatura.fetch_url(url)
        if not downloaded: 
            return False
        
        main_text = trafilatura.extract(downloaded, include_comments=False)
        metadata = trafilatura.extract_metadata(downloaded)
        title = (metadata.title if metadata and metadata.title else url)
        domain = urlparse(url).netloc
        
        if not main_text: 
            return False

        # --- B. INDEX WEB PAGE (Text) ---
        # Note: Ensure your Pinecone Index dimension is set to 768
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
            
            # Skip icons or empty alts
            if not img_url or len(alt_text) < 10: 
                continue
            
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
            if indexed_count >= 5: 
                break 

        if img_vectors:
            index.upsert(vectors=img_vectors)
        
        print(f"✅ Indexed: {domain} (+{indexed_count} images)")
        return True

    except Exception as e:
        # This will now print the EXACT error in your GitHub Actions log
        print(f"❌ Snag on {url}: {type(e).__name__} - {e}")
        return False

if __name__ == "__main__":
    index_website("https://www.theguardian.com/international")
        
