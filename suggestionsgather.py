import requests
import json
import os
from datetime import datetime
import string
import time

# --- CONFIG ---
# This matches the log file used in crawlernew3.py for consistency
SUGGESTIONS_LOG = "search_suggestions_history.txt"

def get_google_suggestions(query):
    """
    Taps into live Google Search trends to gather all current suggestions.
    Since the API doesn't send dates, we record the timestamp locally 
    to allow for filtering later.
    """
    try:
        url = f"http://suggestqueries.google.com/complete/search?client=chrome&q={query}"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'}
        resp = requests.get(url, headers=headers, timeout=5)
        
        if resp.status_code == 200:
            data = resp.json()
            suggestions = [s for s in data[1] if len(s) > 3]
            
            if suggestions:
                timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                print(f"✅ Captured {len(suggestions)} queries for '{query}'")
                # Append results to the history file with the timestamp
                with open(SUGGESTIONS_LOG, "a", encoding="utf-8") as f:
                    for s in suggestions:
                        f.write(f"[{timestamp}] {s}\n")
                return suggestions
    except Exception as e:
        print(f"⚠️ Error gathering for '{query}': {e}")
    return []

def filter_suggestions_by_date(date_str):
    """
    Reads the log file and filters entries by a specific date.
    date_str format: 'YYYY-MM-DD' (e.g., '2026-05-25')
    """
    if not os.path.exists(SUGGESTIONS_LOG):
        print("❌ Suggestion history file not found.")
        return

    print(f"📊 Trending searches recorded on {date_str}:")
    print("-" * 60)
    
    count = 0
    with open(SUGGESTIONS_LOG, "r", encoding="utf-8") as f:
        for line in f:
            # Lines are stored as: [YYYY-MM-DD HH:MM:SS] query
            if line.startswith(f"[{date_str}"):
                # Display the line
                print(f"  {line.strip()}")
                count += 1
                
    if count == 0:
        print(f"No records found for {date_str}.")

if __name__ == "__main__":
    # To be general and "search all of it," we iterate through the alphabet 
    # combined with common high-traffic prefixes.
    print("🛰️ Starting BROAD suggestion gathering session...")
    
    alphabet = list(string.ascii_lowercase)
    prefixes = ["how", "what", "why", "best", "top", "new", "is", "can", "future"]
    
    # This generates ~230 diverse seed queries (e.g., "how a", "how b", "best a"...)
    for p in prefixes:
        for char in alphabet:
            query = f"{p} {char}"
            get_google_suggestions(query)
            # Respect the API with a tiny delay to prevent getting temporary IP bans
            time.sleep(0.2)
    
    # 2. Example: Filter history to see everything captured today
    print("\n" + "="*60)
    print("🏁 BROAD SCAN COMPLETE")
    today = datetime.now().strftime('%Y-%m-%d')
    filter_suggestions_by_date(today)