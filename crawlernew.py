import os
import time
import requests
import trafilatura
import urllib3
import re
import random
import threading
from datetime import datetime
from queue import Queue, Empty
from tqdm import tqdm
from urllib.parse import urlparse, urljoin
from ddgs import DDGS 
from openai import OpenAI 

# --- VECTOR ENGINE ---
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer

# --- LOAD SECURE KEYS ---
try:
    import config
    PINECONE_KEY = config.PINECONE_KEY
    INDEX_NAME = config.INDEX_NAME
    NAMESPACE = config.NAMESPACE
    AI_API_KEY = getattr(config, 'AI_API_KEY', "your_key_here")
    AI_BASE_URL = getattr(config, 'AI_BASE_URL', "https://api.openai.com/v1") 
except (ImportError, AttributeError):
    print("❌ ERROR: Ensure config.py exists with PINECONE_KEY, INDEX_NAME, NAMESPACE, and AI_API_KEY."); exit()

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
session = requests.Session()

# --- GLOBAL CONFIG ---
LOG_FILE = "indexed_sites.txt"
MAX_THREADS = 8 
DOMAIN_LIMIT = 20  # 🚀 Limit to 20 pages per domain to ensure index diversity
BLACKLIST = ["facebook.com", "twitter.com", "instagram.com", "tiktok.com", "quora.com", "reddit.com", "amazon.com", "ebay.com"]

SEARCH_TOPICS = [
    # --- Career & Digital Economy ---
    "top remote work industries 2026",
    "best side hustles for students in 2026",
    "freelance tax laws for digital nomads 2026",
    "high-paying no-degree tech jobs 2026",
    "global inflation rates and economic forecasts",
    "how to start a startup with zero capital in 2026",
    "top coworking spaces in major tech hubs",

    # --- Education & Academic Prep ---
    "SS2 mathematics practice questions and answers",
    "physics syllabus for senior secondary 2026",
    "JAMB 2026 registration dates and requirements",
    "WAEC past questions and answers for technical drawing",
    "best online platforms for self-paced learning",
    "university scholarship opportunities for international students",
    "how to use AI for academic research without plagiarism",

    # --- Niche Tech & Engineering ---
    "Rust vs Mojo for systems programming in 2026",
    "edge computing vs cloud computing trends",
    "cybersecurity best practices for small agencies",
    "how to deploy Next.js apps to private servers",
    "best headless CMS for high-traffic blogs",
    "latest advances in solid-state battery technology",
    "building real-time video apps with WebRTC and LiveKit",

    # --- Health & Wellness ---
    "mental health apps for high-stress professionals",
    "latest wearable health trackers 2026",
    "personalized nutrition based on DNA testing",
    "biohacking trends for better focus and sleep",
    "home workout routines for busy students",
    "sustainable and vegan protein sources",

    # --- Sports & E-sports ---
    "upcoming world cup 2026 qualifying schedules",
    "top E-sports tournaments and prize pools 2026",
    "popular football transfer news and rumors",
    "how to get started in competitive chess 2026",
    "latest basketball highlights and player stats",

    # --- Travel & Local Discovery ---
    "underrated travel destinations for 2026",
    "how to find cheap flights using AI agents",
    "eco-friendly travel and sustainable tourism",
    "best local restaurants and hidden gems",
    "visa-free countries for digital nomads",

    # --- Home & Sustainability ---
    "smart home automation systems for 2026",
    "affordable solar power solutions for homes",
    "minimalist interior design trends 2026",
    "urban gardening and vertical farming at home",
    "latest energy-efficient appliances",

    # --- Culture & Niche Hobbies ---
    "rare vinyl record collecting trends",
    "beginner-friendly piano arrangements for pop hits",
    "manga series with the best world-building 2026",
    "history of streetwear and high-fashion crossovers",
    "top-rated tabletop strategy games 2026"
]

# --- INIT ENGINES ---
print(f"🛰️  KOMU SCOUT v15.2 - DEEP-DIVE & AI ENABLED")
# Aligning with the Scout v3.5 latent space (768-dim CLIP)
model = SentenceTransformer('clip-ViT-L-14')
pc = Pinecone(api_key=PINECONE_KEY)
pc_index = pc.Index(INDEX_NAME)

ai_client = OpenAI(api_key=AI_API_KEY, base_url=AI_BASE_URL)

url_queue = Queue()
visited = set()         
runtime_indexed = [] 
domain_counts = {}  
active_workers = 0 
data_lock = threading.Lock()
pbar = None 

# --- AI TOPIC GENERATOR ---
def generate_ai_topics(existing_topics, recent_finds):
    tqdm.write(f"🧠 [{datetime.now().strftime('%H:%M:%S')}] AI is brainstorming new research directions...")
    try:
        prompt = f"""
        You are an autonomous web scout. Seed topics: {existing_topics}
        Recently discovered: {recent_finds[:5]}
        Generate 5 NEW, hyper-specific search queries for 2026 focusing on general topics totaly general.
        Return ONLY a list of strings. No numbering.
        """
        response = ai_client.chat.completions.create(
            model="gpt-3.5-turbo", 
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200
        )
        new_queries = response.choices[0].message.content.strip().split('\n')
        return [re.sub(r'^\d+\.\s*|-\s*', '', q).strip() for q in new_queries if len(q) > 5]
    except Exception as e:
        tqdm.write(f"⚠️ AI Generation failed. Using shuffle.")
        return [f"advanced {random.choice(existing_topics)}" for _ in range(3)]

# --- CORE LOGIC ---
def is_high_quality(url):
    parsed = urlparse(url.lower())
    domain = parsed.netloc
    if any(bad in domain for bad in BLACKLIST): return False
    # Filter out non-content files
    if re.search(r'\.(zip|exe|mp4|pdf|png|jpg|jpeg|gif|css|js|json|xml|iso)$', url.lower()): return False
    return True

def get_seeds_robust(queries):
    seeds = []
    try:
        with DDGS() as ddgs:
            for q in queries:
                tqdm.write(f"🔍 [{datetime.now().strftime('%H:%M:%S')}] Seed Scouting: {q}")
                results = ddgs.text(q, max_results=5)
                for r in results: seeds.append(r['href'])
                time.sleep(1.2)
    except: pass
    return list(set(seeds))

def index_to_pinecone(url, text, domain):
    try:
        vector = model.encode(text).tolist()
        v_id = re.sub(r'\W+', '_', url)[:512]
        pc_index.upsert(
            vectors=[{"id": v_id, "values": vector, "metadata": {"url": url, "domain": domain, "text": text[:800]}}],
            namespace=NAMESPACE
        )
        return True
    except: return False

def crawler_worker():
    global active_workers
    t_name = threading.current_thread().name
    while True:
        try:
            url = url_queue.get(timeout=30) 
        except Empty: break

        with data_lock: active_workers += 1
        clean_url = url.lower().strip().rstrip('/')
        parsed_current = urlparse(clean_url)
        domain = parsed_current.netloc
        
        # --- 1. CLIMB UP FIX: Ensure we index the Homepage too ---
        # If we are on a subpage (e.g. site.com/blog), make sure site.com is queued
        if parsed_current.path not in ["", "/"]:
            root_url = f"{parsed_current.scheme}://{domain}"
            with data_lock:
                if root_url not in visited and domain_counts.get(domain, 0) < DOMAIN_LIMIT:
                    url_queue.put(root_url)

        with data_lock:
            if clean_url in visited or not is_high_quality(clean_url):
                active_workers -= 1
                url_queue.task_done()
                continue
            visited.add(clean_url)

        try:
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
            resp = session.get(url, headers=headers, timeout=12, verify=False)
            
            if resp.status_code == 200:
                text = trafilatura.extract(resp.text) or ""
                
                # --- 2. MAIN DOMAIN FIX: Lower thresholds & Metadata fallback ---
                is_root = parsed_current.path in ["", "/"]
                
                # If homepage text is thin (common on landing pages), try to salvage metadata
                if is_root and len(text) < 300:
                    meta_match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']', resp.text, re.I)
                    desc = meta_match.group(1) if meta_match else ""
                    text = f"{desc}\n{text}".strip()
                
                # Lower barrier for Root Domains (100 chars) vs Articles (400 chars)
                if len(text) > (100 if is_root else 400): 
                    if index_to_pinecone(url, text, domain):
                        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        tqdm.write(f"✅ [{now}] [{t_name}] INDEXED: {url}")
                        
                        with data_lock:
                            runtime_indexed.append(clean_url)
                            domain_counts[domain] = domain_counts.get(domain, 0) + 1
                            pbar.update(1)

                # --- ROBUST DEEP-CRAWL ENGINE ---
                # Find all links on the page
                raw_links = re.findall(r'href=["\'](https?://[^\s"\']+|/[^\s"\']+)["\']', resp.text)
                
                new_sub_links = 0
                for l in raw_links:
                    # Resolve relative links (e.g., "/about" -> "https://site.com/about")
                    full_link = urljoin(url, l).split('#')[0].rstrip('/')
                    l_parsed = urlparse(full_link)
                    l_domain = l_parsed.netloc

                    with data_lock:
                        # Check if it's the SAME domain for deep crawling, OR a new domain for discovery
                        if l_domain and full_link not in visited:
                            # If it's the same domain, we are more aggressive
                            if l_domain == domain:
                                if domain_counts.get(l_domain, 0) < DOMAIN_LIMIT:
                                    url_queue.put(full_link)
                                    new_sub_links += 1
                            else:
                                # If it's a new domain, we add it as a new seed
                                if domain_counts.get(l_domain, 0) < 5: # Limit initial discovery
                                    url_queue.put(full_link)
                
                if new_sub_links > 0:
                    tqdm.write(f"📂 [{t_name}] Deep-Dive: Found {new_sub_links} secondary pages on {domain}")

        except Exception:
            pass
        finally:
            with data_lock: active_workers -= 1
            url_queue.task_done()

def run_komu_autonomous():
    global pbar, runtime_indexed
    
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r") as f:
            for line in f:
                if "] " in line:
                    try: visited.add(line.split("] ")[1].strip().lower())
                    except: pass

    current_topics = SEARCH_TOPICS.copy()
    seeds = get_seeds_robust(current_topics)
    for url in seeds: url_queue.put(url)

    print(f"🚀 KOMU SCOUT READY. Deep-Crawl & Sub-site indexing active.")
    pbar = tqdm(total=None, desc="Live Indexing", unit="site", colour="magenta")
    
    for i in range(MAX_THREADS):
        threading.Thread(target=crawler_worker, name=f"Agent-{i+1}", daemon=True).start()

    try:
        while True:
            time.sleep(15)
            
            # AI Evolution
            if url_queue.qsize() < 15:
                recent_samples = [urlparse(u).netloc for u in list(visited)[-10:]]
                new_topics = generate_ai_topics(current_topics[-5:], recent_samples)
                current_topics.extend(new_topics)
                new_seeds = get_seeds_robust(new_topics)
                for s in new_seeds: url_queue.put(s)
                if len(current_topics) > 100: current_topics = current_topics[-50:]

            # Save progress
            if len(runtime_indexed) >= 5:
                with data_lock:
                    with open(LOG_FILE, "a") as f:
                        for url in runtime_indexed:
                            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {url}\n")
                    runtime_indexed = []
                    
            if len(visited) > 20000: # Increased memory limit
                with data_lock: visited.clear()

    except KeyboardInterrupt:
        print(f"\n🛑 Manual Stop. Saving final data...")
    finally:
        pbar.close()

if __name__ == "__main__":
    run_komu_autonomous()