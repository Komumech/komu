import trafilatura
import re
from bs4 import BeautifulSoup
from google import genai
from google.genai import types
from pinecone import Pinecone
from urllib.parse import urlparse, urljoin

# --- IMPORT FROM CONFIG ---
try:
    import config
    GEMINI_KEY = getattr(config, 'GEMINI_KEY', None)
    PINECONE_KEY = getattr(config, 'PINECONE_KEY', None)
    PINECONE_INDEX_NAME = getattr(config, 'PINECONE_INDEX_NAME', "plex-index")
except ImportError:
    print("🚨 [Config Error] config.py not found!")
    GEMINI_KEY = None
    PINECONE_KEY = None

def get_metadata(html, url):
    """Rigorous extraction of Title and Preview Image."""
    soup = BeautifulSoup(html, 'html.parser')
    metadata = {"title": "", "image": ""}
    
    # 1. Hunt for Title
    metadata['title'] = (
        soup.find("meta", property="og:title") or 
        soup.find("meta", attrs={"name": "twitter:title"}) or
        soup.find("title")
    )
    if metadata['title']:
        metadata['title'] = metadata['title'].get_text() if hasattr(metadata['title'], 'get_text') else metadata['title'].get('content', '')

    # 2. Hunt for Image (The 'Rigorous' Part)
    # Priority: OpenGraph -> Twitter -> Main Article Image -> First Large Img
    img_tag = (
        soup.find("meta", property="og:image") or 
        soup.find("meta", attrs={"name": "twitter:image"}) or
        soup.find("link", rel="image_src")
    )
    
    if img_tag:
        metadata['image'] = img_tag.get('content', '') or img_tag.get('href', '')
    
    # Fallback to first high-res looking image if no meta tags
    if not metadata['image']:
        for img in soup.find_all("img", src=True):
            src = img['src']
            if any(ext in src.lower() for ext in ['.jpg', '.jpeg', '.png', '.webp']):
                if "logo" not in src.lower(): # Prefer content images over icons
                    metadata['image'] = src
                    break

    # Clean up relative URLs (e.g., "/img.jpg" -> "https://site.com/img.jpg")
    if metadata['image'] and metadata['image'].startswith('/'):
        parsed = urlparse(url)
        metadata['image'] = f"{parsed.scheme}://{parsed.netloc}{metadata['image']}"

    return metadata

def index_website(url):
    try:
        if not GEMINI_KEY or not PINECONE_KEY:
            return False

        client = genai.Client(api_key=GEMINI_KEY, http_options=types.HttpOptions(api_version="v1beta"))
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index(PINECONE_INDEX_NAME)

        downloaded = trafilatura.fetch_url(url)
        if not downloaded: return False
            
        # Extract metadata rigorously from raw HTML
        meta_data = get_metadata(downloaded, url)
        
        main_text = trafilatura.extract(downloaded)
        if not main_text or len(main_text) < 400: return False

        stats = index.describe_index_stats().get('namespaces', {}).get('default', {})
        target_dim = index.describe_index_stats().get('dimension', 768)

        res = client.models.embed_content(
            model="gemini-embedding-2-preview",
            contents=main_text[:8000],
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_DOCUMENT",
                output_dimensionality=target_dim
            )
        )

        # Index additional images from the page (up to 10 with alt text)
        soup = BeautifulSoup(downloaded, 'html.parser')
        img_vectors = []
        img_count = 0
        for img in soup.find_all('img', alt=True):
            alt = img.get('alt', '').strip()
            src = img.get('src', '')
            if len(alt) > 5 and src and img_count < 10:
                img_url = urljoin(url, src).split('?')[0]
                if any(ext in img_url.lower() for ext in ['.jpg', '.jpeg', '.png', '.webp']):
                    # Embed alt text for the specific image
                    img_res = client.models.embed_content(
                        model="gemini-embedding-2-preview",
                        contents=f"{alt} (found on {meta_data['title']})",
                        config=types.EmbedContentConfig(
                            task_type="RETRIEVAL_DOCUMENT",
                            output_dimensionality=target_dim
                        )
                    )
                    img_vectors.append({
                        "id": f"img_{img_url}_{img_count}",
                        "values": img_res.embeddings[0].values,
                        "metadata": {
                            "url": img_url,
                            "parent_url": url,
                            "title": alt, # Alt text becomes the title
                            "alt": alt,   # Searchable alt field
                            "text": alt,  # Searchable text field
                            "image": img_url,
                            "is_image": True, # CRITICAL: This allows separate image-only search
                            "domain": urlparse(url).netloc,
                            "indexed_at": "2026-04-21"
                        }
                    })
                    img_count += 1

        # Batch upsert images
        if img_vectors:
            index.upsert(vectors=img_vectors, namespace="default")

        # Upsert with MORE metadata so the UI doesn't have to guess
        index.upsert(vectors=[{
            "id": url, 
            "values": res.embeddings[0].values, 
            "metadata": {
                "url": url, 
                "title": meta_data['title'] or "Untitled Result",
                "image": meta_data['image'], # Changed to 'image' to match server expectations
                "text": main_text[:600].replace("\n", " "),
                "indexed_at": "2026-03-14"
            }
        }], namespace="default")
        
        return True

    except Exception as e:
        print(f"❌ [Indexer Error] {url}: {e}")
        return False