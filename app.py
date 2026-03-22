import streamlit as st
import trafilatura
import requests
import re
import json
import os
import datetime
import ssl
import urllib3

# --- NETWORK/SSL PATCH ---
os.environ['CURL_CA_BUNDLE'] = ''
os.environ["GRPC_SSL_CIPHER_SUITES"] = "HIGH+ECDSA"
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
try:
    _create_unverified_https_context = ssl._create_unverified_context
    ssl._create_default_https_context = _create_unverified_https_context
except AttributeError: pass

from pinecone import Pinecone
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor
from sentence_transformers import SentenceTransformer
from huggingface_hub import InferenceClient

st.set_page_config(page_title="Komu Scout", layout="wide", initial_sidebar_state="collapsed")

# --- 0. CONFIG & FILTERING ---
AUTHORITY_DOMAINS = [
    "wikipedia.org", "britannica.com", "reuters.com", "bbc.com", 
    "nytimes.com", "nature.com", "plato.stanford.edu", "gov", "edu"
]

BLOCKED_DOMAINS = ["facebook.com", "instagram.com", "t.me", "linkedin.com"]

try:
    import extra_streamlit_components as stx
except ImportError:
    stx = None
    # Persistence will be disabled if library is missing

def load_secrets():
    try:
        # Streamlit automatically looks in .streamlit/secrets.toml
        return (
            st.secrets.get("PINECONE_KEY"), 
            st.secrets.get("HF_TOKEN", ""),
            st.secrets.get("GOOGLE_CLIENT_ID"),
            st.secrets.get("GOOGLE_CLIENT_SECRET"),
            st.secrets.get("REDIRECT_URI"),
            st.secrets.get("FIREBASE_API_KEY"),
            st.secrets.get("FIREBASE_PROJECT_ID")
        )
    except Exception as e:
        st.error(f"Error loading secrets: {e}")
        return None, None, None, None, None, None, None

# Initialize the variables
PINECONE_KEY, HF_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI, FIREBASE_API_KEY, FIREBASE_PROJECT_ID = load_secrets()

client = InferenceClient(api_key=HF_TOKEN)

# --- 0.1 FIREBASE & OAUTH ---
FIRESTORE_URL = f"https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/databases/(default)/documents" if FIREBASE_PROJECT_ID else None

def get_history(username):
    if not username or not FIREBASE_API_KEY: return []
    safe_user = re.sub(r'[^a-zA-Z0-9]', '_', username)
    url = f"{FIRESTORE_URL}/user_history/{safe_user}?key={FIREBASE_API_KEY}"
    try:
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            raw_list = data.get('fields', {}).get('history', {}).get('arrayValue', {}).get('values', [])
            return [x.get('stringValue') for x in raw_list if 'stringValue' in x]
    except Exception: pass
    return []

def save_history(username, query):
    if not query or not username or not FIREBASE_API_KEY: return
    safe_user = re.sub(r'[^a-zA-Z0-9]', '_', username)
    
    current = get_history(username)
    if query in current: current.remove(query)
    current.insert(0, query)
    current = current[:20]
    
    values = [{"stringValue": q} for q in current]
    payload = {"fields": {"history": {"arrayValue": {"values": values}}}}
    
    url = f"{FIRESTORE_URL}/user_history/{safe_user}?key={FIREBASE_API_KEY}"
    try: requests.patch(url, json=payload, timeout=5)
    except Exception: pass

def get_google_oauth_login_url():
    if not all([GOOGLE_CLIENT_ID, REDIRECT_URI]): return None
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline"
    }
    qs = requests.compat.urlencode(params)
    return f"https://accounts.google.com/o/oauth2/v2/auth?{qs}"

def sort_history(history, query):
    """Sorts history to put most alike content on top."""
    if not query: return history
    q = query.lower()
    # Sort by: Starts with query -> Contains query -> Recent
    return sorted(history, key=lambda x: (not x.lower().startswith(q), not q in x.lower()))

# --- 1. UI/CSS OVERHAUL ---
st.markdown("""
    <style>
    #MainMenu {visibility: hidden;} footer {visibility: hidden;} header {visibility: hidden;}
    .block-container { padding-top: 2rem !important; max-width: 1100px !important; }
    
    div[data-baseweb="input"] > div { 
        border-radius: 24px !important; 
        border: 1px solid #dfe1e5 !important; 
        padding: 4px 12px !important; 
        box-shadow: 0 1px 6px rgba(32,33,36,0.28);
    }
    
    .komu-logo-large { font-family: 'Product Sans', sans-serif; font-size: 85px; font-weight: 700; text-align: center; margin-top: 8vh; margin-bottom: 30px; letter-spacing: -2px; color: #4285f4; }
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;600;700&display=swap');
    
    .komu-logo-large { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 80px; font-weight: 800; text-align: center; margin-top: 8vh; margin-bottom: 20px; letter-spacing: -2px; background: linear-gradient(135deg, #4285f4, #d96570); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    
    /* Login Styles */
    .login-container { display: flex; justify-content: center; align-items: center; height: 60vh; flex-direction: column; }
    .login-card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; width: 400px; border: 1px solid #dadce0; }
    .login-title { font-size: 24px; font-weight: 500; margin-bottom: 20px; color: #202124; }
    .login-container { display: flex; justify-content: center; align-items: center; height: 70vh; flex-direction: column; font-family: 'Plus Jakarta Sans', sans-serif; }
    .login-card { background: white; padding: 40px; border-radius: 24px; box-shadow: 0 10px 40px rgba(0,0,0,0.08); text-align: center; width: 380px; border: 1px solid #eaeaea; }
    .login-title { font-size: 2.2rem; font-weight: 800; margin-bottom: 8px; background: linear-gradient(135deg, #4285f4, #d96570); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .login-sub { color: #5f6368; margin-bottom: 30px; font-size: 15px; }
    
    /* Popover/Profile Styles */
    div[data-testid="stPopover"] > button {
        border: none;
        background-color: transparent;
    }

    /* Mock Google Button Style */
    div.stButton > button {
        width: 100%;
        border-radius: 30px;
        border: 1px solid #dadce0;
        background-color: white;
        color: #3c4043;
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-weight: 600;
        font-size: 14px;
        padding: 10px 0;
        transition: all 0.2s;
    }
    div.stButton > button:hover {
        background-color: #f7f8f8;
        border-color: #d2e3fc;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        color: #1a73e8;
    }
    
    /* History Styles */
    .history-container {
        background: white;
        border: 1px solid #dfe1e5;
        border-top: none;
        border-radius: 0 0 24px 24px;
        box-shadow: 0 4px 6px rgba(32,33,36,0.28);
        margin-top: -24px; /* Pulls the container up under the search bar */
        padding: 8px 0;
        position: relative;
        z-index: 1000;
        width: 100%;
        overflow: hidden; /* Ensures children conform to border-radius */
    }
    .history-container .stButton button {
        border: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        background-color: transparent !important;
        color: #3c4043 !important;
        text-align: left !important;
        font-weight: 400 !important;
        padding: 8px 20px !important;
        font-size: 16px !important;
    }
    .history-container .stButton button:hover {
        background-color: #f1f3f4 !important;
        color: #202124 !important;
        border-color: transparent !important;
    }
    .ai-overview-card { 
        background: #ffffff;
        border: 1px solid #dadce0;
        border-radius: 18px; 
        padding: 24px; 
        margin-bottom: 30px; 
        max-width: 800px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        font-family: 'Plus Jakarta Sans', sans-serif;
    }
    .ai-content {
        max-height: 350px;
        overflow-y: auto;
        scrollbar-width: thin;
        padding-right: 10px;
    }
    .ai-content::-webkit-scrollbar { width: 6px; }
    .ai-content::-webkit-scrollbar-thumb { background-color: #dfe1e5; border-radius: 10px; }
    
    .source-chip { 
        display: inline-block; padding: 4px 10px; border-radius: 18px; background: #fff; 
        border: 1px solid #dfe1e5; font-size: 11px; color: #202124; text-decoration: none; 
        margin-right: 6px; margin-top: 6px; font-weight: 500; 
    }
    .source-chip:hover { background: #f1f3f4; }
    
    .search-result { margin-bottom: 26px; max-width: 650px; font-family: arial, sans-serif; }
    .result-title { font-size: 20px; color: #1a0dab; text-decoration: none; display: block; font-weight: 400; line-height: 1.3; margin-top: 5px; margin-bottom: 3px; }
    .result-title:hover { text-decoration: underline; }
    
    .site-path { display: flex; align-items: center; margin-bottom: 6px; white-space: nowrap; }
    .favicon { width: 28px; height: 28px; border-radius: 50%; margin-right: 12px; background: #f1f3f4; padding: 4px; object-fit: contain; flex-shrink: 0; }
    .site-header-text { display: flex; flex-direction: column; justify-content: center; }
    .site-name { font-size: 14px; color: #202124; font-weight: 400; line-height: 1.3; }
    .site-url { font-size: 12px; color: #4d5156; line-height: 1.3; }
    .result-snippet { font-size: 14px; color: #4d5156; line-height: 1.58; }
    
    .sub-results-container { margin-top: 8px; padding-left: 15px; border-left: 3px solid #dfe1e5; }
    .sub-result { margin-bottom: 6px; }
    .sub-result-title { font-size: 14px; color: #1a0dab; text-decoration: none; display: block; }

    .image-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); grid-gap: 15px; }
    .image-card { border-radius: 12px; overflow: hidden; height: 150px; background: #f1f3f4; }
    .image-card img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.2s; }
    .image-card img:hover { transform: scale(1.05); }
    
    /* --- INSTANT ANSWER CARD --- */
    .ia-card { background: white; border: 1px solid #dfe1e5; border-radius: 12px; padding: 24px; margin-bottom: 30px; box-shadow: 0 1px 2px rgba(60,64,67,0.1); font-family: 'Product Sans', sans-serif; max-width: 800px; margin-top: 10px; }
    .ia-sub { color: #70757a; font-size: 14px; margin-bottom: 8px; font-weight: 400; font-family: 'Google Sans', sans-serif; }
    .ia-title { font-size: 32px; color: #202124; line-height: 1.2; margin-bottom: 8px; font-weight: 400; }
    .ia-fact { font-size: 42px; color: #202124; font-weight: 400; margin-bottom: 5px; }
    .ia-text { font-size: 16px; color: #4d5156; line-height: 1.6; }
    .ia-flex { display: flex; justify-content: space-between; gap: 24px; align-items: start; }
    .ia-content { flex: 1; }
    .ia-img { width: 120px; height: 120px; border-radius: 12px; object-fit: cover; border: 1px solid #f1f3f4; }
    .ia-link { font-size: 14px; margin-top: 12px; display: block; color: #1a0dab; text-decoration: none; }
    .ia-calc { font-family: 'Courier New', monospace; font-size: 36px; padding: 10px 0; letter-spacing: -1px; }
    </style>
""", unsafe_allow_html=True)

# --- 2. ENGINE INIT ---
@st.cache_resource
def get_komu_engines():
    try:
        if not PINECONE_KEY: return None, None
        pc = Pinecone(api_key=PINECONE_KEY)
        index = pc.Index("plex-index")
        embed_model = SentenceTransformer('all-mpnet-base-v2')
        return index, embed_model
    except Exception as e:
        st.error(f"Engine Init Error: {e}")
        return None, None

index, embed_model = get_komu_engines()

# --- 3. SESSION STATE ---
for key, val in [
    ('results', []), 
    ('image_results', []), 
    ('query', ""), 
    ('ai_overview', ""), 
    ('top_urls', []),
    ('ai_status', "idle"),
    ('user_info', None), # Will store {'name': ..., 'email': ..., 'picture': ...}
    ('instant_answer', None),
    ('error_log', [])
]:
    if key not in st.session_state: st.session_state[key] = val

# --- 3.1 COOKIE MANAGER (PERSISTENCE) ---
cookie_manager = None
if stx:
    # Initialize Cookie Manager
    cookie_manager = stx.CookieManager(key="komu_auth_cookies")
    
    # Attempt to load user from cookie if session is empty (Auto-Login)
    if not st.session_state.user_info:
        cookie_user = cookie_manager.get("komu_user_session")
        if cookie_user:
            st.session_state.user_info = cookie_user

# --- 4. UTILS & RERANKING ---
def shorten_url(url, max_length=60):
    if not url: return ""
    clean = url.replace("https://", "").replace("http://", "").rstrip('/')
    return (clean[:max_length] + "...") if len(clean) > max_length else clean

def clean_title(url, title):
    if title and title.lower() not in ["untitled", "home", "none", "index", "null"]:
        return title
    if not url: return "No Title"
    parsed = urlparse(url)
    domain = parsed.netloc.replace('www.', '')
    path = parsed.path.strip('/').split('/')[-1]
    name = path.replace('-', ' ').replace('_', ' ').title() if path else domain.split('.')[0].title()
    return f"{name} | {domain.split('.')[0].title()}"

def fetch_content(url):
    try:
        # Trafilatura fetch with internal timeout usually works, but we rely on executor to not hang
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            return trafilatura.extract(downloaded) or ""
    except: pass
    return ""

def rerank_results(matches, query):
    q_lower = query.lower().strip()
    refined = []
    
    for m in matches:
        meta = m.get('metadata', {})
        url = meta.get('url', '').lower()
        title = meta.get('title', '').lower()
        domain = urlparse(url).netloc.lower()
        
        if any(blocked in domain for blocked in BLOCKED_DOMAINS): continue
            
        score = m.get('score', 0)
        
        # Boosts
        if q_lower in domain: score += 1.5
        if q_lower in title: score += 0.5
        if any(auth in domain for auth in AUTHORITY_DOMAINS): score += 0.3
        if len([s for s in urlparse(url).path.split('/') if s]) <= 1: score += 0.2
            
        m['custom_score'] = score
        refined.append(m)
    
    return sorted(refined, key=lambda x: x['custom_score'], reverse=True)

def query_huggingface(prompt):
    if not HF_TOKEN: return "⚠️ AI Key missing. Check configuration."
    if not prompt or len(prompt) < 50: return "Not enough context found to generate a summary."
    
    try:
        # Using InferenceClient for robust routing and error handling
        response = client.chat.completions.create(
            model="meta-llama/Llama-3.2-1B-Instruct", 
            messages=[
                {"role": "system", "content": "You are a helpful, intelligent search assistant. Provide a comprehensive, detailed, and well-structured answer based on the provided context. Use paragraphs and bullet points to organize the information effectively. Do not be too brief."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=1000,
            stream=False
        )
        return response.choices[0].message.content
    except Exception as e:
        st.session_state.error_log.append(f"AI Connection Exception: {str(e)}")
        return f"AI Error: {str(e)[:100]}"

def get_instant_answer(query):
    """Determine if the query has a factual direct answer (Time, Date, Math, Wiki Entity)."""
    raw_q = query.strip()
    q = raw_q.lower().strip().rstrip('?.')
    
    # 1. Date & Time
    now = datetime.datetime.now()
    # More robust check for date phrases
    if ("date" in q and ("today" in q or "current" in q or "now" in q)) or q in ["todays date"]:
        return {"type": "fact", "sub": "Current Date", "title": now.strftime("%A, %B %d, %Y"), "desc": ""}
    
    if any(x in q for x in ["time", "clock"]) and ("current" in q or "now" in q or "what" in q or "local" in q):
        return {"type": "fact", "sub": "Current Time", "title": now.strftime("%I:%M %p"), "desc": getattr(now.astimezone().tzinfo, 'key', 'Local Time')}

    # 2. Math (Calculator) - Simple whitelist for safety
    if re.match(r'^[\d\.\s\+\-\*\/\(\)]+$', q):
        if re.search(r'[\+\-\*\/]', q) and len(q) < 50:
            try:
                # Restricted eval
                res = eval(q, {"__builtins__": None}, {})
                # Format integers cleanly
                val = f"{int(res)}" if res == int(res) else f"{res:.3f}"
                return {"type": "fact", "sub": "Calculator", "title": val, "desc": f"{raw_q} ="}
            except: pass

    # 3. Knowledge Graph (Wikipedia)
    try:
        # Pre-process: Strip "who is", "what is" to improve hit rate (e.g. "who is avatar's son" -> "avatar's son")
        # Improved regex to handle "what's", "who's", and other variations
        clean_search = re.sub(r"^(what|who|where|when|why|how)(?:'s|\s+is|\s+are|\s+was|\s+were|\s+do|\s+does)\s+", "", q).strip()

        # Wikipedia requires a User-Agent or it blocks the request
        headers = {'User-Agent': 'KomuScout/1.0 (Educational Project)'}
        api = "https://en.wikipedia.org/w/api.php"
        
        search_res = requests.get(api, headers=headers, params={"action": "query", "list": "search", "srsearch": clean_search, "format": "json", "srlimit": 1}, timeout=2.0).json()
        
        if search_res.get('query', {}).get('search'):
            title = search_res['query']['search'][0]['title']
            # Get summary
            summary = requests.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{requests.utils.quote(title)}", headers=headers, timeout=2.0).json()
            
            if 'extract' in summary and summary.get('type') != 'disambiguation':
                if "refer to:" in summary.get('extract', ''): return None
                return {
                    "type": "entity", "title": summary.get('title'), "sub": summary.get('description', 'About'),
                    "text": summary.get('extract'), "image": summary.get('thumbnail', {}).get('source'),
                    "url": summary.get('content_urls', {}).get('desktop', {}).get('page')
                }
    except Exception as e: st.session_state.error_log.append(f"Instant Answer Error: {e}")
    return None

# --- 5. SEARCH LOGIC ---
def run_search(query):
    if not index or not embed_model:
        st.error("Search engine not connected.")
        return

    st.session_state.query = query
    st.session_state.ai_overview = ""
    st.session_state.ai_status = "idle" # Reset AI state
    st.session_state.instant_answer = None
    st.session_state.error_log = [] # Clear logs on new search
    
    with st.spinner("Searching Komu Index..."):
        try:
            # Save to history
            if st.session_state.user_info: save_history(st.session_state.user_info.get('email'), query)
            
            vector = embed_model.encode(query).tolist()
            query_res = index.query(vector=vector, top_k=80, include_metadata=True)
            matches = rerank_results(query_res.get('matches', []), query)

            domain_map, ordered_domains, img_results, seen = {}, [], [], set()
            
            for m in matches:
                meta = m['metadata']
                url = meta.get('url', '').split('#')[0].rstrip('/')
                if not url or url in seen: continue
                seen.add(url)
                
                domain = urlparse(url).netloc
                meta['title'] = clean_title(url, meta.get('title'))
                
                if url.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                    img_results.append(meta)
                else:
                    if domain not in domain_map:
                        domain_map[domain] = []
                        ordered_domains.append(domain)
                    if len(domain_map[domain]) < 4: # Limit sub-results
                        domain_map[domain].append(meta)

            st.session_state.results = [{'domain': d, 'main': domain_map[d][0], 'subs': domain_map[d][1:]} for d in ordered_domains]
            st.session_state.image_results = img_results
            
            # Prepare data for AI
            st.session_state.top_urls = [g['main'].get('url') for g in st.session_state.results[:3]]
            
            # Get Direct Answer (Non-AI)
            st.session_state.instant_answer = get_instant_answer(query)
            
        except Exception as e:
            st.session_state.error_log.append(f"Search Execution Error: {str(e)}")
            st.error(f"Search failed: {e}")

# --- 6. UI RENDER ---

# --- A. OAUTH CALLBACK HANDLER ---
if 'code' in st.query_params:
    if not all([GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI]):
        st.warning("⚠️ Google OAuth credentials missing in config.")
    else:
        try:
            code = st.query_params['code']
            token_url = "https://oauth2.googleapis.com/token"
            token_data = {
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": REDIRECT_URI
            }
            token_res = requests.post(token_url, data=token_data)
            
            if token_res.status_code == 200:
                access_token = token_res.json().get("access_token")
                user_info_res = requests.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                if user_info_res.status_code == 200:
                    user_data = user_info_res.json()
                    st.session_state.user_info = user_data
                    # Save session to cookie (expires in 30 days)
                    if cookie_manager:
                        cookie_manager.set("komu_user_session", user_data, expires_at=datetime.datetime.now() + datetime.timedelta(days=30))
                    # Clear query params to clean URL
                    st.query_params.clear()
                    st.rerun() 
        except Exception as e:
            st.error(f"Login failed: {e}")

# --- B. UI LOGIC & LAYOUT ---
is_home = len(st.session_state.results) == 0 and not st.session_state.query
user_email = st.session_state.user_info.get('email') if st.session_state.user_info else None
user_history = get_history(user_email)

def render_auth_widget(key_suffix):
    """Renders the Profile Picture/Login Button in a consistent way."""
    if st.session_state.user_info:
        profile_pic_url = st.session_state.user_info.get('picture', '')
        st.markdown(f"""
            <style>
                div[data-testid="stPopover"] > button {{
                    background-image: url('{profile_pic_url}');
                    background-size: cover;
                    background-position: center center;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    border: 1px solid #dfe1e5;
                }}
                div[data-testid="stPopover"] > button > div {{ display: none; }}
            </style>
        """, unsafe_allow_html=True)

        with st.popover("", use_container_width=False):
            st.markdown(f'''<div style='text-align: center;'>
                    <img src='{profile_pic_url}' style='width: 60px; height: 60px; border-radius: 50%; margin-bottom: 10px;'>
                    <div style='font-weight: bold; font-size: 16px;'>{st.session_state.user_info.get('name')}</div>
                    <div style='color: gray; font-size: 12px; margin-bottom: 15px;'>{st.session_state.user_info.get('email')}</div>
                </div>''', unsafe_allow_html=True)
            if st.button("Sign Out", key=f"logout_{key_suffix}", type="primary", use_container_width=True):
                if cookie_manager: cookie_manager.delete("komu_user_session")
                st.session_state.user_info = None
                st.rerun()
    else:
        auth_url = get_google_oauth_login_url()
        if auth_url: st.link_button("Sign in", auth_url, type="primary")
        else: st.warning("Config Missing")

if is_home:
    # --- HOME PAGE LAYOUT ---
    # 1. Top Right Login
    _, col_auth = st.columns([9, 1])
    with col_auth: render_auth_widget("home")

    # 2. Centered Search
    st.markdown("<div class='komu-logo-large'>Komu</div>", unsafe_allow_html=True)
    _, col_s, _ = st.columns([1, 4, 1])
    with col_s:
        q = st.text_input("Search", placeholder="Search Wikipedia, news, or science...", label_visibility="collapsed", key="search_home")
        if not q and user_history:
            st.markdown('<div class="history-container">', unsafe_allow_html=True)
            for i, h in enumerate(user_history[:6]):
                if st.button(f"🕒  {h}", key=f"hist_{i}", use_container_width=True):
                    run_search(h); st.rerun()
            st.markdown('</div>', unsafe_allow_html=True)
        if q: run_search(q); st.rerun()

else:
    # --- RESULTS PAGE LAYOUT ---
    # Header: [Logo] [Search Bar] [Profile]
    c1, c2, c3 = st.columns([2, 6, 2])
    with c1: 
        if st.button("Komu", key="home_btn", type="tertiary"):
            st.session_state.results = []
            st.session_state.query = ""
            st.rerun()
    with c2:
        q = st.text_input("Search", value=st.session_state.query, label_visibility="collapsed", key="search_results")
        if q and q != st.session_state.query: run_search(q); st.rerun()
        
    with c3:
        render_auth_widget("results")
    
    # --- TABS ---
    tab_all, tab_img = st.tabs(["🔍 All", "🖼️ Images"])

    with tab_all:
        # 0. DIRECT ANSWER (Knowledge Graph)
        if st.session_state.instant_answer:
            ia = st.session_state.instant_answer
                
            if ia['type'] == 'fact':
                # Calculator / Date Style
                st.markdown(f"""<div class="ia-card">
                    <div class="ia-sub">{ia['sub']}</div>
                    <div style="font-size: 20px; color: #70757a; margin-bottom: 4px;">{ia['desc']}</div>
                    <div class="ia-fact">{ia['title']}</div>
                </div>""", unsafe_allow_html=True)
                
            elif ia['type'] == 'entity':
                # Wiki Entity Style
                img_html = f'<div style="min-width:120px;"><img src="{ia["image"]}" class="ia-img"></div>' if ia.get('image') else ''
                st.markdown(f"""<div class="ia-card"><div class="ia-flex"><div class="ia-content">
                    <div class="ia-title">{ia['title']}</div><div class="ia-sub">{ia['sub']}</div>
                    <div class="ia-text">{ia['text']}</div><a href="{ia['url']}" class="ia-link" target="_blank">Wikipedia</a>
                </div>{img_html}</div></div>""", unsafe_allow_html=True)

        # 1. AI CONTAINER (Placeholder at the top)
        ai_container = st.empty()

        # 2. RENDER RESULTS IMMEDIATELY
        if st.session_state.results:
            for group in st.session_state.results[:15]: 
                main, dom, subs = group['main'], group['domain'], group['subs']
                    
                html = f"""<div class="search-result">
                <div class="site-path">
                    <img src="https://icons.duckduckgo.com/ip3/{dom}.ico" class="favicon" onerror="this.onerror=null; this.src='https://www.google.com/s2/favicons?sz=64&domain={dom}';">
                    <div class="site-header-text">
                        <div class="site-name">{dom.split('.')[0].title()}</div>
                        <div class="site-url">{shorten_url(main.get('url'))}</div>
                    </div>
                </div>
                <a class="result-title" href="{main.get('url')}" target="_blank">{main.get('title')}</a>
                <div class="result-snippet">{main.get('text', '')[:220]}...</div>"""
                    
                if subs:
                    html += '<div class="sub-results-container">'
                    for sub in subs:
                        html += f'<div class="sub-result"><a class="sub-result-title" href="{sub.get("url")}" target="_blank">{sub.get("title")}</a></div>'
                    html += '</div>'
                    
                st.markdown(html + "</div>", unsafe_allow_html=True)
        else:
            st.write("No results found.")

        # 3. DISPLAY OR GENERATE AI (After results are shown)
            
        # If AI is already done, show it in the top placeholder
        if st.session_state.ai_status == "complete" and st.session_state.ai_overview:
            with ai_container.container():
                st.markdown(f"""
                    <div class="ai-overview-card">
                        <div style="display:flex; align-items:center; margin-bottom:12px;">
                            <div style="background: linear-gradient(135deg, #4285f4, #d96570); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight:700; font-size: 16px;">✨ AI Overview</div>
                        </div>
                        <div class="ai-content" style="color: #202124; font-size: 16px; line-height: 1.6;">{st.session_state.ai_overview}</div>
                        <div style="margin-top:15px; padding-top:10px;">
                            {''.join([f'<a href="{u}" target="_blank" class="source-chip">{urlparse(u).netloc}</a>' for u in st.session_state.top_urls])}
                        </div>
                    </div>
                """, unsafe_allow_html=True)
            
        # If AI is idle (new search), trigger generation
        elif st.session_state.ai_status == "idle" and st.session_state.top_urls:
            with ai_container.container():
                # Custom modern loader (No brain emoji, no st.status)
                st.markdown("""<div class="ai-overview-card" style="padding: 20px; text-align: left;">
                    <div style="color:#5f6368; font-weight:500; font-size: 14px; animation: pulse 1.5s infinite;">✨ Generating Overview...</div>
                    <style>@keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }</style>
                </div>""", unsafe_allow_html=True)
                
                # Fetch content
                with ThreadPoolExecutor(max_workers=3) as exc:
                    contents = list(exc.map(fetch_content, st.session_state.top_urls))
                
                # Prepare Context
                context_text = ""
                # Add Wikipedia Instant Answer to context if available
                if st.session_state.instant_answer and st.session_state.instant_answer.get('text'):
                     context_text += f"\nWikipedia Source: {st.session_state.instant_answer['text']}\n"

                for i, txt in enumerate(contents):
                    if len(txt) > 200:
                        context_text += f"\nSource [{i+1}]: {txt[:800]}\n"
                
                if context_text:
                    prompt = f"User Query: {st.session_state.query}\nContext:\n{context_text}\n"
                    summary = query_huggingface(prompt)
                    st.session_state.ai_overview = summary
                else:
                    st.session_state.ai_overview = "Could not retrieve sufficient information to generate an overview."

                st.session_state.ai_status = "complete"
                st.rerun()

    with tab_img:
        if st.session_state.image_results:
            html = '<div class="image-container">'
            for img in st.session_state.image_results[:40]:
                src = img.get('image_url') or img.get('url')
                html += f'<div class="image-card"><a href="{img.get("url")}" target="_blank"><img src="{src}"></a></div>'
            st.markdown(html + "</div>", unsafe_allow_html=True)
        else:
            st.write("No images found.")
            
    # --- ERROR LOG VIEWER ---
    if st.session_state.error_log:
        with st.expander("🔴 Debug / Error Logs", expanded=False):
            for err in st.session_state.error_log:
                st.error(err)