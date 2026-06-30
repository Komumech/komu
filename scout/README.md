# Scope: Sparse Neural Search Engine

An ultra-lightweight, production-grade search engine designed around biological neural pathways. Instead of relying on expensive, heavy geometric vector databases that demand massive RAM footprints, Scope leverages sparse concept encoding to achieve AI-level semantic understanding within a highly efficient, edge-cached inverted index.

## 🧠 Architecture Overview

Scope treats the search process similarly to synaptic pathways in the human brain. Rather than mapping text into continuous float coordinate spaces, the engine uses a multi-stage, high-efficiency pipeline:

1. **Targeted Crawling:** High-value, curated documentation fields are parsed down to their core structural content.
2. **Sparse Concept Transformation:** The raw text content is passed through the `BGE-M3` model, expanding semantic intents and converting text into specific **Concept IDs** (neurons) and **Weights** (synaptic strength).
3. **Index Serialization:** The raw source text is discarded to preserve storage space. The numeric concept IDs and weights are serialized into a highly compressed, flat-binary **SQLite** database.
4. **Edge Deployment:** The compiled index database is hosted on **Cloudflare R2**. When a user executes a query, serverless functions use optimized HTTP range requests to read binary segments from the index at ultra-low latency.

## 🛠️ Repository Ecosystem

To maintain clean module boundaries, the codebase is separated into two decoupled pipelines:
* **Core Engine Interface (This Repo):** Manages the frontend UI, query processing, serverless API execution, and live dynamic ranking.
* **[Scope Crawler Pipeline](REPLACE_WITH_YOUR_CRAWLER_REPO_LINK):** Handles targeted web scraping, cleaning, tokenization, batch model inference, and index generation.

---

## 💾 Database Schema Optimization

The core matching architecture utilizes two optimized data layers inside SQLite to scale millions of records over free-tier object storage:

### 1. Inverted Concept Index (`concept_index`)
Maps individual numeric conceptual components directly to document identifiers, allowing the engine to completely bypass standard vector graph searching.
* `concept_id` (Integer, Indexed) — The unique abstract language concept token.
* `site_id` (Integer) — Relational pointer to the indexed resource.
* `weight` (Real) — Structural model significance score.
* `interaction_multiplier` (Real) — Dynamic bias variable updated continuously via user click-stream loops to simulate synaptic reinforcement.

### 2. Document Metadata Store (`site_metadata`)
A lightweight lookup layer queried only *after* the primary ranking phase to serve the final user interface.
* `id` (Integer, Primary Key)
* `url` (Text)
* `title` (Text)
* `snippet` (Text) — Highly refined 300-character descriptive preview.

---

## ⚡ Core Features & Algorithmic Shifting

* **No Keyword Overhead:** Traditional engines require an independent keyword index (like BM25) paired awkwardly with a vector model. Because `BGE-M3` tokenizes explicit words alongside abstract synonyms within the same 250,000-token vocabulary, keyword matching and semantic search run natively inside a single unified table lookup.
* **Synaptic Plasticity:** Search pathways are dynamically reinforced. When users consistently engage with a specific search result, its `interaction_multiplier` increments, adjusting the global ranking weights natively based on communal intent.
* **Real-Time Freshness Multiplier:** Integrates an in-memory traffic cache layer to identify trending query spikes. When a topic trends, the engine injects a time-decay freshness function to dynamically boost newly crawled documentation pages to the top of the search stack.

## 🚀 Technical Requirements & Stack

* **Language Model:** BGE-M3 Sparse Vector Output
* **Database Engine:** SQLite + FTS5 Extension
* **Edge Infra:** Cloudflare R2 Cloud Object Storage
* **Backend Run:** Serverless Node.js / Python

