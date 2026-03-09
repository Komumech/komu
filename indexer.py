import os
import time
import trafilatura
import google.generativeai as genai
from pinecone import Pinecone
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup

# --- API SETUP ---
GEMINI_KEY = os.getenv("GEMINI_KEY")
PINECONE_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "plex-index")

def index_website(url):
    try:
        if not GEMINI_KEY or not PINECONE_KEY:
            print("❌ API Keys missing in Environment.")
            return False

        # Configure Gemini & Pinecone
        genai.configure(api_key=GEMINI_KEY)
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index(PINECONE_INDEX_NAME)

        # 1. DUPLICATE CHECK (Saves credits)
        check = index.fetch(ids=[url])
        if check and url in check.get('vectors', {}):
            print(f"⏩ SKIP: {url} (Already Indexed)")
            return True

        # 2. SCRAPE CONTENT
        print(f"📥 SCRAPING: {url}")
        downloaded = trafilatura.fetch_url(url)
        if not downloaded: return False
        
        main_text = trafilatura.extract(downloaded, include_comments=False)
        if not main_text: return False
        
        metadata = trafilatura.extract_metadata(downloaded)
        title = metadata.title if metadata and metadata.title else url
        domain = urlparse(url).netloc

        # 3. AI EMBEDDING
        print(f"🧠 EMBEDDING: {domain}")
        res = genai.embed_content(
            model="models/embedding-001",
            content=main_text[:3000],
            task_type="retrieval_document",
            title=title
        )
        
        # 4. UPSERT TO PINECONE
        # Using the URL as ID ensures we don't create duplicates
        index.upsert(vectors=[{
            "id": url, 
            "values": res['embedding'], 
            "metadata": {
                "type": "web", 
                "title": title, 
                "url": url, 
                "domain": domain, 
                "text": main_text[:500]
            }
        }])

        # 5. VERIFICATION
        time.sleep(1) # Give the database a heartbeat
        verify = index.fetch(ids=[url])
        if verify and url in verify.get('vectors', {}):
            print(f"✅ VERIFIED: {url} is now in the index.")
            return True
        else:
            print(f"⚠️ WRITE FAILED: {url} did not save to Pinecone.")
            return False

    except Exception as e:
        print(f"🚨 INDEXER CRASH: {e}")
        return False
        
