import os
import time
import trafilatura
from google import genai
from google.genai import types # Needed for the configuration
from pinecone import Pinecone

# --- CONFIG ---
GEMINI_KEY = os.getenv("GEMINI_KEY", "").strip()
PINECONE_KEY = os.getenv("PINECONE_API_KEY", "").strip()
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "plex-index").strip()

def index_website(url):
    try:
        if not GEMINI_KEY or not PINECONE_KEY:
            print("🚨 ERROR: Missing API Keys.")
            return False

        # 1. Init Clients
        client = genai.Client(api_key=GEMINI_KEY)
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index(PINECONE_INDEX_NAME)

        # 2. Scrape Content
        print(f"📥 Scraping: {url}")
        downloaded = trafilatura.fetch_url(url)
        if not downloaded: 
            print(f"⚠️ Could not download {url}")
            return False
            
        main_text = trafilatura.extract(downloaded)
        if not main_text: 
            print(f"⚠️ No text found on {url}")
            return False

        # 3. Generate Embedding (Forced to 768 dimensions)
        print(f"🧠 Generating 768-dim Embedding...")
        res = client.models.embed_content(
            model="gemini-embedding-001",
            contents=main_text[:3000],
            config=types.EmbedContentConfig(
                output_dimensionality=768 # <--- This fixes your crash!
            )
        )
        
        # 4. Upsert to Pinecone
        print(f"💾 Saving to Pinecone...")
        index.upsert(vectors=[{
            "id": url, 
            "values": res.embeddings[0].values, 
            "metadata": {
                "url": url, 
                "text": main_text[:500]
            }
        }])

        print(f"✅ SUCCESS: {url}")
        return True

    except Exception as e:
        print(f"🚨 INDEXER ERROR on {url}: {e}")
        return False
        
