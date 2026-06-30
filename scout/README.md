# Scout: A Super-Lightweight Neural Search Engine

A search engine built to work a bit like biological brain pathways, keeping things fast and cheap.

I decided to build this using a sparse neural approach because I wanted to try a completely different approach to search, and honestly, because I had to. Standard semantic search relies on massive, heavy vector databases that hog a ton of RAM. Since I'm building this on free tiers and don't have funding for expensive database servers, I had to find a workaround. Scout maps text into simple **Concept IDs** and **Weights** instead of giant coordinate graphs. Everything is stored in a highly compressed, edge-cached SQLite database. This completely cuts out the heavy hosting bills while keeping search queries incredibly fast.

---

## 🖥️ Interface Preview

![Scout Landing Page](scout-landing.png)
*Figure 1: The clean and simple search home screen.*

![Scout Search Results](scout-results.png)
*Figure 2: The results layout showing ranked matches and page descriptions.*

![Scout Engine Diagnostics](scout-diagnostics.png)
*Figure 3: A peek under the hood at how Concept IDs and weights get processed.*

---

## 🧠 How It Works

Scout handles searching a lot like how signals travel through a brain. Instead of turning words into long lists of decimal points, the engine follows a simple four-step pipeline:

1. **Smart Crawling:** It grabs high-quality documentation pages and strips out the clutter to leave just the core text.
2. **Concept Matching:** The raw text runs through the `BGE-M3` model, which figures out the actual meaning behind the words and breaks them down into specific **Concept IDs** (like neurons) and **Weights** (how important that concept is).
3. **Saving the Index:** The original messy text is thrown away to save space. Only the numeric concept IDs and weights are packed into a tiny, flat-binary **SQLite** database file.
4. **Running on the Edge:** That index file sits on **Cloudflare R2** storage. When someone searches for something, quick serverless functions pull just the exact slices of the database they need, keeping response times ultra-low.

## 🛠️ The Repositories

To keep things tidy, the project is split into two separate parts:
* **The Core UI (This Repo):** Handles the frontend, processes search queries, runs the serverless API, and ranks results on the fly.
* **The Crawler (https://github.com/Komumech/scout-crawl):** Does the heavy lifting of scraping the web, cleaning the text, and generating the database files.

---

## 💾 Database Setup

The database uses two simple tables inside SQLite to scale up easily without breaking free-tier limits:

### 1. The Concept Index (`concept_index`)
This connects specific concept numbers directly to the web pages they belong to. It lets the engine skip heavy vector graph math entirely.
* `concept_id` — The number representing a specific idea or word.
* `site_id` — A pointer to the web page.
* `weight` — How important this concept is to the page.
* `interaction_multiplier` — A small boost score that goes up automatically when users click a link, making popular results naturally climb higher over time.

### 2. The Metadata Store (`site_metadata`)
A lightweight table that only gets queried at the very end to grab the text shown on the screen.
* `id` — The page ID.
* `url` — The web address.
* `title` — The page title.
* `snippet` — A quick 300-character description of what's on the page.

---

## ⚡ Key Features

* **No Extra Keyword Tables:** Normal search engines have to awkwardly glue keyword search and AI search together. Because of how `BGE-M3` works, it handles regular exact-word matches and deep conceptual matches inside the exact same table lookup.
* **User-Driven Re-ranking:** The search paths adapt. If people constantly click a specific result for a query, its multiplier ticks up, and the engine naturally pushes it to the top for the next person.
* **Freshness Boost:** It keeps a tiny temporary cache to spot trending topics. If a specific keyword suddenly gets a traffic spike, the engine temporarily gives newly crawled pages a boost so you see the newest docs first.

## 🚀 Tech Stack

* **AI Model:** BGE-M3 (Sparse Vector Output)
* **Database:** SQLite (with FTS5 extension)
* **Hosting:** Cloudflare R2 Object Storage
* **Backend:** Serverless Node.js / Python

