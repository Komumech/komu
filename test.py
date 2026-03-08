import hashlib
from pinecone import Pinecone
from config import PINECONE_KEY

pc = Pinecone(api_key=PINECONE_KEY)
index = pc.Index("plex-index")

# Generate the ID for fortune.com exactly as your crawler does
target_url = "https://komuthemedashboard.vercel.app" # Make sure this matches your log exactly
vector_id = hashlib.sha256(target_url.lower().encode()).hexdigest()

result = index.fetch(ids=[vector_id])

if result['vectors']:
    print(f"✅ Found it! Metadata: {result['vectors'][vector_id]['metadata']}")
else:
    print("❌ Not found. It was either overwritten or never reached Pinecone.")