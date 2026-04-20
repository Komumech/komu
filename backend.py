from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer
from huggingface_hub import InferenceClient
import os

# Initialize FastAPI
app = FastAPI()

# Allow the HTML file to talk to the Python backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load configurations (Replace with your actual keys or use environment variables)
PINECONE_KEY = "your_pinecone_key"
HF_TOKEN = "your_hf_token"

# Init Engines
pc = Pinecone(api_key=PINECONE_KEY)
pc_index = pc.Index("plex-index")
embed_model = SentenceTransformer('all-mpnet-base-v2')
ai_client = InferenceClient(api_key=HF_TOKEN)

class SearchRequest(BaseModel):
    query: str

@app.post("/search")
async def search(request: SearchRequest):
    query = request.query
    if not query:
        raise HTTPException(status_code=400, detail="Query is empty")

    try:
        # 1. Search Pinecone
        vector = embed_model.encode(query).tolist()
        query_res = pc_index.query(vector=vector, top_k=10, include_metadata=True)
        
        results = []
        context_text = ""
        for m in query_res.get('matches', []):
            res = {
                "title": m['metadata'].get('title', 'No Title'),
                "url": m['metadata'].get('url', '#'),
                "snippet": m['metadata'].get('text', '')[:200],
                "domain": m['metadata'].get('url', '').split('/')[2] if '/' in m['metadata'].get('url', '') else ''
            }
            results.append(res)
            context_text += f"\nSource: {res['snippet']}\n"

        # 2. Generate AI Summary
        ai_summary = ""
        if context_text:
            prompt = f"User Query: {query}\nContext: {context_text}\nAnswer accurately:"
            response = ai_client.chat.completions.create(
                model="meta-llama/Llama-3.2-1B-Instruct",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500
            )
            ai_summary = response.choices[0].message.content

        return {
            "ai_summary": ai_summary,
            "results": results,
            "sources": [r['url'] for r in results[:3]]
        }
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)