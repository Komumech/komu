import os
import time
import trafilatura
import google.generativeai as genai
from pinecone import Pinecone

# --- CONFIG ---
GEMINI_KEY = os.getenv("GEMINI_KEY")
PINECONE_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "plex-index")

def index_website(url):
    try:
        if not GEMINI_KEY or not PINECONE_KEY:
            print("🚨 ERROR: Missing API Keys in environment.")
            return False

        # Init Services
        genai.configure(api_key=GEMINI_KEY)
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index(PINECONE_INDEX_NAME)

        # A. SCRAPE
        print(f"📥 Scrapping content: {url}")
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            print(f"⚠️ Trafilatura failed to download {url}")
            return False
            
        main_text = trafilatura.extract(downloaded)
        if not main_text:
            print(f"⚠️ No readable text found on {url}")
            return False

        # B. EMBED
        print(f"🧠 Generating Embedding for {url[:30]}...")
        # Note: Using the reliable embedding model
        embedding_res = genai.embed_content(
            model="models/embedding-001",
            content=main_text[:3000],
            task_type="retrieval_document"
        )
        
        # C. UPSERT
        print(f"💾 Saving to Pinecone...")
        index.upsert(vectors=[{
            "id": url, 
            "values": embedding_res['embedding'], 
            "metadata": {
                "url": url, 
                "text_snippet": main_text[:500]
            }
        }])

        # D. VERIFY
        time.sleep(1.5) # Wait for eventual consistency
        check = index.fetch(ids=[url])
        if check and url in check.get('vectors', {}):
            print(f"✅ SUCCESS: {url} is indexed.")
            return True
        else:
            print(f"❌ FAILED: Record was sent but not found in index.")
            return False

    except Exception as e:
        print(f"🚨 INDEXER ERROR on {url}: {e}")
        return False
              
