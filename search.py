import ssl
import os
import time

# --- 1. THE HEAVY-DUTY SSL PATCH ---
# This must happen BEFORE importing google or pinecone
os.environ['CURL_CA_BUNDLE'] = '' 
os.environ["GRPC_SSL_CIPHER_SUITES"] = "HIGH+ECDSA"

try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

# --- 2. NOW IMPORT YOUR TOOLS ---
from google import genai
from pinecone import Pinecone
from config import GEMINI_KEY, PINECONE_KEY

def search_komu(query):
    print(f"🤔 Komu is searching: '{query}'...")
    
    try:
        # Setup clients inside the function to ensure they use the patch
        client = genai.Client(api_key=GEMINI_KEY)
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index("plex-index")

        # 1. Vectorize with a retry-safety net
        result = client.models.embed_content(
            model="gemini-embedding-001",
            contents=query,
            config={"task_type": "RETRIEVAL_QUERY", "output_dimensionality": 768}
        )
        query_vector = result.embeddings[0].values

        # 2. Query Pinecone
        response = index.query(vector=query_vector, top_k=3, include_metadata=True)

        print("\n" + "="*30)
        if not response['matches']:
            print("❌ Nothing found.")
        else:
            for match in response['matches']:
                meta = match['metadata']
                print(f"✨ {meta.get('title', 'No Title')}")
                print(f"🔗 {meta.get('url', 'No Link')}")
                print(f"📝 {meta.get('text', '')[:200]}...")
                print("-" * 30)

    except Exception as e:
        print(f"❌ Still getting an error: {e}")
        print("\n💡 PEER TIP: If this still fails, your Wi-Fi or Antivirus is blocking the connection.")
        print("Try: 1. Turning off your VPN. 2. Connecting to a Mobile Hotspot.")

if __name__ == "__main__":
    q = input("Ask Komu: ")
    search_komu(q)