import streamlit as st
import trafilatura
import requests
import re
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

# Free Inference API - Mistral Nemo is very fast and capable
HF_MODEL_URL = "https://api-inference.huggingface.co/models/mistralai/Mistral-Nemo-Instruct-2407"
HF_HEADERS = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"}

# --- 1. UI/CSS OVERHAUL ---
st.set_page_config(page_title="Komu Scout", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
    <style>
    #MainMenu {visibility: hidden;} footer {visibility: hidden;} header {visibility: hidden;}
    .block-container { padding-top: 2rem !important; max-width: 1100px !important; }
    
    div[data-baseweb="input"] > div { 
        border-radius: 24px !important; 
        border: 1px solid #dfe1e5 !important; 
        padding: 4px 12px !important; 
    }
    
    .komu-logo-large { font-family: 'Product Sans', sans-serif; font-size: 85px; font-weight: 700; text-align: center; margin-top: 8vh; margin-bottom: 30px; letter-spacing: -2px; color: #4285f4; }
    
    .ai-overview-card { 
        background: linear-gradient(135deg, #f0f4f9 0%, #e8eaf6 100%); 
        border: 1px solid #dadce0; 
        border-radius: 16px; 
        padding: 24px; 
        margin-bottom: 30px; 
        max-width: 800px; 
    }
    .source-chip { 
        display: inline-block; padding: 4px 12px; border-radius: 16px; background: white; 
        border: 1px solid #dadce0; font-size: 11px; color: #1a0dab; text-decoration: none; 
        margin-right: 8px; margin-top: 8px; font-weight: 500; 
    }
    
    .search-result { margin-bottom: 32px; max-width: 700px; }
    .result-title { font-size: 20px; color: #1a0dab; text-decoration: none; display: block; font-weight: 500; line-height: 1.3; margin-bottom: 4px; }
    .result-title:hover { text-decoration: underline; }
    
    .site-path { display: flex; align-items: center; margin-bottom: 4px; }
    .favicon { width: 18px; height: 18px; border-radius: 50%; margin-right: 8px; }
    .site-path-text { font-size: 14px; color: #202124; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    
    /* Google-Style Sub-results Grouping */
    .sub-results-container { margin-top: 12px; padding-left: 20px; border-left: 2px solid #dadce0; margin-left: 8px; }
    .sub-result { margin-bottom: 12px; }
    .sub-result:last-child { margin-bottom: 0; }
    .sub-result-title { font-size: 16px; color: #1a0dab; text-decoration: none; display: block; margin-bottom: 2px; }
    .sub-result-title:hover { text-decoration: underline; }

    .image-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); grid-gap: 15px; }
    .image-card { border-radius: 8px; overflow: hidden; border: 1px solid #dadce0; height: 150px; }
    .image-card img { width: 100%; height: 100%; object-fit: cover; }
    </style>
""", unsafe_allow_html=True)

# --- 2. ENGINE INIT ---
@st.cache_resource
def get_komu_engines():
    try:
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index("plex-index")
        embed_model = SentenceTransformer('all-mpnet-base-v2')
        return index, embed_model
    except Exception as e:
        st.error(f"Engine Initialization Error: {e}")
        return None, None

index, embed_model = get_komu_engines()

# --- 3. SESSION STATE ---
for key, val in [('results', []), ('image_results', []), ('query', ""), ('ai_overview', ""), ('top_urls', []), ('ai_status', "idle")]:
    if key not in st.session_state: st.session_state[key] = val

# --- 4. UTILS ---
def shorten_url(url, max_length=65):
    """Truncates long URLs and adds an ellipsis."""
    url = url.replace("https://", "").replace("http://", "").rstrip('/')
    if len(url) > max_length:
        return url[:max_length] + "..."
    return url

def clean_title(url, title):
    if title and title.lower() not in ["untitled result", "untitled", "home", "none"]:
        return title
    parsed = urlparse(url)
    domain = parsed.netloc.replace('www.', '')
    path = parsed.path.strip('/').split('/')[-1]
    if path:
        return f"{path.replace('-', ' ').replace('_', ' ').title()} | {domain.split('.')[0].title()}"
    return domain.title()

def fetch_content(url):
    try: 
        downloaded = trafilatura.fetch_url(url)
        return trafilatura.extract(downloaded) or ""
    except: return ""

def query_huggingface(prompt):
    try:
        payload = {"inputs": f"<s>[INST] {prompt} [/INST]", "parameters": {"max_new_tokens": 450, "temperature": 0.2}}
        response = requests.post(HF_MODEL_URL, headers=HF_HEADERS, json=payload, timeout=12)
        if response.status_code == 200:
            res = response.json()
            raw = res[0]['generated_text'] if isinstance(res, list) else res.get('generated_text')
            return raw.split("[/INST]")[-1].strip()
    except: return "Summary unavailable. The AI model is currently under heavy load."
    return "Could not generate summary."

# --- 5. SEARCH LOGIC ---
def run_search(query):
    with st.spinner("Scouting..."):
        try:
            vector = embed_model.encode(query).tolist()
            # Fetch more matches so we have enough data to group
            query_res = index.query(vector=vector, top_k=80, include_metadata=True)
            
            domain_map = {}
            ordered_domains = []
            img_results, seen_urls = [], set()
            
            for m in query_res.get('matches', []):
                meta = m['metadata']
                url = meta.get('url', '').split('#')[0].rstrip('/')
                if not url or url in seen_urls: continue
                seen_urls.add(url)
                
                domain = urlparse(url).netloc
                meta['title'] = clean_title(url, meta.get('title'))
                
                if meta.get('type') == 'image' or url.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                    img_results.append(meta)
                else:
                    # DOMAIN GROUPING LOGIC (Max 5 per domain)
                    if domain not in domain_map:
                        domain_map[domain] = []
                        ordered_domains.append(domain) # Preserves Pinecone's best-match ranking
                    
                    if len(domain_map[domain]) < 5:
                        domain_map[domain].append(meta)

            # Structure the grouped results
            grouped_results = []
            for d in ordered_domains:
                group = domain_map[d]
                grouped_results.append({
                    'domain': d,
                    'main': group[0], # Best match for this domain
                    'subs': group[1:] # Up to 4 extra matches
                })

            st.session_state.results = grouped_results
            st.session_state.image_results = img_results
            st.session_state.query = query
            # Get the top 4 unique domains for the AI overview
            st.session_state.top_urls = [g['main'].get('url') for g in grouped_results[:4]]
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
        query_input = st.text_input("Search", placeholder="Search GitHub, news, or articles...", label_visibility="collapsed")
        if query_input: run_search(query_input)
else:
    col_logo, col_search, _ = st.columns([1, 6, 2])
    with col_logo: 
        if st.button("Komu", key="logo_btn"):
            st.session_state.results, st.session_state.query = [], ""
            st.rerun()
    with col_search:
        query_input = st.text_input("Search", value=st.session_state.query, label_visibility="collapsed")
        if query_input and query_input != st.session_state.query: run_search(query_input)
    
    tab_all, tab_images = st.tabs(["🔍 All", "🖼️ Images"])

    with tab_all:
        col_pad, col_main = st.columns([0.1, 9.9])
        with col_main:
            # AI OVERVIEW
            if st.session_state.ai_status == "idle" and st.session_state.top_urls:
                with st.status("🧠 Hugging Face Analysis...", expanded=False):
                    with ThreadPoolExecutor(max_workers=4) as exec:
                        contents = list(exec.map(fetch_content, st.session_state.top_urls))
                    ctx = "\n\n".join([f"Source: {c[:800]}" for c in contents if len(c) > 150])
                    if ctx:
                        st.session_state.ai_overview = query_huggingface(f"Analyze: '{st.session_state.query}'. Summary:\n\n{ctx}")
                    else:
                        st.session_state.ai_overview = "I couldn't extract enough text from these pages to provide a summary. Please check the links directly."
                st.session_state.ai_status = "complete"
                st.rerun()

            if st.session_state.ai_overview:
                st.markdown(f"""
                    <div class="ai-overview-card">
                        <div style="color:#4285f4; font-weight:600; margin-bottom:10px; font-size: 14px;">✨ AI OVERVIEW</div>
                        <div style="color: #202124; font-size: 15px; line-height: 1.6;">{st.session_state.ai_overview}</div>
                        <div style="margin-top:15px; border-top:1px solid #dadce0; padding-top:10px;">
                            {''.join([f'<a href="{u}" target="_blank" class="source-chip">{urlparse(u).netloc}</a>' for u in st.session_state.top_urls])}
                        </div>
                    </div>
                """, unsafe_allow_html=True)

            # RENDER GROUPED RESULTS
            for group in st.session_state.results[:15]: # Show top 15 domains
                main_res = group['main']
                dom = group['domain']
                subs = group['subs']
                
                # Main Result HTML
                html_block = f"""
                    <div class="search-result">
                        <div class="site-path">
                            <img src="https://icon.horse/icon/{dom}" class="favicon">
                            <span class="site-path-text">{shorten_url(main_res.get('url'))}</span>
                        </div>
                        <a class="result-title" href="{main_res.get('url')}" target="_blank">{main_res.get('title')}</a>
                        <div style="color:#4d5156; font-size:14px;">{main_res.get('text', '')[:230]}...</div>
                """
                
                # Render Sub-results if they exist
                if subs:
                    html_block += '<div class="sub-results-container">'
                    for sub in subs:
                        html_block += f"""
                            <div class="sub-result">
                                <a class="sub-result-title" href="{sub.get('url')}" target="_blank">{sub.get('title')}</a>
                                <div class="site-path-text" style="color:#5f6368; font-size:13px;">{shorten_url(sub.get('url'), 65)}</div>
                            </div>
                        """
                    html_block += '</div>'
                
                html_block += "</div>"
                st.markdown(html_block, unsafe_allow_html=True)

    with tab_images:
        if st.session_state.image_results:
            img_html = '<div class="image-container">'
            for img in st.session_state.image_results[:30]:
                src = img.get('image_url') or img.get('url')
                img_html += f'<div class="image-card"><a href="{img.get("url")}" target="_blank"><img src="{src}" onerror="this.src=\'https://placehold.co/400x300?text=Preview+Error\'"></a></div>'
            st.markdown(img_html + "</div>", unsafe_allow_html=True)