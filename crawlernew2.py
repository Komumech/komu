import os
import io
import time
import requests
import trafilatura
import urllib3
from bs4 import BeautifulSoup
from PIL import Image
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
BLACKLIST = ["nothing.com"]

# --- DICTIONARY & PHRASE SEEDS FOR AUTONOMY ---
POPULAR_PREFIXES = [
    "how to", "best", "future of", "trends in", "guide to", "latest", 
    "review of", "why is", "top 10", "new", "advanced", "history of"
]

DICTIONARY_NOUNS = [
    "technology", "science", "coding", "medicine", "space", "finance", "cooking",
    "engineering", "philosophy", "history", "gaming", "sustainability", "art",
    "architecture", "psychology", "marketing", "biology", "physics", "automation",
    "cryptography", "ecology", "robotics", "agriculture", "astronomy", "sociology"
]

def generate_random_seed_query():
    """Generates a random query using dictionary words and popular patterns."""
    prefix = random.choice(POPULAR_PREFIXES)
    noun = random.choice(DICTIONARY_NOUNS)
    # 50% chance to add a year for 'freshness'
    year = " 2026" if random.random() > 0.5 else ""
    return f"{prefix} {noun}{year}"

def get_autonomous_seeds(count=5):
    """Generates real-world trending seeds starting from random dictionary words."""
    final_seeds = []
    for _ in range(count):
        spark = generate_random_seed_query()
        # Tap into Google to turn our random word into a popular phrase
        suggestions = get_google_suggestions(spark)
        if suggestions:
            final_seeds.append(random.choice(suggestions))
        else:
            final_seeds.append(spark)
    return final_seeds

SEARCH_TOPICS = [
    "DStv",
"GOtv",
"StarTimes",
"DStv Stream",
"Showmax",
"MultiChoice",
"Cartoon Network",
"Warner Bros. Animation",
"DC Studios",
"Hanna-Barbera Studios Europe",
"Cartoon Network Studios",
"The Amazing World of Gumball",
"Teen Titans Go!",
"Justice League Action",
"Ben 10",
"Craig of the Creek",
"Disney Junior",
"Disney Channel",
"Disney Television Animation",
"Marvel Studios",
"Pixar Animation Studios",
"Bluey",
"Ludo Studio",
"BBC Studios",
"Pupstruction",
"Ariel",
"Alice’s Wonderland Bakery",
"The Owl House",
"Wizards Beyond Waverly Place",
"Kiff",
"Miraculous: Tales of Ladybug & Cat Noir",
"Zagtoon",
"Method Animation",
"Nickelodeon",
"Nick Jr.",
"Nicktoons",
"Nickelodeon Animation Studio",
"Paramount Global",
"The Loud House",
"SpongeBob SquarePants",
"Avatar: Seven Havens",
"The Thundermans Undercover",
"PAW Patrol",
"Spin Master Entertainment",
"Baby Shark’s Big Show",
"Pinkfong",
"The Tiny Chef Show",
"Imagine Entertainment",
"The Casagrandes",
"Henry Danger",
"Danger Force",
"Moonbug Kids",
"Moonbug Entertainment",
"CoComelon",
"Blippi",
"Little Angel",
"Supa Strikas",
"Lebone Media",
"DreamWorks",
"DreamWorks Animation",
"Universal Pictures",
"How to Train Your Dragon: The Hidden World",
"The Epic Tales of Captain Underpants",
"Trolls: The Beat Goes On!",
"Kung Fu Panda",
"Bad Guys: The Series",
"Puss in Boots: The Last Wish",
"Forgotten Island",
"Illumination",
"Nintendo",
"The Super Mario Galaxy Movie",
"Minions: The Rise of Gru",
"Sony Pictures Animation",
"Columbia Pictures",
"Spider-Man: Across the Spider-Verse",
"Goat",
"K-Pop Demon Hunters",
"Hoppers",
"Elemental",
"Toy Story 5",
"Cartoonito",
"Tom & Jerry",
"Masha and the Bear",
"Animaccord Animation Studio",
"Grizzy & the Lemmings",
"Studio Hari",
"CBeebies",
"Mojo Swoptops",
"Playtime Towers",
"Hey Duggee",
"Studio AKA",
"JimJam",
"Ricky Zoom",
"Entertainment One",
"Da Vinci Kids",
"Operation Ouch",
"PinCode",
"PBS Kids",
"Wild Kratts",
"Arthur",
"Daniel Tiger’s Neighborhood",
"Fred Rogers Productions",
"Toonami",
"Toei Animation",
"Dragon Ball Super",
"ST Kids",
"The Adventures of Little Penguin",
"Kartoon",
"Angry Birds",
"Rovio Entertainment",
"Stan Lee’s Superhero Kindergarten",
"Netflix Animation",
"The Sea Beast",
"Steps",
"Narnia",
"Walden Media",
"Nemsia Studios",
"Supernowa",
"Mattel",
"Barbie’s Dog Adventure",
"Jay Jay: The Chosen One",
"Tim Burton’s Corpse Bride",
"Harry Potter",
"Heyday Films",
"Wildwood",
"Laika Studios",
"https://www.amazon.com",
"https://aws.amazon.com",
"https://www.amazon.com/firetv",
"https://maps.google.com",
"https://www.instagram.com",
"https://www.facebook.com",
    "youtube",
"facebook",
"whatsapp web",
"google",
"gmail",
"amazon",
"weather",
"chatgpt",
"instagram",
"roblox",
"netflix",
"canva",
"google maps",
"translator",
    "youtube",
"facebook",
"whatsapp web",
"google",
"gmail",
"amazon",
"weather",
"chatgpt",
"instagram",
"roblox",
"netflix",
"canva",
"google maps",
"translator",
"komumech",
"komutheme",
"komunote",
"komucalendar",
"wordle",
"what time is it",
"what is my ip",
"how to tie a tie",
"calculator",
"temu",
"shein",
"zillow",
"gemini",
"espn",
"ebay",
"walmart",
"twitter",
"twitch",
"duckduckgo",
"character ai",
"pinterest",
"linkedin",
"tiktok",
"spotify",
"bing homepage quiz",
"gold price",
"stock market today",
"how to screenshot on mac",
"how to delete facebook account",
"what to watch",
"restaurants near me",
"flights to london",
"nfl scores",
"premier league table",
"ai image generator",
"claude ai",
"outlook",
"yahoo mail",
"hotstar",
"cricbuzz",
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
# Standardizing to the Scout v3.5 Visual Brain (768-dim CLIP)
model = SentenceTransformer('clip-ViT-L-14')
print("✅ Model Loaded: clip-ViT-L-14 (768 Dimensions)")
# Double check the dimension before starting the crawl
sample_encoding = model.encode("Verify 768")
print(f"📐 Verified Vector Size: {len(sample_encoding)}")

pc = Pinecone(api_key=PINECONE_KEY)
pc_index = pc.Index(INDEX_NAME)

ai_client = OpenAI(api_key=AI_API_KEY, base_url=AI_BASE_URL)

url_queue = Queue()
visited = set()         
runtime_indexed = [] 
domain_counts = {}  
domain_image_counts = {}
active_workers = 0 
data_lock = threading.Lock()
pbar = None 

# --- GOOGLE SUGGESTIONS ENGINE ---
def get_google_suggestions(query):
    """Taps into live Google Search trends to find new indexing paths."""
    try:
        # Using the chrome client returns a clean JSON list of suggestions
        url = f"http://suggestqueries.google.com/complete/search?client=chrome&q={query}"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            suggestions = data[1] # The list of suggestion strings
            return [s for s in suggestions if len(s) > 3]
        return []
    except Exception as e:
        tqdm.write(f"⚠️ Google Suggest API failed: {e}")
        return []

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

def index_to_pinecone(url, content, domain, is_image=False, alt_text="", t_name="Unknown"):
    try:
        # Encoding content (truncating text to maintain performance)
        input_data = content[:1000] if isinstance(content, str) else content
        vector = model.encode(input_data).tolist()
        v_id = re.sub(r'\W+', '_', url)[:512]
        
        if is_image:
            metadata = {
                "url": url, 
                "domain": domain, 
                "text": alt_text[:800],
                "image": url,
                "title": alt_text[:200],
                "is_image": True
            }
        else:
            # content is text string
            metadata = {"url": url, "domain": domain, "text": str(content)[:800]}

        pc_index.upsert(
            vectors=[{"id": v_id, "values": vector, "metadata": metadata}],
            namespace=NAMESPACE
        )
        return True
    except Exception as e:
        tqdm.write(f"❌ [{t_name}] Pinecone Error: {str(e)[:100]}")
        return False

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

        with data_lock:
            if clean_url in visited or not is_high_quality(clean_url):
                active_workers -= 1
                url_queue.task_done()
                continue
            visited.add(clean_url)

        # --- 1. CLIMB UP FIX: Ensure we index the Homepage too ---
        if parsed_current.path not in ["", "/"]:
            root_url = f"{parsed_current.scheme}://{domain}"
            with data_lock:
                if root_url not in visited and domain_counts.get(domain, 0) < DOMAIN_LIMIT:
                    url_queue.put(root_url)

        try:
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
            resp = session.get(url, headers=headers, timeout=12, verify=False)

            if resp.status_code == 200:
                # --- IMAGE INDEXING: Max 3 per site, requiring Alt Text ---
                try:
                    soup = BeautifulSoup(resp.text, 'html.parser')
                    for img in soup.find_all('img', alt=True):
                        alt_text = img.get('alt', '').strip()
                        src = img.get('src', '')
                        # Only index if alt text is meaningful (avoid icons/spacers)
                        if len(alt_text) > 5 and src:
                            img_url = urljoin(url, src).split('?')[0].rstrip('/')
                            if any(img_url.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.webp']):
                                if not any(bad in img_url for bad in BLACKLIST):
                                    with data_lock:
                                        needs_indexing = domain_image_counts.get(domain, 0) < 3 and img_url not in visited
                                    
                                    if needs_indexing:
                                        try:
                                            img_resp = session.get(img_url, timeout=10, verify=False)
                                            if img_resp.status_code == 200:
                                                img_obj = Image.open(io.BytesIO(img_resp.content)).convert('RGB')
                                                if index_to_pinecone(img_url, img_obj, domain, is_image=True, alt_text=alt_text, t_name=t_name):
                                                    with data_lock:
                                                        visited.add(img_url)
                                                        domain_image_counts[domain] = domain_image_counts.get(domain, 0) + 1
                                                        tqdm.write(f"🖼️ [{t_name}] PIXEL INDEXED: {img_url}")
                                        except Exception: pass
                except Exception: pass

                text = trafilatura.extract(resp.text) or ""

                # --- 2. MAIN DOMAIN FIX: Lower thresholds & Metadata fallback ---
                is_root = parsed_current.path in ["", "/"]
                if is_root and len(text) < 300:
                    meta_match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']', resp.text, re.I)
                    desc = meta_match.group(1) if meta_match else ""
                    text = f"{desc}\n{text}".strip()

                # Lower barrier for Root Domains (100 chars) vs Articles (400 chars)
                if len(text) > (100 if is_root else 400):
                    if index_to_pinecone(url, text, domain, is_image=False, t_name=t_name):
                        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        tqdm.write(f"✅ [{now}] [{t_name}] INDEXED: {url}")

                        with data_lock:
                            runtime_indexed.append(clean_url)
                            domain_counts[domain] = domain_counts.get(domain, 0) + 1
                            pbar.update(1)

                # --- ROBUST DEEP-CRAWL ENGINE ---
                raw_links = re.findall(r'href=["\'](https?://[^\s"\']+|/[^\s"\']+)["\']', resp.text)

                new_sub_links = 0
                for l in raw_links:
                    full_link = urljoin(url, l).split('#')[0].rstrip('/')
                    l_parsed = urlparse(full_link)
                    l_domain = l_parsed.netloc

                    with data_lock:
                        if l_domain and full_link not in visited:
                            if l_domain == domain:
                                if domain_counts.get(l_domain, 0) < DOMAIN_LIMIT:
                                    url_queue.put(full_link)
                                    new_sub_links += 1
                            else:
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

    # Start with a mix of static topics and purely random autonomous seeds
    current_topics = SEARCH_TOPICS.copy() + get_autonomous_seeds(10)
    seeds = get_seeds_robust(current_topics)
    for url in seeds: url_queue.put(url)

    print(f"🚀 KOMU SCOUT READY. Deep-Crawl & Sub-site indexing active.")
    pbar = tqdm(total=None, desc="Live Indexing", unit="site", colour="magenta")
    
    for i in range(MAX_THREADS):
        threading.Thread(target=crawler_worker, name=f"Agent-{i+1}", daemon=True).start()

    try:
        while True:
            time.sleep(15)
            
            # --- EVOLUTION ENGINE: AI + GOOGLE + DICTIONARY ---
            if url_queue.qsize() < 15:
                recent_domains = [urlparse(u).netloc for u in list(visited)[-5:]]
                
                # 1. Stay Relevant: Get Google Suggestions for a successful recent topic
                base_topic = random.choice(current_topics[-15:])
                trending_topics = get_google_suggestions(base_topic)
                
                # 2. Stay Smart: Augment with AI for hyper-specific 2026 niches
                ai_topics = generate_ai_topics(current_topics[-3:], recent_domains)
                
                # 3. Stay Random: Inject 2 purely random dictionary-based trending topics
                random_injects = get_autonomous_seeds(2)
                
                combined_new = list(set(trending_topics + ai_topics + random_injects))
                
                if combined_new:
                    tqdm.write(f"🌟 Evolution: Found {len(combined_new)} new paths (Google + AI + Dictionary)")
                    current_topics.extend(combined_new)
                    new_seeds = get_seeds_robust(combined_new[:8])
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