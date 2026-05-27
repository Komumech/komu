import os
from indexer import index_website
from tqdm import tqdm

# --- CONFIGURATION ---
INPUT_FILE = 'formatted_high_signal.txt'
PROCESSED_LOG = 'processed_log.txt'
BATCH_SIZE = 500  # Number of links to process in one run

def parse_signal_file(filepath):
    """
    Parses the signal file, handling the specific format: "domain.com",
    and converts them into valid URLs for the indexer.
    """
    links = []
    if not os.path.exists(filepath):
        print(f"❌ Error: {filepath} not found.")
        return links
        
    print(f"📖 Reading {filepath}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            # Remove quotes, commas, and whitespace
            clean_domain = line.strip().replace('"', '').replace(',', '').strip()
            if clean_domain:
                # Ensure it's a valid URL for trafilatura
                if not clean_domain.startswith('http'):
                    url = f"https://{clean_domain}"
                else:
                    url = clean_domain
                links.append(url)
    return links

def run_batch_process():
    """
    Main loop that filters out already indexed links and processes a new batch.
    """
    print("🛰️  KOMU SCOUT: Batch Indexing System Activated")
    
    # 1. Load potential links
    all_links = parse_signal_file(INPUT_FILE)
    if not all_links:
        return
    
    # 2. Load already processed links (the "Save Game" state)
    processed_links = set()
    if os.path.exists(PROCESSED_LOG):
        with open(PROCESSED_LOG, 'r', encoding='utf-8') as f:
            processed_links = set(line.strip() for line in f.readlines())

    # 3. Filter out completed work
    remaining_links = [l for l in all_links if l not in processed_links]
    
    total = len(all_links)
    done = len(processed_links)
    todo = len(remaining_links)
    
    print(f"📊 Total: {total} | Indexed: {done} ({(done/total)*100:.1f}%) | Remaining: {todo}")

    # 4. Slice the batch
    current_batch = remaining_links[:BATCH_SIZE]
    
    if not current_batch:
        print("🎉 MISSION COMPLETE: All links in the signal file have been processed.")
        return

    print(f"📦 Starting batch of {len(current_batch)} links...")

    # 5. Process and Log
    for url in tqdm(current_batch, desc="Indexing Batch", unit="link"):
        # Call the existing indexing logic from indexer.py
        if index_website(url):
            # If successful, record the URL to processed_log.txt immediately
            with open(PROCESSED_LOG, 'a', encoding='utf-8') as f:
                f.write(f"{url}\n")

if __name__ == "__main__":
    run_batch_process()