import trafilatura
from google import genai
from pinecone import Pinecone
from config import GEMINI_KEY, PINECONE_KEY
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup # Added for better image discovery

# 1. Setup
client = genai.Client(api_key=GEMINI_KEY)
pc = Pinecone(api_key=PINECONE_KEY)
index = pc.Index("plex-index") 

def index_website(url):
    try:
        print(f"🔍 Analyzing: {url}")
        
        # --- A. CONTENT EXTRACTION ---
        downloaded = trafilatura.fetch_url(url)
        if not downloaded: return False
        
        main_text = trafilatura.extract(downloaded, include_comments=False)
        metadata = trafilatura.extract_metadata(downloaded)
        title = metadata.title if metadata and metadata.title else url
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
                "type": "web", # Label as web content
                "title": title, 
                "url": url,
                "domain": domain,
                "text": main_text[:1000]
            }
        }])

        # --- C. IMAGE DISCOVERY & INDEXING ---
        # We parse the HTML to find <img> tags with alt text
        soup = BeautifulSoup(downloaded, 'html.parser')
        images_found = soup.find_all('img')
        
        img_vectors = []
        indexed_count = 0

        for img in images_found:
            img_url = img.get('src')
            alt_text = img.get('alt', '').strip()
            
            # Filter for quality: skip icons, small spacers, or empty alt text
            if not img_url or len(alt_text) < 10: continue
            
            full_img_url = urljoin(url, img_url)
            
            # Vectorize the image based on its ALT TEXT and Page Title
            # This allows the search engine to find the image when users type relevant keywords
            img_res = client.models.embed_content(
                model="gemini-embedding-001",
                contents=f"Image from {title}: {alt_text}",
                config={"task_type": "RETRIEVAL_DOCUMENT", "output_dimensionality": 768}
            )
            
            img_vectors.append({
                "id": f"img_{full_img_url}", # Unique ID for images
                "values": img_res.embeddings[0].values,
                "metadata": {
                    "type": "image", # Label for the Images tab
                    "title": alt_text,
                    "url": url, # Parent page
                    "image_url": full_img_url,
                    "domain": domain
                }
            })
            indexed_count += 1
            if indexed_count >= 5: break # Cap at 5 images per page to save Pinecone space

        if img_vectors:
            index.upsert(vectors=img_vectors)
        
        print(f"✅ Indexed: {domain} (+{indexed_count} images)")
        return True

    except Exception as e:
        print(f"❌ Snag on {url}: {e}")
        return False

if __name__ == "__main__":
    index_website("https://people.com/celebrity/ariana-grande")