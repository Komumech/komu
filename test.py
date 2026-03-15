import time
from playwright.sync_api import sync_playwright
import urllib3

# Suppress warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def test_envato_bypass():
    with sync_playwright() as p:
        print("🚀 Launching Browser...")
        # We set headless=False so YOU can see it work
        browser = p.chromium.launch(headless=False) 
        
        # Create a context with a real-looking browser identity
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        url = "https://envato.com"
        print(f"📡 Navigating to: {url}")

        try:
            # Go to the site
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            
            print("⏳ Waiting for Cloudflare challenge to resolve (5 seconds)...")
            time.sleep(5) 

            # Extract the data using Javascript
            result = page.evaluate("""() => {
                const getMeta = (prop) => {
                    const el = document.querySelector(`meta[property="${prop}"]`) || 
                               document.querySelector(`meta[name="${prop}"]`);
                    return el ? el.content : null;
                };

                return {
                    title: document.title,
                    og_image: getMeta('og:image'),
                    twitter_image: getMeta('twitter:image'),
                    favicon: document.querySelector('link[rel*="icon"]') ? document.querySelector('link[rel*="icon"]').href : null
                };
            }""")

            print("\n" + "="*40)
            print("📊 TEST RESULTS")
            print("="*40)
            print(f"Title: {result['title']}")
            
            # Pick the best image found
            final_logo = result['og_image'] or result['twitter_image'] or result['favicon']
            
            if "moment" in result['title'].lower():
                print("❌ STATUS: STILL BLOCKED (Cloudflare won)")
            else:
                print(f"✅ STATUS: BYPASS SUCCESSFUL")
                print(f"🖼️ LOGO FOUND: {final_logo}")
            print("="*40)

        except Exception as e:
            print(f"🚨 Error: {e}")
        
        print("\nClosing browser in 3 seconds...")
        time.sleep(3)
        browser.close()

if __name__ == "__main__":
    test_envato_bypass()