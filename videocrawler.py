import os
import time
import requests
import trafilatura
import urllib3
from bs4 import BeautifulSoup
import re
import random
import threading
from datetime import datetime
from queue import Queue, Empty
from tqdm import tqdm
from urllib.parse import urlparse, urljoin
from ddgs import DDGS 

# --- VECTOR ENGINE ---
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer

# --- LOAD SECURE KEYS ---
try:
    import config
    PINECONE_KEY = config.PINECONE_KEY
    INDEX_NAME = config.INDEX_NAME
    NAMESPACE = config.NAMESPACE
except (ImportError, AttributeError):
    print("❌ ERROR: Ensure config.py exists with PINECONE_KEY, INDEX_NAME, NAMESPACE."); exit()

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
session = requests.Session()

# --- GLOBAL CONFIG ---
LOG_FILE = "indexed_videos.txt"
MAX_THREADS = 8 
DOMAIN_LIMIT = 20  # Limit to 20 pages per domain to ensure index diversity
BLACKLIST = [
  "wikipedia.org", "wikimedia.org", "creativecommons.org", "play.google.com",
  "facebook.com", "twitter.com", "instagram.com", "tiktok.com", "quora.com", "reddit.com", "amazon.com", "ebay.com"
]

# --- SEED TOPICS FOR VIDEO CRAWLING ---
VIDEO_SEARCH_TOPICS = [
    "latest tech reviews youtube",
    "best coding tutorials youtube",
    "science documentaries youtube",
    "gaming highlights youtube",
    "music videos official",
    "cooking recipes youtube",
    "travel vlogs youtube",
    "educational videos for kids",
    "DIY projects youtube",
    "fitness workouts youtube",
    "news analysis youtube",
    "comedy sketches youtube",
    "movie trailers official",
    "car reviews youtube",
    "space exploration documentaries"
]

# --- INIT ENGINES ---
print(f"🛰️  KOMU VIDEO SCOUT v1.0 - YouTube Deep-Dive")
model = SentenceTransformer('all-mpnet-base-v2') # Using MPNet for text embeddings of titles/descriptions
print("✅ Model Loaded: all-mpnet-base-v2 (768 Dimensions)")

pc = Pinecone(api_key=PINECONE_KEY)
# Ensure the Pinecone index exists and is configured for 768 dimensions
# If not, you might need to create it: pc.create_index(name=INDEX_NAME, dimension=768, metric='cosine')
pc_index = pc.Index(INDEX_NAME)

url_queue = Queue()
visited_urls = set() # Tracks visited webpages
visited_video_ids = set() # Tracks indexed YouTube video IDs
runtime_indexed_videos = [] 
domain_counts = {}  
active_workers = 0 
data_lock = threading.Lock()
pbar = None 

# --- GOOGLE SUGGESTIONS ENGINE (for initial seeds) ---
def get_google_suggestions(query):
    try:
        url = f"http://suggestqueries.google.com/complete/search?client=chrome&q={query}"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            suggestions = data[1]
            return [s for s in suggestions if len(s) > 3]
        return []
    except Exception as e:
        tqdm.write(f"⚠️ Google Suggest API failed: {e}")
        return []

# --- CORE LOGIC ---
def is_high_quality_domain(url):
    parsed = urlparse(url.lower())
    domain = parsed.netloc
    if any(bad in domain for bad in BLACKLIST): return False
    return True

def get_seeds_robust(queries):
    seeds = []
    try:
        for q in queries:
            tqdm.write(f"🔍 [{datetime.now().strftime('%H:%M:%S')}] Scouting: {q}")
            try:
                with DDGS() as ddgs:
                    # Try specialized video search first
                    results = list(ddgs.videos(q, max_results=10))
                    if results:
                        for r in results:
                            url = r.get('content') or r.get('url')
                            if url: seeds.append(url)
                    else:
                        # Fallback to text search with site filter
                        tqdm.write(f"  ↳ Video search empty, trying text-fallback for: {q}")
                        txt_results = list(ddgs.text(f"{q} site:youtube.com", max_results=10))
                        for r in txt_results: seeds.append(r['href'])
            except Exception as inner_e:
                tqdm.write(f"  ⚠️ Search for '{q}' failed: {str(inner_e)[:50]}")
            time.sleep(2.0) # Longer sleep to avoid rate limits
    except Exception as e:
        tqdm.write(f"⚠️ DDGS seed generation failed: {e}")

    if not seeds:
        tqdm.write("🆘 All search methods failed. Injecting emergency YouTube seeds...")
        seeds = [
            "https://www.youtube.com/c/GoogleDevelopers/videos",
            "https://www.youtube.com/user/Computerphile/videos",
            "https://www.youtube.com/c/Fireship/videos",
            "https://www.youtube.com/c/Veritasium/videos"
        ]
    return list(set(seeds))

def get_video_detailed_metadata(url):
    """Visits the video page to extract duration and author name."""
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
        resp = session.get(url, headers=headers, timeout=5, verify=False)
        if resp.status_code != 200: return None, None
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        duration = None
        author = None

        # YouTube Specific meta tags
        duration_meta = soup.find('meta', itemprop='duration')
        if duration_meta:
            # Convert PT17M24S to 17:24
            pt = duration_meta.get('content', '')
            matches = re.findall(r'(\d+)', pt)
            if len(matches) == 2: duration = f"{matches[0]}:{matches[1].zfill(2)}"
            elif len(matches) == 3: duration = f"{matches[0]}:{matches[1].zfill(2)}:{matches[2].zfill(2)}"

        author_meta = soup.find('link', itemprop='name') or soup.find('meta', property='og:site_name')
        if author_meta: author = author_meta.get('content') or author_meta.get('href')

        return duration, author
    except: return None, None

def extract_video_info(page_url, html_content):
    videos_found = []
    soup = BeautifulSoup(html_content, 'html.parser')

    def process_url(href, link_text=""):
        if href in visited_video_ids: return None
        
        video_id = None
        match_watch = re.search(r'(?:v=|v\/|embed\/|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})', href)
        if match_watch:
            video_id = match_watch.group(1)
        
        is_direct_file = re.search(r'\.(mp4|webm|ogg|mov)$', href.lower())

        if video_id or is_direct_file:
            video_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else urljoin(page_url, href)
            
            # Fetch deep metadata (Author, Duration) for browser playability
            duration, author = None, None
            if video_id:
                duration, author = get_video_detailed_metadata(video_url)

            embed_url = f"https://www.youtube.com/embed/{video_id}" if video_id else video_url
            thumbnail_url = f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg" if video_id else ""
            
            title = link_text.strip()
            if not title or len(title) < 5:
                og_title = soup.find('meta', property='og:title')
                title = og_title.get('content') if og_title else (soup.title.string if soup.title else f"Video from {urlparse(page_url).netloc}")

            desc_tag = soup.find('meta', property='og:description') or soup.find('meta', name='description')
            description = desc_tag.get('content') if desc_tag else ""

            return {
                'title': title or "Untitled Video",
                'url': video_url,
                'embed_url': embed_url,
                'thumbnail_url': thumbnail_url,
                'duration': duration,
                'author': author,
                'description': description,
                'is_youtube': bool(video_id),
                'video_id': video_id,
                'timestamp': datetime.now().isoformat(),
                'page_url': page_url
            }
        return None

    # Check if page itself is a video, then scan <a> tags
    self_data = process_url(page_url)
    if self_data: videos_found.append(self_data); visited_video_ids.add(page_url)

    for a_tag in soup.find_all('a', href=True):
        data = process_url(a_tag['href'], a_tag.get_text(strip=True))
        if data: videos_found.append(data); visited_video_ids.add(a_tag['href'])

    return videos_found

def index_video_to_pinecone(video_data, t_name="Unknown"):
    try:
        # Combine title and page URL for embedding context
        input_text = f"{video_data['title']} - Found on {video_data['page_url']}"
        vector = model.encode(input_text).tolist()
        
        # Use video_id as Pinecone ID for uniqueness within the video namespace
        v_id = f"youtube-{video_data['video_id']}" if video_data.get('video_id') else f"video-{re.sub(r'\W+', '_', video_data['url'])[:50]}"
        
        metadata = {
            "url": video_data['url'], 
            "title": video_data['title'],
            "embed_url": video_data['embed_url'],
            "thumbnail_url": video_data['thumbnail_url'],
            "duration": video_data.get('duration'),
            "author": video_data.get('author'),
            "source": "YouTube" if video_data['is_youtube'] else urlparse(video_data['url']).netloc,
            "snippet": video_data.get('description', '')[:500], # Truncate description for Pinecone metadata
            "timestamp": video_data.get('timestamp'),
            "is_video": True,
            "page_found_on": video_data['page_url']
        }

        pc_index.upsert(
            vectors=[{"id": v_id, "values": vector, "metadata": metadata}],
            namespace=NAMESPACE # Use the same namespace as other content for unified search
        )
        return True
    except Exception as e:
        tqdm.write(f"❌ [{t_name}] Pinecone Video Indexing Error for {video_data.get('url', 'N/A')}: {str(e)[:100]}")
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
            if clean_url in visited_urls or not is_high_quality_domain(clean_url):
                active_workers -= 1
                url_queue.task_done()
                continue
            visited_urls.add(clean_url)

        try:
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
            resp = session.get(url, headers=headers, timeout=12, verify=False)
            
            if resp.status_code == 200:
                # Extract and index YouTube videos
                videos = extract_video_info(clean_url, resp.text)
                for video in videos:
                    if index_video_to_pinecone(video, t_name):
                        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        tqdm.write(f"▶️ [{now}] [{t_name}] VIDEO INDEXED: {video['title']} ({video['url']})")
                        with data_lock:
                            runtime_indexed_videos.append(video['url'])
                            pbar.update(1)

                # Find new links to crawl (deep-dive)
                raw_links = re.findall(r'href=["\'](https?://[^\s"\']+|/[^\s"\']+)["\']', resp.text)
                
                new_sub_links = 0
                for l in raw_links:
                    full_link = urljoin(url, l).split('#')[0].rstrip('/')
                    l_parsed = urlparse(full_link)
                    l_domain = l_parsed.netloc

                    with data_lock:
                        if l_domain and full_link not in visited_urls:
                            if l_domain == domain: # Prioritize same-domain links for deep-dive
                                if domain_counts.get(l_domain, 0) < DOMAIN_LIMIT:
                                    url_queue.put(full_link)
                                    new_sub_links += 1
                            else: # Add new domains as seeds, but limit initial discovery
                                if domain_counts.get(l_domain, 0) < 5:
                                    url_queue.put(full_link)
                
                if new_sub_links > 0:
                    tqdm.write(f"📂 [{t_name}] Deep-Dive: Found {new_sub_links} new pages on {domain}")

        except Exception:
            # tqdm.write(f"❌ [{t_name}] Error crawling {clean_url}: {str(e)[:100]}")
            pass # Suppress common crawling errors for cleaner output
        finally:
            with data_lock: active_workers -= 1
            url_queue.task_done()

def run_komu_video_autonomous():
    global pbar, runtime_indexed_videos
    
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r") as f:
            for line in f:
                if "] " in line:
                    try: visited_urls.add(line.split("] ")[1].strip().lower())
                    except: pass

    # Start with initial seeds from DDGS
    seeds = get_seeds_robust(VIDEO_SEARCH_TOPICS)
    for url in seeds: url_queue.put(url)

    print(f"🚀 KOMU VIDEO SCOUT READY. Deep-Crawl & YouTube indexing active.")
    pbar = tqdm(total=None, desc="Live Video Indexing", unit="video", colour="blue")
    
    for i in range(MAX_THREADS):
        threading.Thread(target=crawler_worker, name=f"VideoAgent-{i+1}", daemon=True).start()

    try:
        while True:
            time.sleep(15)
            
            # Save progress
            if len(runtime_indexed_videos) >= 5:
                with data_lock:
                    with open(LOG_FILE, "a") as f:
                        for url in runtime_indexed_videos:
                            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {url}\n")
                    runtime_indexed_videos = []
                    
            if len(visited_urls) > 50000: # Clear visited URLs to allow re-crawling old sites for new videos
                with data_lock: visited_urls.clear()

    except KeyboardInterrupt:
        print(f"\n🛑 Manual Stop. Saving final data...")
    finally:
        pbar.close()

if __name__ == "__main__":
    run_komu_video_autonomous()