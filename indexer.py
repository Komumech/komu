import trafilatura
import re
import requests
import io
import json
from bs4 import BeautifulSoup
from google import genai
from google.genai import types
from pinecone import Pinecone
from urllib.parse import urlparse, urljoin
from PIL import Image
from sentence_transformers import SentenceTransformer

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

# --- INITIALIZE SCOUT V3.5 VISUAL BRAIN ---
# Switching to MPNet (768-dim) for all text and image-alt metadata search
visual_engine = SentenceTransformer('all-mpnet-base-v2')

def extract_structured_data(soup):
    """Parses JSON-LD to find high-value SEO signals like FAQs and How-Tos."""
    structured_info = {"faqs": [], "how_to": [], "product": None, "article_headline": None}
    scripts = soup.find_all('script', type='application/ld+json')
    for script in scripts:
        try:
            if not script.string: continue
            data = json.loads(script.string)
            items = data if isinstance(data, list) else [data]
            for item in items:
                stype = item.get('@type')
                if stype == 'FAQPage':
                    for entry in item.get('mainEntity', []):
                        q = entry.get('name'); a = entry.get('acceptedAnswer', {}).get('text')
                        if q and a: structured_info["faqs"].append({"q": q, "a": a})
                elif stype == 'HowTo':
                    steps = [s.get('text') or s.get('itemListElement', {}).get('text') for s in item.get('step', [])]
                    structured_info["how_to"] = [s for s in steps if s]
                elif stype in ['Product', 'Review']:
                    structured_info["product"] = {"name": item.get('name'), "rating": item.get('aggregateRating', {}).get('ratingValue')}
                elif stype in ['Article', 'NewsArticle', 'BlogPosting']:
                    structured_info["article_headline"] = item.get('headline')
        except: continue
    return structured_info

def get_semantic_segments(soup):
    """Splits content based on HTML hierarchy (Main content first, segmented by headings)."""
    main_container = soup.find(['main', 'article']) or soup.find('div', class_=re.compile(r'content|body|article|post', re.I))
    root = main_container if main_container else soup.find('body')
    if not root: return []

    segments = []
    current_chunk = []
    for element in root.find_all(['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'dt', 'dd']):
        text = element.get_text(separator=' ', strip=True)
        if not text: continue
        if element.name in ['h1', 'h2', 'h3']:
            if current_chunk:
                segments.append(" ".join(current_chunk))
                current_chunk = []
            current_chunk.append(f"[{text}]") 
        else:
            current_chunk.append(text)
        if len(" ".join(current_chunk)) > 800:
            segments.append(" ".join(current_chunk))
            current_chunk = []
    if current_chunk: segments.append(" ".join(current_chunk))
    return [s for s in segments if len(s) > 100]

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

        # Vectorize main text content into the shared latent space
        text_vector = visual_engine.encode(main_text[:5000]).tolist()

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
                    try:
                        # Since MPNet is text-only, we vectorize the Alt Text. 
                        # This allows images to be found via semantic keyword search.
                        img_vector = visual_engine.encode(alt[:1000]).tolist()
                    except Exception: continue

                    img_vectors.append({
                        "id": f"img_{img_url}_{img_count}",
                        "values": img_vector,
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

        # Index chunks with structured metadata
        for i, chunk in enumerate(chunks):
            if len(chunk) < 200: continue
            text_vector = visual_engine.encode(chunk).tolist()
            
            meta = {
                "url": url,
                "title": meta_data['title'] or "Untitled Result",
                "image": meta_data['image'],
                "text": chunk[:800],
                "indexed_at": "2026-05-26"
            }
            
            if structured_data.get("faqs"): meta["is_faq"] = "true"
            if structured_data.get("article_headline"): 
                meta["official_headline"] = structured_data["article_headline"][:200]

            index.upsert(vectors=[{
                "id": f"{url}_{i}", 
                "values": text_vector, 
                "metadata": meta
            }], namespace="default")
        
        return True

    except Exception as e:
        print(f"❌ [Indexer Error] {url}: {e}")
        return False