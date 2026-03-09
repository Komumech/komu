import os
import time
import trafilatura
from google import genai  # Modern Google AI SDK
from pinecone import Pinecone  # Updated Pinecone SDK

# --- CONFIG ---
# These are pulled from your GitHub Actions Secrets
GEMINI_KEY = os.getenv("GEMINI_KEY")
PINECONE_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "plex-index")

def index_website(url):
    """
    Scrapes a website, generates a vector embedding using Gemini, 
    and saves the result to Pinecone for search.
    """
    try:
        if not GEMINI_KEY or not PINECONE_KEY:
            print("🚨 ERROR: Missing API Keys. Check GitHub Secrets.")
            return False

        # 1. Initialize Clients
        client = genai.Client(api_key=GEMINI_KEY)
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index(PINECONE_INDEX_NAME)

        # 2. Scrape Content
        print(f"📥 Scraping: {url}")
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            print(f"⚠️ Failed to reach {url}")
            return False
            
        main_text = trafilatura.extract(downloaded, include_comments=False)
        if not main_text:
            print(f"⚠️ No readable text found on {url}")
            return False

        # 3. Generate Embedding (Modern text-embedding-004 model)
        print(f"🧠 Generating Embedding for {url[:30]}...")
        # Note: contents is plural in the new SDK
        res = client.models.embed_content(
            model="text-embedding-004", 
            contents=main_text[:3000]
        )
        
        # 4. Upsert to Pinecone
        # The new SDK structure for embeddings is res.embeddings[0].values
        print(f"💾 Saving to Pinecone index: {PINECONE_INDEX_NAME}")
        index.upsert(vectors=[{
            "id": url, 
            "values": res.embeddings[0].values, 
            "metadata": {
                "url": url, 
                "text": main_text[:500],
                "timestamp": time.time()
            }
        }])

        print(f"✅ SUCCESS: {url} is now searchable.")
        return True

    except Exception as e:
        print(f"🚨 INDEXER CRASH on {url}: {e}")
        return False
            
