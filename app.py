import streamlit as st
import trafilatura
import requests
from pinecone import Pinecone
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor
from sentence_transformers import SentenceTransformer

# --- 0. SECRETS & CONFIG ---
def load_secrets():
    """Checks Streamlit Secrets (Cloud) first, then falls back to local config."""
    if "PINECONE_KEY" in st.secrets:
        return (
            st.secrets["PINECONE_KEY"], 
            st.secrets.get("HF_TOKEN", "") 
        )
    try:
        import config
        return config.PINECONE_KEY, config.HF_TOKEN
    except (ImportError, AttributeError):
        st.error("Missing Credentials: Set 'secrets.toml' in Streamlit or 'config.py' locally.")
        st.stop()

PINECONE_KEY, HF_TOKEN = load_secrets()

# --- FREE AI MODEL CONFIG ---
# Using Mistral-Nemo for high-quality, fast, free inference
HF_MODEL_URL = "https://api-inference.huggingface.co/models/mistralai/Mistral-Nemo-Instruct-2407"
HF_HEADERS = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"}

# --- 1. UI/CSS OVERHAUL ---
st.set_page_config(page_title="Komu Scout", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
    <style>
    #MainMenu {visibility: hidden;} footer {visibility: hidden;} header {visibility: hidden;}
    .block-container { padding-top: 2rem !important; max-width: 1200px !important; }
    
    div[data-baseweb="input"] > div { 
        border-radius: 24px !important; 
        border: 1px solid #dfe1e5 !important; 
        padding: 4px 12px !important; 
    }
    
    .komu-logo-large { font-family: 'Product Sans', sans-serif; font-size: 90px; font-weight: 700; text-align: center; margin-top: 10vh; margin-bottom: 30px; letter-spacing: -2px; color: #4285f4; }
    .komu-logo-small { font-family: 'Product Sans', sans-serif; font-size: 32px; font-weight: 700; margin-top: -0.7rem; letter-spacing: -1px; color: #4285f4; cursor: pointer; }
    
    .ai-overview-card { 
        background: linear-gradient(135deg, #f0f4f9 0%, #e8eaf6 100%); 
        border: 1px solid #dadce0; 
        border-radius: 16px; 
        padding: 24px; 
        margin-bottom: 30px; 
        max-width: 750px; 
    }
    .source-chip { 
        display: inline-block; padding: 4px 12px; border-radius: 16px; background: white; 
        border: 1px solid #dadce0; font-size: 12px; color: #1a0dab; text-decoration: none; 
        margin-right: 8px; margin-top: 8px; font-weight: 500; 
    }
    
    .search-result { margin-bottom: 28px; max-width: 652px; }
    .result-title { font-size: 20px; color: #1a0dab; text-decoration: none; display: block; margin-bottom: 2px; }
    .site-path { font-size: 14px; color: #202124; display: inline-block; max-width: 450px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .favicon { width: 18px; height: 18px; border-radius: 50%; vertical-align: middle; margin-right: 8px; }

    .image-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); grid-gap: 15px; }
    .image-card { border-radius: 8px; overflow: hidden; border: 1px solid #dadce0; }
    .image-card img { width: 100%; height: 150px; object-fit: cover; }
    </style>
""", unsafe_allow_html=True)

# --- 2. ENGINE INIT ---
@st.cache_resource
def get_komu_engines():
    try:
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index("plex-index")
        # Switching to a faster, lighter embedding model for free-tier performance
        embed_model = SentenceTransformer('all-MiniLM-L6-v2')
        return index, embed_model
    except Exception as e:
        st.error(f"Engine Initialization Error: {e}")
        return None, None

index, embed_model = get_komu_engines()

# --- 3. SESSION STATE ---
for key, val in [('results', []), ('image_results', []), ('query', ""), ('ai_overview', ""), ('top_urls', []), ('ai_status', "idle")]:
    if key not in st.session_state: st.session_state[key] = val

# --- 4. UTILS ---
def fetch_content(url):
    try: 
        downloaded = trafilatura.fetch_url(url)
        return trafilatura.extract(downloaded) or ""
    except: return ""

def query_huggingface(prompt):
    """Call the free Hugging Face Inference API."""
    try:
        payload = {
            "inputs": f"<s>[INST] {prompt} [/INST]", 
            "parameters": {"max_new_tokens": 512, "temperature": 0.3}
        }
        response = requests.post(HF_MODEL_URL, headers=HF_HEADERS, json=payload, timeout=15)
        if response.status_code == 200:
            res = response.json()
            # Handle different return formats from HF API
            raw_text = res[0]['generated_text'] if isinstance(res, list) else res.get('generated_text')
            # Clean up the prompt if the model repeats it
            return raw_text.split("[/INST]")[-1].strip()
    except Exception as e:
        return f"Scout AI is temporarily unavailable. Error: {str(e)}"
    return "Could not generate summary."

# --- 5. SEARCH LOGIC ---
def run_search(query):
    with st.spinner("Scouting the web..."):
        try:
            vector = embed_model.encode(query).tolist()
            query_res = index.query(vector=vector, top_k=40, include_metadata=True)
            
            text_results, img_results, seen_urls = [], [], set()
            for m in query_res.get('matches', []):
                meta = m['metadata']
                url = meta.get('url', '').split('#')[0].rstrip('/')
                if not url or url in seen_urls: continue
                seen_urls.add(url)
                
                if meta.get('type') == 'image' or url.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                    img_results.append(meta)
                else:
                    text_results.append(meta)

            st.session_state.results = text_results
            st.session_state.image_results = img_results
            st.session_state.query = query
            st.session_state.top_urls = [r.get('url') for r in text_results[:4]]
            st.session_state.ai_overview = ""
            st.session_state.ai_status = "idle"
            st.rerun()
        except Exception as e:
            st.error(f"Search failed: {e}")

# --- 6. UI LAYOUT ---
is_results_page = len(st.session_state.results) > 0 or len(st.session_state.query) > 0

if not is_results_page:
    st.markdown("<div class='komu-logo-large'>Komu</div>", unsafe_allow_html=True)
    _, col_search, _ = st.columns([1, 4, 1])
    with col_search:
        query_input = st.text_input("Search the web", placeholder="Search for GitHub, news, or useful sites...", label_visibility="collapsed")
        if query_input: run_search(query_input)
else:
    col_logo, col_search, _ = st.columns([1, 6, 2])
    with col_logo: 
        if st.button("Komu", key="logo_btn"):
            st.session_state.results = []
            st.session_state.query = ""
            st.rerun()
    with col_search:
        query_input = st.text_input("Search", value=st.session_state.query, label_visibility="collapsed")
        if query_input and query_input != st.session_state.query: run_search(query_input)
    
    tab_all, tab_images = st.tabs(["🔍 All", "🖼️ Images"])

    with tab_all:
        col_pad, col_main = st.columns([0.2, 9.8])
        with col_main:
            # AI OVERVIEW TRIGGER
            if st.session_state.ai_status == "idle" and st.session_state.top_urls:
                with st.status("🧠 Hugging Face Deep Dive...", expanded=False):
                    with ThreadPoolExecutor(max_workers=4) as exec:
                        contents = list(exec.map(fetch_content, st.session_state.top_urls))
                    
                    ctx = "\n\n".join([f"Source {i+1}: {c[:900]}" for i, c in enumerate(contents) if c])
                    if ctx:
                        prompt = f"Topic: '{st.session_state.query}'. Instructions: Write a concise, 3-sentence summary based strictly on these snippets:\n\n{ctx}"
                        st.session_state.ai_overview = query_huggingface(prompt)
                    st.session_state.ai_status = "complete"
                    st.rerun()

            if st.session_state.ai_overview:
                st.markdown(f"""
                    <div class="ai-overview-card">
                        <div style="color:#4285f4; font-weight:600; margin-bottom:10px; font-size: 14px;">✨ AI OVERVIEW</div>
                        <div style="color: #202124; font-size: 15px; line-height: 1.6;">{st.session_state.ai_overview}</div>
                        <div style="margin-top:15px; border-top:1px solid #dadce0; padding-top:10px;">
                            <div style="font-size:11px; color:#70757a; font-weight:700; margin-bottom:5px;">SOURCES</div>
                            {''.join([f'<a href="{u}" target="_blank" class="source-chip">{urlparse(u).netloc}</a>' for u in st.session_state.top_urls])}
                        </div>
                    </div>
                """, unsafe_allow_html=True)

            for res in st.session_state.results[:12]:
                dom = urlparse(res.get('url')).netloc
                st.markdown(f"""
                    <div class="search-result">
                        <div style="margin-bottom:2px;">
                            <img src="https://icon.horse/icon/{dom}" class="favicon">
                            <span class="site-path">{res.get('url')[:65]}</span>
                        </div>
                        <a class="result-title" href="{res.get('url')}" target="_blank">{res.get('title', 'Untitled Result')}</a>
                        <div style="color:#4d5156; font-size:14px;">{res.get('text', '')[:220]}...</div>
                    </div>
                """, unsafe_allow_html=True)

    with tab_images:
        if st.session_state.image_results:
            img_html = '<div class="image-container">'
            for img in st.session_state.image_results[:30]:
                src = img.get('image_url') or img.get('url')
                img_html += f"""
                    <div class="image-card">
                        <a href="{img.get('url')}" target="_blank">
                            <img src="{src}" onerror="this.src='https://placehold.co/400x300?text=Image+Not+Found'">
                        </a>
                    </div>"""
            st.markdown(img_html + "</div>", unsafe_allow_html=True)