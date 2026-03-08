import streamlit as st
import math
import trafilatura
import time
import requests
from google import genai
from pinecone import Pinecone
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- 0. SECRETS & CONFIG ---
def load_secrets():
    """Checks Streamlit Secrets (Cloud) first, then falls back to config.py (Local)."""
    if "GEMINI_KEY" in st.secrets:
        return st.secrets["GEMINI_KEY"], st.secrets["PINECONE_KEY"], st.secrets["HF_TOKEN"]
    try:
        import config
        return config.GEMINI_KEY, config.PINECONE_KEY, config.HF_TOKEN
    except (ImportError, AttributeError):
        st.error("Missing Credentials: Set 'secrets.toml' in Streamlit or create 'config.py' locally.")
        st.stop()

GEMINI_KEY, PINECONE_KEY, HF_TOKEN = load_secrets()

# UPDATED: Using the new Router endpoint to fix HF Error 410
HF_ROUTER_URL = "https://router.huggingface.co/hf-inference/models/mistralai/Mistral-7B-Instruct-v0.3"
HF_HEADERS = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"}

RESULTS_PER_PAGE = 8
SEARCH_CONCURRENCY = 12 

# --- 1. UI/CSS OVERHAUL ---
st.set_page_config(page_title="Komu", layout="wide", initial_sidebar_state="collapsed")

st.markdown("""
    <style>
    #MainMenu {visibility: hidden;} footer {visibility: hidden;} header {visibility: hidden;}
    .block-container { padding-top: 2rem !important; max-width: 1200px !important; }
    div[data-baseweb="input"] > div { border-radius: 24px !important; border: 1px solid #dfe1e5 !important; padding: 4px 12px !important; transition: box-shadow 0.2s; }
    .image-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); grid-gap: 20px; padding: 20px 0; }
    .image-card { border-radius: 12px; overflow: hidden; background: #f8f9fa; border: 1px solid #dadce0; transition: transform 0.2s; }
    .image-card img { width: 100%; height: 160px; object-fit: cover; display: block; }
    .image-caption { padding: 10px; font-size: 13px; color: #3c4043; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .komu-logo-large { font-family: 'Product Sans', sans-serif; font-size: 90px; font-weight: 700; text-align: center; margin-top: 15vh; margin-bottom: 30px; letter-spacing: -2px; color: #4285f4; }
    .komu-logo-small { font-family: 'Product Sans', sans-serif; font-size: 32px; font-weight: 700; margin-top: -0.7rem; letter-spacing: -1px; color: #4285f4; }
    .ai-overview-card { background: linear-gradient(135deg, #f0f4f9 0%, #e8eaf6 100%); border: 1px solid #dadce0; border-radius: 16px; padding: 24px; margin-bottom: 30px; max-width: 652px; }
    .source-chip { display: inline-block; padding: 4px 12px; border-radius: 16px; background: white; border: 1px solid #dadce0; font-size: 12px; color: #1a0dab; text-decoration: none; margin-right: 8px; margin-top: 8px; font-weight: 500; }
    .source-chip:hover { background: #f1f3f4; border-color: #4285f4; }
    .ai-error-notice { padding: 12px; border-radius: 8px; border: 1px solid #ffccd5; background: #fff5f5; color: #d00000; font-size: 13px; margin-bottom: 20px; max-width: 652px; }
    .search-result { margin-bottom: 28px; max-width: 652px; }
    .result-title { font-size: 20px; color: #1a0dab; text-decoration: none; display: block; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .favicon { width: 18px; height: 18px; border-radius: 50%; vertical-align: middle; margin-right: 8px; }
    .site-path { font-size: 14px; color: #202124; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; max-width: 450px; }
    </style>
""", unsafe_allow_html=True)

# --- 2. ENGINE INIT ---
@st.cache_resource
def get_komu_engines():
    try:
        search_client = genai.Client(api_key=GEMINI_KEY)
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index("plex-index")
        return search_client, index
    except Exception as e:
        st.error(f"Engine Error: {e}")
        return None, None

search_client, index = get_komu_engines()

# --- 3. SESSION STATE ---
for key, val in [('results', []), ('image_results', []), ('query', ""), ('ai_overview', ""), ('page', 1), ('top_urls', []), ('ai_status', "idle"), ('ai_error', None)]:
    if key not in st.session_state: st.session_state[key] = val

# --- 4. UTILS ---
def fetch_content(url):
    try: 
        downloaded = trafilatura.fetch_url(url)
        return trafilatura.extract(downloaded) or ""
    except Exception:
        return ""

def query_ai_model(prompt):
    """Hybrid AI caller: Tries Mistral (HF) first, falls back to Gemini 1.5 Flash."""
    # Attempt 1: Hugging Face Router
    try:
        formatted_prompt = f"<s>[INST] {prompt} [/INST]"
        payload = {
            "inputs": formatted_prompt,
            "parameters": {"max_new_tokens": 500, "temperature": 0.7, "return_full_text": False},
            "options": {"wait_for_model": True}
        }
        response = requests.post(HF_ROUTER_URL, headers=HF_HEADERS, json=payload, timeout=15)
        if response.status_code == 200:
            res_json = response.json()
            return res_json[0]['generated_text'] if isinstance(res_json, list) else res_json.get('generated_text')
    except Exception:
        pass # Fallback to Gemini

    # Attempt 2: Gemini 1.5 Flash
    try:
        response = search_client.models.generate_content(
            model="gemini-1.5-flash",
            contents=prompt
        )
        return response.text
    except Exception as e:
        raise Exception(f"AI Generation failed: {str(e)}")

def parallel_search_worker(vector, top_k=60):
    return index.query(vector=vector, top_k=top_k, include_metadata=True)

def truncate_url(url, max_len=60):
    parsed = urlparse(url)
    display_url = f"{parsed.netloc}{parsed.path}"
    return (display_url[:max_len] + "...") if len(display_url) > max_len else display_url

# --- 5. UI LAYOUT ---
is_results_page = len(st.session_state.results) > 0 or len(st.session_state.query) > 0

if is_results_page:
    col_logo, col_search, _ = st.columns([1, 6, 2])
    with col_logo: st.markdown("<div class='komu-logo-small'>Komu</div>", unsafe_allow_html=True)
    with col_search: user_query = st.text_input("Search", value=st.session_state.query, key="search_bar", label_visibility="collapsed")
    tab_all, tab_images = st.tabs(["🔍 All", "🖼️ Images"])
    st.markdown("<hr style='margin-top: -15px; margin-bottom: 20px; border-color: #ebebeb;'>", unsafe_allow_html=True)
else:
    st.markdown("<div class='komu-logo-large'>Komu</div>", unsafe_allow_html=True)
    _, col_search, _ = st.columns([1, 4, 1])
    with col_search: user_query = st.text_input("Search", value=st.session_state.query, key="search_bar_home", label_visibility="collapsed")

# --- 6. SEARCH LOGIC ---
if user_query and user_query != st.session_state.query:
    with st.spinner("🚀 Searching..."):
        try:
            emb = search_client.models.embed_content(
                model="gemini-embedding-001", contents=user_query,
                config={"task_type": "RETRIEVAL_QUERY", "output_dimensionality": 768}
            )
            vector = emb.embeddings[0].values
            all_matches = []
            with ThreadPoolExecutor(max_workers=SEARCH_CONCURRENCY) as executor:
                futures = [executor.submit(parallel_search_worker, vector) for _ in range(SEARCH_CONCURRENCY)]
                for future in as_completed(futures):
                    all_matches.extend(future.result().get('matches', []))
            all_matches.sort(key=lambda x: x['score'], reverse=True)

            text_results, img_results, seen_urls = [], [], set()
            img_exts = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg')
            for m in all_matches:
                meta = m['metadata']
                url = meta.get('url', '').split('#')[0].rstrip('/')
                if not url or url in seen_urls: continue
                seen_urls.add(url)
                if meta.get('type') == 'image' or url.lower().endswith(img_exts):
                    img_results.append(meta)
                else:
                    text_results.append(meta)

            st.session_state.results = text_results
            st.session_state.image_results = img_results
            st.session_state.query = user_query
            st.session_state.page = 1
            st.session_state.top_urls = [r.get('url') for r in text_results[:4]]
            st.session_state.ai_overview = ""
            st.session_state.ai_status = "idle" 
            st.session_state.ai_error = None
            st.rerun()
        except Exception as e:
            st.error(f"Search Error: {e}")

# --- 7. DISPLAY RESULTS ---
if is_results_page:
    with tab_all:
        _, content_col = st.columns([0.2, 9.8])
        with content_col:
            # AI OVERVIEW
            if st.session_state.ai_overview:
                source_html = '<div style="margin-top:15px; border-top:1px solid #dadce0; padding-top:10px;"><div style="font-size:12px; color:#70757a; font-weight:600; margin-bottom:5px;">SOURCES:</div>'
                for s_url in st.session_state.top_urls:
                    s_dom = urlparse(s_url).netloc.replace('www.', '')
                    source_html += f'<a href="{s_url}" target="_blank" class="source-chip">{s_dom}</a>'
                source_html += '</div>'

                st.markdown(f"""
                    <div class="ai-overview-card">
                        <div style="color:#4285f4; font-weight:600; margin-bottom:10px; font-size: 14px; letter-spacing: 0.5px;">✨ AI OVERVIEW</div>
                        <div style="color: #202124; font-size: 15px; line-height: 1.6;">{st.session_state.ai_overview}</div>
                        {source_html}
                    </div>
                """, unsafe_allow_html=True)
            elif st.session_state.ai_error:
                st.markdown(f'<div class="ai-error-notice">⚠️ {st.session_state.ai_error}</div>', unsafe_allow_html=True)

            # TEXT RESULTS
            start = (st.session_state.page - 1) * RESULTS_PER_PAGE
            results_to_show = st.session_state.results[start:start+RESULTS_PER_PAGE]
            for p in results_to_show:
                raw_url = p.get('url', '')
                dom = urlparse(raw_url).netloc
                st.markdown(f"""
                    <div class="search-result">
                        <div style="margin-bottom:2px;">
                            <img src="https://icon.horse/icon/{dom}" class="favicon">
                            <span class="site-path">{truncate_url(raw_url)}</span>
                        </div>
                        <a class="result-title" href="{raw_url}" target="_blank">{p.get('title', 'Untitled')}</a>
                        <div style="color:#4d5156; font-size:14px; line-height:1.5;">{p.get('text', '')[:210]}...</div>
                    </div>
                """, unsafe_allow_html=True)

            # AI RESEARCH TRIGGER
            if st.session_state.ai_status == "idle" and st.session_state.top_urls:
                with st.status("🧠 Generating AI Overview...", expanded=False) as status:
                    try:
                        with ThreadPoolExecutor(max_workers=4) as exec:
                            full_txts = list(exec.map(fetch_content, st.session_state.top_urls))
                        
                        ctx = "\n\n".join([f"Source [{urlparse(st.session_state.top_urls[i]).netloc}]: {t[:900]}" for i, t in enumerate(full_txts) if t])
                        
                        if not ctx.strip():
                            raise ValueError("No readable text found in sources.")
                        
                        prompt = f"Summarize precisely: '{st.session_state.query}'. Use the following data:\n\n{ctx}"
                        
                        summary = query_ai_model(prompt)
                        st.session_state.ai_overview = summary
                        st.session_state.ai_status = "complete"
                        st.rerun() 
                    except Exception as e:
                        st.session_state.ai_error = f"AI Error: {str(e)}"
                        st.session_state.ai_status = "error"
                        status.update(label="⚠️ Thinking Failed", state="error")
                        st.rerun()

    with tab_images:
        if not st.session_state.image_results:
            st.info("No images found.")
        else:
            img_html = '<div class="image-container">'
            for img in st.session_state.image_results[:40]:
                src = img.get('image_url') or img.get('url')
                img_html += f"""
                    <div class="image-card">
                        <a href="{img.get('url')}" target="_blank">
                            <img src="{src}" onerror="this.src='https://placehold.co/400x300?text=Image+Unavailable'">
                        </a>
                        <div class="image-caption">{img.get('title', 'Image')}</div>
                    </div>
                """
            st.markdown(img_html + '</div>', unsafe_allow_html=True)