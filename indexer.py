import trafilatura
from google import genai
from google.genai import types
from pinecone import Pinecone

# --- IMPORT FROM CONFIG ---
try:
    import config
    GEMINI_KEY = getattr(config, 'GEMINI_KEY', None)
    PINECONE_KEY = getattr(config, 'PINECONE_KEY', None)
    PINECONE_INDEX_NAME = getattr(config, 'PINECONE_INDEX_NAME', "plex-index")
except ImportError:
    print("🚨 [Config Error] config.py not found! Please create it.")
    GEMINI_KEY = None
    PINECONE_KEY = None

def index_website(url):
    try:
        # Basic validation
        if not GEMINI_KEY or not PINECONE_KEY:
            print(f"🚨 [Auth Error] Missing Keys in config.py for {url}")
            return False

        # 1. Initialize Clients
        client = genai.Client(api_key=GEMINI_KEY, http_options=types.HttpOptions(api_version="v1beta"))
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index(PINECONE_INDEX_NAME)

        # 2. Extract and Clean Text
        downloaded = trafilatura.fetch_url(url)
        if not downloaded: 
            return False
            
        main_text = trafilatura.extract(downloaded)
        if not main_text or len(main_text) < 400: 
            return False

        # 3. Auto-Detect Dimensions
        stats = index.describe_index_stats()
        target_dim = stats.get('dimension', 768)

        # 4. Generate High-Quality Embeddings
        res = client.models.embed_content(
            model="gemini-embedding-2-preview",
            contents=main_text[:8000],
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_DOCUMENT",
                output_dimensionality=target_dim
            )
        )

        # 5. Upsert to Pinecone
        index.upsert(vectors=[{
            "id": url, 
            "values": res.embeddings[0].values, 
            "metadata": {
                "url": url, 
                "text_snippet": main_text[:600].replace("\n", " "),
                "indexed_at": "2026-03-14"
            }
        }])
        
        return True

    except Exception as e:
        err_msg = str(e).lower()
        if "401" in err_msg or "invalid api key" in err_msg:
            print(f"\n[!] AUTH ERROR: Check your keys in config.py")
        elif "400" in err_msg or "dimension" in err_msg:
            print(f"\n[!] DIMENSION ERROR: Index mismatch at {url}")
        else:
            # Print specific error if it's not a common one to help debugging
            print(f"\n[Indexer Debug] {url} -> {str(e)[:100]}")
        return False