import os
import time
import requests
import trafilatura
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET
import re
import json
import threading
import hashlib
from queue import Queue
from urllib.parse import urlparse, urljoin
import urllib3
from pymilvus import MilvusClient, DataType
from sentence_transformers import SentenceTransformer
from colorama import init, Fore, Style

# Initialize terminal colors
init(autoreset=True)

# --- CONFIGURATION INITIALIZATION (WITH GITHUB SECRETS FALLBACK) ---
ZILLIZ_ENDPOINT = os.environ.get("ZILLIZ_ENDPOINT")
ZILLIZ_TOKEN = os.environ.get("ZILLIZ_TOKEN")
COLLECTION_NAME = os.environ.get("COLLECTION_NAME", "plex_index")

if not ZILLIZ_ENDPOINT or not ZILLIZ_TOKEN:
    try:
        import config
        ZILLIZ_ENDPOINT = config.ZILLIZ_ENDPOINT
        ZILLIZ_TOKEN = config.ZILLIZ_TOKEN
        COLLECTION_NAME = getattr(config, 'COLLECTION_NAME', "plex_index")
    except ImportError:
        print(Fore.RED + "❌ ERROR: Zilliz Credentials missing! Define endpoint and token in environment or config.py.")
        exit()

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- STRICT PERFORMANCE & DEPTH CONSTRAINTS ---
MAX_THREADS = 12             
MAX_PAGES_PER_DOMAIN = 100   
MAX_SITEMAP_LINKS = 20       # Limited to 20 per request
MAX_PAGE_DIG_LINKS = 15      # Max links extracted per page layout
MAX_DEPTH = 3                # Limit deep digging to level 3
MAX_TOTAL_PAGES = 100000     
MAX_IMAGES_PER_DOMAIN = 20   

# Local state tracking filenames
HISTORY_FILE = "chrome_history.json"
STATE_FILE = "progress_state.json"

# Global concurrent trackers
visited_urls = set()         
enqueued_urls = set()        
domain_counts = {}           
domain_image_counts = {}     
url_queue = Queue()
data_lock = threading.Lock()
global_pages_indexed = 0    

# Structured Metrics Trackers
recipe_card_count = 0
product_card_count = 0
recipe_images_indexed = 0
product_images_indexed = 0
skipped_duplicate_pages = 0
skipped_duplicate_images = 0

# --- AUTOMATED CONTENT INTEGRITY & FILTER ENGINE ---
ADULT_KEYWORDS = re.compile(
    r'\b(porn|xvideos|pornhub|xxx|adult|erotic|sex|gamble|casino|betting|nudity|naked|gore|brutal)\b', 
    re.IGNORECASE
)

ICON_PATTERNS = re.compile(
    r'(logo|icon|avatar|sprite|badge|loader|spinner|chevron|arrow|favicon|\bpx\b|\b1x1\b)', 
    re.IGNORECASE
)

POPULAR_HUB_PATTERNS = re.compile(
    r'(shop|store|article|news|story|forum|thread|category|product|watch|blog|trending|popular|home|feed|explore|recipe|cook)', 
    re.IGNORECASE
)

DEEP_UNKNOWN_EXCLUSIONS = re.compile(
    r'(wp-includes|cgi-bin|telemetry|track|analytics|session_id=|sid=|_xml|rss|feed/atom)', 
    re.IGNORECASE
)

# Filter out common Search Engines and search result query structures
SEARCH_ENGINE_PATTERN = re.compile(
    r'url\?q=|search\?q=|&query=|\b(google|bing|yahoo|duckduckgo|ecosia|yandex|baidu)\.(com|net|org|co|io|ru)',
    re.IGNORECASE
)

HEURISTIC_MAP = {
    "technology": re.compile(r'(tech|software|phone|gadget|app|mobile|computer|ai|cyber)'),
    "business": re.compile(r'(finance|money|stock|market|economy|crypto|invest|trade|startup|b2b)'),
    "news": re.compile(r'(news|article|press|report|world|politics|election|breaking)'),
    "entertainment": re.compile(r'(movie|show|anime|game|gaming|music|stream|video|tv|hollywood|pop|celeb)'),
    "sports": re.compile(r'(sport|football|soccer|basketball|nba|nfl|match|stadium|cup|league|athlete)'),
    "lifestyle": re.compile(r'(travel|food|cooking|recipe|fashion|style|health|wellness|fitness|gym|hotel)'),
    "education": re.compile(r'(edu|university|school|college|study|learn|course|academy)')
}

print(Fore.CYAN + Style.BRIGHT + "🛰️  KOMU SCOUT - ENGINE INITIALIZING (RICH INTENT EXTRACTOR)...")
print(Fore.YELLOW + "Loading vector embedder (all-mpnet-base-v2)...")
model = SentenceTransformer('all-mpnet-base-v2')

print(Fore.YELLOW + "Connecting to Zilliz Cloud...")
zilliz_client = MilvusClient(uri=ZILLIZ_ENDPOINT, token=ZILLIZ_TOKEN)

# Ensure collection exists with correct schema for string IDs and dynamic metadata
if not zilliz_client.has_collection(COLLECTION_NAME):
    print(Fore.YELLOW + f"📦 Creating Zilliz collection: {COLLECTION_NAME}...")
    # 768 is the output dimension of all-mpnet-base-v2
    zilliz_client.create_collection(
        collection_name=COLLECTION_NAME,
        dimension=768,
        enable_dynamic_field=True  # Allows storing arbitrary metadata like Pinecone
    )

# Force-load the newly migrated collection into high-speed search memory
zilliz_client.load_collection(collection_name=COLLECTION_NAME)

print(Fore.GREEN + "✅ System Fully Connected with Zilliz Cloud & MPNET Embedder.")

def log(action, icon, message, color=Fore.WHITE):
    timestamp = time.strftime('%H:%M:%S')
    print(f"{Fore.LIGHTBLACK_EX}[{timestamp}] {color}{icon} [{action}] {message}")

def is_safe_content(url, text_snippet=""):
    if SEARCH_ENGINE_PATTERN.search(url):
        return False
    combined = (url + " " + text_snippet).lower()
    if ADULT_KEYWORDS.search(combined):
        return False
    return True

def save_crawler_state():
    """Dumps the current tracking progress cleanly to disk."""
    with data_lock:
        state = {
            "visited_urls": list(visited_urls),
            "enqueued_urls": list(enqueued_urls),
            "domain_counts": domain_counts,
            "domain_image_counts": domain_image_counts,
            "global_pages_indexed": global_pages_indexed,
            "recipe_card_count": recipe_card_count,
            "product_card_count": product_card_count,
            "recipe_images_indexed": recipe_images_indexed,
            "product_images_indexed": product_images_indexed,
            "skipped_duplicate_pages": skipped_duplicate_pages,
            "skipped_duplicate_images": skipped_duplicate_images
        }
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"Failed checkpoint save: {e}")

def load_crawler_state():
    """Initializes tracking registers with saved structural runs if present."""
    global global_pages_indexed, recipe_card_count, product_card_count, recipe_images_indexed, product_images_indexed, skipped_duplicate_pages, skipped_duplicate_images
    if not os.path.exists(STATE_FILE):
        return False
    try:
        with open(STATE_FILE, "r") as f:
            state = json.load(f)
        visited_urls.update(state.get("visited_urls", []))
        enqueued_urls.update(state.get("enqueued_urls", []))
        domain_counts.update(state.get("domain_counts", {}))
        domain_image_counts.update(state.get("domain_image_counts", {}))
        global_pages_indexed = state.get("global_pages_indexed", 0)
        recipe_card_count = state.get("recipe_card_count", 0)
        product_card_count = state.get("product_card_count", 0)
        recipe_images_indexed = state.get("recipe_images_indexed", 0)
        product_images_indexed = state.get("product_images_indexed", 0)
        skipped_duplicate_pages = state.get("skipped_duplicate_pages", 0)
        skipped_duplicate_images = state.get("skipped_duplicate_images", 0)
        return True
    except Exception:
        return False

def verify_and_clean_payload(url, content):
    """Performs dual checking verification on text properties before indexing."""
    if not url or not content:
        return False
    
    # Verify the document text content structure isn't corrupted server garbage
    content_stripped = content.strip()
    if "javascript:" in url or content_stripped.startswith(("{", "[", "<")):
        return False
        
    return True

def clean_text_field(value):
    if isinstance(value, dict):
        return value.get("name", "") or value.get("text", "")
    return str(value).strip() if value else ""

def parse_rating_node(data_dict):
    rating_val = "0.0"
    review_count = "0"
    aggregate = data_dict.get("aggregateRating")
    if isinstance(aggregate, dict):
        rating_val = str(aggregate.get("ratingValue", "0.0"))
        review_count = str(aggregate.get("reviewCount", aggregate.get("ratingCount", "0")))
    return rating_val, review_count

def extract_schema_image(node, base_url):
    img_node = node.get("image")
    img_url = ""
    if isinstance(img_node, str):
        img_url = img_node
    elif isinstance(img_node, list) and img_node:
        img_url = img_node[0] if isinstance(img_node[0], str) else img_node[0].get("url", "")
    elif isinstance(img_node, dict):
        img_url = img_node.get("url", "")
    return urljoin(base_url, img_url) if img_url else ""

def fallback_high_quality_image(soup, base_url):
    og_tag = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "twitter:image"})
    if og_tag and og_tag.get("content"):
        return urljoin(base_url, og_tag["content"])
    return ""

def index_to_zilliz(url, content, domain, is_image=False, alt_text="", category="general", card_type="none", card_details="{}"):
    global skipped_duplicate_pages, skipped_duplicate_images
    try:
        input_data = (alt_text if is_image else str(content))[:1000]
        if len(input_data.strip()) < 15:
            return False 
        
        # 1. Generate Deterministic Unique Vector Identification String
        v_id = hashlib.md5((url + hashlib.sha1(input_data.encode()).hexdigest()[:10]).encode('utf-8')).hexdigest()
        
        # 2. Vector DB Duplicate Radar Check (Using 'expr' to search the primary key VARCHAR)
        res = zilliz_client.get(collection_name=COLLECTION_NAME, ids=[v_id])
        if res:
            with data_lock:
                if is_image:
                    skipped_duplicate_images += 1
                else:
                    skipped_duplicate_pages += 1
            log("SKIP DUP", "🛡️", f"Asset identity already verified in Zilliz. ID: {v_id} | Type: {'Image' if is_image else 'Text'}", Fore.YELLOW)
            return True

        # 3. Proceed to model encoding
        vector = model.encode(input_data).tolist()
        
        # 4. Ingest using the EXACT schema names from your screen
        zilliz_client.insert(
            collection_name=COLLECTION_NAME,
            data=[{
                "id": v_id,                     # Verified lowercase 'id' from schema
                "vector": vector,               # Verified lowercase 'vector' from schema
                "namespace": "komu_scout",      # Matches 'namespace' field from schema
                "text": input_data[:800],        # Lands automatically into 'Dynamic Field'
                "url": url, 
                "domain": domain, 
                "is_image": is_image, 
                "category": category, 
                "card_type": card_type, 
                "card_details": card_details
            }]
        )
        log("INDEXED", "🧠", f"Successfully pushed vector entry into Zilliz. ID: {v_id}", Fore.GREEN)
        return True
    except Exception as e:
        log("INDEX ERR", "❌", f"Vector tracking transmission error: {e}", Fore.RED)
        return False

def deep_extract_rich_cards(soup, base_url, domain):
    global recipe_card_count, product_card_count, recipe_images_indexed, product_images_indexed
    script_tags = soup.find_all('script', type='application/ld+json')
    for tag in script_tags:
        try:
            if not tag.string:
                continue
            raw_json = json.loads(tag.string)
            nodes = raw_json if isinstance(raw_json, list) else [raw_json]
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                if "@graph" in node:
                    nodes.extend(node["@graph"])
                    continue

                context_type = node.get("@type", "")
                if isinstance(context_type, list):
                    context_type = context_type[0] if context_type else ""
                c_type_lower = str(context_type).lower()
                card_image = extract_schema_image(node, base_url)
                if not card_image:
                    card_image = fallback_high_quality_image(soup, base_url)
                
                if "recipe" in c_type_lower:
                    rating, total_reviews = parse_rating_node(node)
                    calories = "0 kcal"
                    nutrition = node.get("nutrition")
                    if isinstance(nutrition, dict):
                        calories = str(nutrition.get("calories", "0 kcal"))
                    
                    item_name = node.get('name', 'Unknown Dish')
                    with data_lock:
                        recipe_card_count += 1
                    
                    details = {"rating": rating, "reviews": total_reviews, "calories": calories, "card_image": card_image}
                    log("STRUCTURED CARD", "🍲", f"Recipe Classified: {item_name} | Image Link: {card_image}", Fore.GREEN)
                    
                    # Securely Index the primary Card Image if safe
                    if card_image and is_safe_content(card_image):
                        alt_description = f"Primary recipe card media presentation asset for {item_name}."
                        if index_to_zilliz(card_image, None, domain, is_image=True, alt_text=alt_description, category="lifestyle", card_type="recipe", card_details=json.dumps(details)):
                            with data_lock:
                                recipe_images_indexed += 1
                            log("VERIFIED CARD IMAGE", "🖼️", f"Processed recipe asset -> {card_image}", Fore.BLUE)
                            
                    return "recipe", json.dumps(details)

                elif "product" in c_type_lower:
                    rating, total_reviews = parse_rating_node(node)
                    price, currency = "0.00", "USD"
                    offers = node.get("offers")
                    if isinstance(offers, dict):
                        price = str(offers.get("price", "0.00"))
                        currency = str(offers.get("priceCurrency", "USD"))
                    
                    item_name = node.get('name', 'Unknown Item')
                    with data_lock:
                        product_card_count += 1
                        
                    details = {"rating": rating, "reviews": total_reviews, "price": price, "currency": currency, "card_image": card_image}
                    log("STRUCTURED CARD", "🏷️", f"Product Classified: {item_name} | Image Link: {card_image}", Fore.GREEN)
                    
                    # Securely Index the primary Card Image if safe
                    if card_image and is_safe_content(card_image):
                        alt_description = f"Commercial layout retail product image for {item_name}."
                        if index_to_zilliz(card_image, None, domain, is_image=True, alt_text=alt_description, category="business", card_type="product", card_details=json.dumps(details)):
                            with data_lock:
                                product_images_indexed += 1
                            log("VERIFIED CARD IMAGE", "🖼️", f"Processed product asset -> {card_image}", Fore.BLUE)
                            
                    return "product", json.dumps(details)
        except Exception:
            continue
    return "none", "{}"

def fast_automated_intent_classifier(url, html_soup, body_text):
    url_lower = url.lower()
    for category, regex in HEURISTIC_MAP.items():
        if regex.search(url_lower):
            return category
    return "general"

def scan_and_enlist_links(soup, current_url, current_depth):
    if current_depth >= MAX_DEPTH:
        return
    
    extracted_links = 0
    for a_tag in soup.find_all('a', href=True):
        if extracted_links >= MAX_PAGE_DIG_LINKS:
            break
            
        href = a_tag['href']
        full_link = urljoin(current_url, href).split('#')[0].rstrip('/')
        parsed_link = urlparse(full_link)
        
        if parsed_link.scheme not in ['http', 'https'] or re.search(r'\.(zip|exe|mp4|pdf|css|js|json|png|jpg|jpeg|gif|svg)$', full_link.lower()) or DEEP_UNKNOWN_EXCLUSIONS.search(full_link):
            continue
        
        target_domain = parsed_link.netloc

        with data_lock:
            if full_link not in enqueued_urls and full_link not in visited_urls:
                if domain_counts.get(target_domain, 0) < MAX_PAGES_PER_DOMAIN:
                    enqueued_urls.add(full_link) 
                    url_queue.put((full_link, current_depth + 1))
                    extracted_links += 1

def parse_sitemap_xml(sitemap_content):
    extracted = []
    try:
        root = ET.fromstring(sitemap_content)
        namespace = {'ns': root.tag.split('}')[0].strip('{')} if '}' in root.tag else {}
        find_path = './/ns:loc' if namespace else './/loc'
        for elem in root.findall(find_path, namespace):
            if len(extracted) >= MAX_SITEMAP_LINKS: 
                break
            url = elem.text.strip() if elem.text else ""
            if url and is_safe_content(url) and not DEEP_UNKNOWN_EXCLUSIONS.search(url):
                extracted.append(url)
    except Exception: pass
    return extracted

def crawler_worker(session):
    global global_pages_indexed
    while True:
        with data_lock:
            if global_pages_indexed >= MAX_TOTAL_PAGES: break
        queue_item = url_queue.get()
        if queue_item is None: break
        url, depth = queue_item
        domain = urlparse(url).netloc

        with data_lock:
            if url in visited_urls:
                url_queue.task_done()
                continue
            current_hits = domain_counts.get(domain, 0)
            if current_hits >= MAX_PAGES_PER_DOMAIN:
                url_queue.task_done()
                continue
            visited_urls.add(url)
            domain_counts[domain] = current_hits + 1

        try:
            if not is_safe_content(url):
                url_queue.task_done()
                continue
                
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
            resp = session.get(url, headers=headers, timeout=5, verify=False)
            if resp.status_code == 200:
                content_type = resp.headers.get('Content-Type', '')
                if 'xml' in content_type or url.endswith('.xml'):
                    sitemap_links = parse_sitemap_xml(resp.content)
                    for s_link in sitemap_links:
                        with data_lock:
                            if s_link not in enqueued_urls and s_link not in visited_urls:
                                enqueued_urls.add(s_link)
                                url_queue.put((s_link, 1))
                    url_queue.task_done()
                    continue

                if 'text/html' in content_type:
                    soup = BeautifulSoup(resp.text, 'lxml')
                    card_type, card_details = deep_extract_rich_cards(soup, url, domain)
                    article_text = trafilatura.extract(resp.text, include_comments=False) or ""
                    
                    if not article_text or not verify_and_clean_payload(url, article_text):
                        url_queue.task_done()
                        continue

                    category = fast_automated_intent_classifier(url, soup, article_text)
                    log("SCOUT", "🧠", f"[Layer {depth}] Processing [{category.upper()}] -> {url}", Fore.LIGHTMAGENTA_EX)

                    if len(article_text) > 150:
                        chunks = [article_text[i:i+800] for i in range(0, len(article_text), 720)]
                        for chunk in chunks:
                            index_to_zilliz(url, chunk, domain, category=category, card_type=card_type, card_details=card_details)
                        with data_lock: global_pages_indexed += 1
                    
                    scan_and_enlist_links(soup, url, depth)
        except Exception: pass 
        finally: 
            url_queue.task_done()

if __name__ == "__main__":
    is_restored = load_crawler_state()
    if is_restored:
        print(Fore.GREEN + f"♻️ Restored execution state! Resuming with {len(visited_urls)} tracked assets.")
    
    # Process the Chrome History File seeding if queue initialized empty
    if url_queue.empty() and os.path.exists(HISTORY_FILE):
        print(Fore.CYAN + "📥 Reading chrome_history.json targets...")
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                history_data = json.load(f)
                
            if isinstance(history_data, dict):
                entries = history_data.get("Browser History", history_data.get("history", []))
            else:
                entries = history_data
                
            seeded_count = 0
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                raw_url = entry.get("url", "")
                if raw_url and is_safe_content(raw_url):
                    cleaned_url = raw_url.strip()
                    if cleaned_url not in enqueued_urls and cleaned_url not in visited_urls:
                        url_queue.put((cleaned_url, 1))
                        enqueued_urls.add(cleaned_url)
                        seeded_count += 1
            print(Fore.GREEN + f"✅ Loaded {seeded_count} validated entry URLs from browser history metadata.")
        except Exception as e:
            print(Fore.RED + f"⚠️ History processing failure: {e}. Falling back to default origins.")

    if url_queue.empty():
        print(Fore.YELLOW + "⚠️ Warning: Queue empty. Initializing network baseline anchor nodes.")
        for fallback in ["https://github.com", "https://news.ycombinator.com"]:
            url_queue.put((fallback, 1))
            enqueued_urls.add(fallback)

    session_pool = requests.Session()
    adapter = requests.adapters.HTTPAdapter(pool_connections=MAX_THREADS, pool_maxsize=MAX_THREADS*2)
    session_pool.mount('http://', adapter)
    session_pool.mount('https://', adapter)

    threads = []
    for i in range(MAX_THREADS):
        t = threading.Thread(target=crawler_worker, args=(session_pool,), daemon=True)
        t.start()
        threads.append(t)
        
    try:
        # Save structural checkpoint every 30 seconds asynchronously 
        while url_queue.unfinished_tasks > 0:
            time.sleep(30)
            save_crawler_state()
    except KeyboardInterrupt:
        print(Fore.YELLOW + "\nSaving current runtime state before interruption...")
    
    url_queue.join()
    for _ in range(MAX_THREADS): url_queue.put(None)
    for t in threads: t.join()
    
    # Persist final state tracking logs
    save_crawler_state()
    
    print("\n" + "="*60)
    print(Fore.GREEN + Style.BRIGHT + f"🎉 Exploration Complete. Global Targets Indexed: {global_pages_indexed}")
    print(Fore.YELLOW + f"🛡️  Total Text Duplicates Prevented:               {skipped_duplicate_pages}")
    print(Fore.YELLOW + f"🛡️  Total Image Duplicates Prevented:              {skipped_duplicate_images}")
    print(Fore.CYAN + f"🍲 Total Discovered Recipe Cards:                  {recipe_card_count}")
    print(Fore.BLUE + f"🖼️  --> Total Recipe Images Vectorized to Zilliz:   {recipe_images_indexed}")
    print(Fore.CYAN + f"🏷️  Total Discovered Product Cards:                 {product_card_count}")
    print(Fore.BLUE + f"🖼️  --> Total Product Images Vectorized to Zilliz:  {product_images_indexed}")
    print("="*60)