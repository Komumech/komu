from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer
from huggingface_hub import InferenceClient
import uvicorn
import os
from dotenv import load_dotenv
from urllib.parse import urlparse
from fastapi import HTTPException
from fastapi.staticfiles import StaticFiles

# --- CONFIGURATION ---
# Load environment variables from .env file for local development
load_dotenv()

# Use os.environ.get to prevent crashing if keys are missing during build/deployment
PINECONE_KEY = os.environ.get("PINECONE_KEY")
HF_TOKEN = os.environ.get("HF_TOKEN")
INDEX_NAME = os.environ.get("INDEX_NAME", "plex-index")

if not PINECONE_KEY or not HF_TOKEN:
    print("⚠️ Warning: API Keys missing. Server running in limited mode or may fail on search.")

app = FastAPI()

# Allow your HTML file to communicate with this server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Engines as None
pc = None
index = None
embed_model = None
client = None

# Only initialize if keys are present
if PINECONE_KEY and HF_TOKEN:
    pc = Pinecone(api_key=PINECONE_KEY)
    index = pc.Index(INDEX_NAME)
    embed_model = SentenceTransformer('all-mpnet-base-v2')
    client = InferenceClient(api_key=HF_TOKEN)

def rerank_results(matches, query):
    q_lower = query.lower().strip()
    refined = []
    
    # Authority domains for "perfect" ranking boost
    AUTHORITY_DOMAINS = [
        "wikipedia.org", "britannica.com", "reuters.com", "bbc.com", 
        "nytimes.com", "nature.com", "plato.stanford.edu", "github.com",
        "stackoverflow.com", "mozilla.org", "microsoft.com", "apple.com"
    ]
    
    for m in matches:
        score = m.get('score', 0) # Base vector similarity
        meta = m.get('metadata', {})
        url = meta.get('url', '').lower()
        title = meta.get('title', '').lower()
        snippet = meta.get('text', '').lower()
        domain = urlparse(url).netloc.lower()

        # 1. Exact Phrase Matching (High Weight)
        if q_lower in title: score += 2.0
        if q_lower in snippet: score += 0.8
        
        # 2. Domain Relevance
        if q_lower in domain: score += 2.5
            
        # 3. Domain Authority Boost
        if any(auth in domain for auth in AUTHORITY_DOMAINS):
            score += 1.2
            
        # 4. Entry Point Boost (Prefer homepages over deep paths)
        path_segments = [s for s in urlparse(url).path.split('/') if s]
        if len(path_segments) == 0: score += 0.5
        if any(x in url for x in ['/tag/', '/search/', '/login']): score -= 1.0

        m['custom_score'] = score
        refined.append(m)
    
    return sorted(refined, key=lambda x: x['custom_score'], reverse=True)

@app.get("/search")
async def search(q: str = Query(...), type: str = "all"):
    try:
        if not index or not embed_model:
            raise HTTPException(
                status_code=503, 
                detail="Search engine is not initialized. Please check API keys."
            )

        # 1. Vectorize
        vector = embed_model.encode(q).tolist()
        
        # 2. Query Pinecone
        query_res = index.query(vector=vector, top_k=40, include_metadata=True)
        matches = rerank_results(query_res.get('matches', []), q)
        
        # 3. Format for Frontend
        results = []
        for m in matches:
            meta = m['metadata']
            url = meta.get('url', '')
            is_image = url.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))
            
            if type == "images" and not is_image: continue
            if type == "all" and is_image: continue

            domain = urlparse(url).netloc
            results.append({
                "title": meta.get('title', 'Untitled'),
                "url": url,
                "domain": domain,
                "snippet": meta.get('text', '')[:220] + "...",
                "image_url": url if is_image else None
            })
        
        return {"results": results[:20]}
    except Exception as e:
        print(f"Search Error: {e}")
        return {"error": str(e)}

@app.get("/ai-overview")
async def ai_overview(q: str = Query(...), context: str = Query("")):
    try:
        if not client:
            raise HTTPException(
                status_code=503, 
                detail="AI engine is not initialized. Please check API keys."
            )

        prompt = f"User Query: {q}\nContext: {context}\nProvide a clean summary."
        response = client.chat.completions.create(
            model="meta-llama/Llama-3.2-1B-Instruct",
            messages=[
                {"role": "system", "content": "You are a helpful search assistant."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=500
        )
        return {"overview": response.choices[0].message.content}
    except Exception as e:
        return {"overview": "⚠️ AI generation failed. Please try again later."}

app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)