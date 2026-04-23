import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieSession from 'cookie-session';
import { Pinecone } from '@pinecone-database/pinecone';
import axios from 'axios';
import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { pipeline, RawImage } from '@xenova/transformers';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini (For Summaries & AI Overview only)
const rawKey = (process.env.GEMINI_API_KEY || '').trim();
const genAI = new GoogleGenerativeAI(rawKey);
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Local Multimodal "Scout Vision" Engine (768 dimensions)
let text_pipe: any = null;
let vision_pipe: any = null;
let isModelLoading = false;

// PRO-ACTIVE WARMUP: Start loading models immediately
setTimeout(() => {
  getPipes().catch(() => {});
}, 1000);

async function getPipes() {
  if (text_pipe) return { text_pipe, vision_pipe };
  if (isModelLoading) return null;
  
  try {
    isModelLoading = true;
    console.log("🚀 Warming Multimodal Engines (768-dim)...");
    
    // Semantic Encoder (768-dim) optimized for speed and accuracy
    text_pipe = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');
    
    // CLIP features - we attempt this in background to avoid blocking if possible
    getPipesVision().catch(() => {});

    console.log("✅ Scout Multimodal Engine ready!");
    return { text_pipe, vision_pipe };
  } catch (err: any) {
    console.error("❌ Multimodal Engine failure:", err.message);
    return null;
  } finally {
    isModelLoading = false;
  }
}

async function getPipesVision() {
  if (vision_pipe) return vision_pipe;
  try {
    vision_pipe = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
    return vision_pipe;
  } catch (e) {
    return null;
  }
}

async function getEmbedding(text: string): Promise<number[] | null> {
  if (!text) return null;
  try {
    const pipes = await getPipes();
    if (pipes?.text_pipe) {
      const output = await pipes.text_pipe(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    }
  } catch (err: any) {
    console.warn("⚠️ Local embedding failed:", err.message);
  }

  // Backup for deployment (768 matching dimensionality)
  if (rawKey && rawKey.length > 20) {
    try {
      const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const result = await embeddingModel.embedContent({
        content: { parts: [{ text }], role: 'user' },
        taskType: TaskType.RETRIEVAL_QUERY,
        outputDimensionality: 768,
      } as any);
      if (result?.embedding?.values) return result.embedding.values;
    } catch (e) {}
  }
  return null;
}

// Local Intent Detection Helper (Simplified for Vercel/Efficiency)
async function detectLocalIntent(query: string) {
  const q = query.toLowerCase().trim();
  
  // 1. Quick RegEx for obvious patterns
  const prefixMatch = q.match(/^(define|meaning of|definition of|synonym for|antonym for|what is the meaning of|what is the definition of)\s+(.+)/i);
  if (prefixMatch) {
    const word = prefixMatch[2].trim();
    if (word) return { is_dictionary: true, dictionary_word: word, is_english_help: false, is_entity: false };
  }

  const suffixMatch = q.match(/^(.+)\s+(meaning|definition)$/i);
  if (suffixMatch) {
    const word = suffixMatch[1].trim();
    if (word) return { is_dictionary: true, dictionary_word: word, is_english_help: false, is_entity: false };
  }

  const englishMatch = q.match(/^(how to spell|correct spelling of|grammar check|is .+ correct|how to use)\s+(.+)/i);
  if (englishMatch) {
    return { is_dictionary: false, is_english_help: true, is_entity: false };
  }

  // Fallback for names/entities (Simple heuristics)
  const entityWords = ['who is', 'what is', 'where is', 'tell me about', 'biography of', 'history of'];
  const entityMatch = entityWords.find(w => q.startsWith(w));
  if (entityMatch) {
    const name = q.replace(entityMatch, '').trim();
    if (name.length > 2) {
      return { is_dictionary: false, is_english_help: false, is_entity: true, entity_name: name };
    }
  }

  return { is_dictionary: false, is_english_help: false, is_entity: false };
}

function cleanSnippet(text: string) {
  if (!text) return '';
  return text
    .replace(/\[\d+\]/g, '') // Remove citations like [1]
    .replace(/(\||\-|─|═){2,}(\s?(\||\-|─|═){2,})*/g, ' ') // Remove noise like || --- ||
    .replace(/\s+/g, ' ')
    .trim();
}

function prettifyTitle(title: string, url: string) {
  if (!url || !title) return title;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    
    // Domain names often have dashes or are lowercase
    const domainPart = parsed.hostname.replace('www.', '').split('.')[0];
    const capitalizedDomain = domainPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    // Only prettify if there's a multi-segment path
    if (path && path !== '/' && path.length > 3) {
      const segments = path.split('/').filter(s => s && !s.includes('.') && s.length > 2);
      
      if (segments.length > 0) {
        // If the title is generic or just the domain, add context
        const lowTitle = title.toLowerCase();
        const lastSegment = segments[segments.length - 1]
          .replace(/(_|-)/g, ' ')
          .split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
          
        if (lowTitle.includes(domainPart.toLowerCase()) || title.length < 5) {
          return `${capitalizedDomain} | ${lastSegment}`;
        }
        
        // Ensure breadcrumb style: Title | Sub-page
        if (!lowTitle.includes(lastSegment.toLowerCase())) {
          return `${title} | ${lastSegment}`;
        }
      }
    }
  } catch (e) {}
  return title;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.set('trust proxy', 1); // Required for secure cookies behind proxies
app.use(cors());
  
  // SECURE COOKIES FOR IFRAME
  app.use(cookieSession({
    name: 'session',
    keys: [process.env.COOKIE_SECRET || 'scout-secret'],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: true,
    sameSite: 'none',
    httpOnly: true,
  }));

  // PINECONE INIT
let pinecone: Pinecone | null = null;
const getPinecone = () => {
  if (!pinecone) {
    if (!process.env.PINECONE_KEY) return null;
    pinecone = new Pinecone({ apiKey: process.env.PINECONE_KEY.trim() });
  }
  return pinecone;
};

// --- API ROUTES ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// SEARCH SUGGESTIONS PROXY
app.get('/api/suggestions', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
      const response = await axios.get(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q as string)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });
    res.json(response.data[1] || []);
  } catch (error) {
    res.json([]);
  }
});

// SEARCH VIA PINECONE (Supports direct query, pre-generated vector, or visual image query)
app.post('/api/search', async (req, res) => {
  const { query, vector: providedVector, page = 1, type = 'all', clickedUrls = [], imageQuery } = req.body;
  const pageSize = 10;
  const skip = (page - 1) * pageSize;
  
  const pc = getPinecone();
  if (!pc) return res.status(503).json({ error: 'Pinecone not configured' });
  const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
  const namespace = process.env.PINECONE_NAMESPACE || '';

  let finalQuery = query;
  let correction = null;

  // VISUAL SEARCH LOGIC (Google-Grade Similarity Search)
  let visualVector: number[] | null = null;
  let visualMathProblem: any = null;
  if (imageQuery && imageQuery.startsWith('data:image')) {
    try {
      console.log("Scout Vision: Stage 1 - Feature Extraction...");
      const [mime, base64] = imageQuery.split(',');
      const mimeType = mime.split(':')[1].split(';')[0];
      
      const visionPrompt = `Act as a visual analyzer for a search engine. Break this image into a 'Mathematical Fingerprint'.
      Be extremely specific. Focus on: Primary Objects, Colors, Textures, Geometric Shapes, and Style.
      Output ONLY a dense string of 50 descriptive tokens/keywords. NO sentences.`;
      
      let visualDescription = "";
      if (rawKey && rawKey.length > 20) {
        const visionResult = await aiModel.generateContent([
          visionPrompt,
          { inlineData: { data: base64, mimeType } }
        ] as any);
        visualDescription = visionResult.response.text().trim();
        visualMathProblem = {
          features: visualDescription.split(',').map(s => s.trim()).slice(0, 12),
          timestamp: new Date().toISOString()
        };
      }

      // Stage 2: Vectorization
      if (visualDescription) {
        visualVector = await getEmbedding(visualDescription);
        console.log(`✅ Scout Vision: Stage 2 - Vectorization Complete (${visualVector?.length} dims)`);
      } else {
        const pipes = await getPipes();
        if (pipes?.vision_pipe) {
          try {
            // Direct Data URL ingestion is highly robust for RawImage
            const image = await RawImage.read(imageQuery);
            const output = await pipes.vision_pipe(image);
            visualVector = Array.from(output.data);
            if (visualVector.length === 512) visualVector = [...visualVector, ...Array(256).fill(0)];
          } catch (innerErr: any) {
             console.warn("Local Vision extraction failure (Falling back):", innerErr.message);
          }
        }
      }
    } catch (err: any) {
      console.warn("Scout Vision extraction failure (Metadata fallback enabled):", err.message);
    }
  }

  // 0. Autocorrect (Only if not a visual search)
  if (!imageQuery) {
    try {
      if (rawKey && rawKey.length > 20) {
        const prompt = `Act as a search engine spell checker. Check if "${query}" has obvious typos. 
        If it has an obvious typo, return ONLY the corrected string. 
        If it is likely correct or a brand name, return the exact same string.
        Be conservative. Only correct if you are 95% certain (e.g. "icy veinds" -> "icy veins").`;
        
        const r = await aiModel.generateContent(prompt);
        const text = r.response.text()?.trim() || "";
        
        if (text.toLowerCase() !== query.toLowerCase() && text.length > 0 && text.length < 100) {
          correction = text;
          finalQuery = text;
        }
      }
    } catch (e) {
      console.log("Gemini Autocorrect skipped");
    }
  }

  // 1. Process Intent (LOCAL MODELS - NO API LIMITS)
  const intentData = await detectLocalIntent(finalQuery);
  let dictionaryResult = null;
  let suggestKnowledgePanel = intentData?.is_entity || false;
  let detectedEntity = intentData?.is_entity ? { name: intentData.entity_name, type: null } : null;
  let isEnglishHelp = intentData?.is_english_help || false;

  if (intentData?.is_dictionary && intentData.dictionary_word) {
    try {
      const word = intentData.dictionary_word.trim();
      const dictUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
      const dictRes = await axios.get(dictUrl);
      const data = dictRes.data[0];
      if (data) {
        const audio = data.phonetics.find((p: any) => p.audio)?.audio || '';
        dictionaryResult = {
          word: data.word,
          phonetic: data.phonetic || data.phonetics?.[0]?.text || '',
          audio: audio,
          class: data.meanings[0]?.partOfSpeech || '',
          definition: data.meanings[0]?.definitions[0]?.definition || '',
          example: data.meanings[0]?.definitions[0]?.example || '',
          synonyms: data.meanings[0]?.synonyms?.slice(0, 5) || [],
          antonyms: data.meanings[0]?.antonyms?.slice(0, 5) || []
        };
      }
    } catch (err) {
      console.error("Dictionary lookup failed:", err);
    }
  }

  // 2. Sitelink & Domain Logic
  const siteMatch = query?.match(/site:\s*([a-zA-Z0-9.-]+)/i);
  const filterDomain = siteMatch ? siteMatch[1].toLowerCase() : null;
  const cleanQuery = filterDomain ? query.replace(/site:\s*[a-zA-Z0-9.-]+/i, '').trim() : query;

  const domainVariations = filterDomain ? [
    filterDomain,
    filterDomain.startsWith('www.') ? filterDomain.replace('www.', '') : `www.${filterDomain}`
  ] : null;

  let vectorResults: any = { matches: [] };
  let keywordResults: any = { matches: [] };

  // News Filter
  const newsFilter = type === 'news' ? {
    "$or": [
      { domain: { "$in": ['nytimes.com', 'bbc.co.uk', 'reuters.com', 'theverge.com', 'cnn.com', 'theguardian.com', 'bloomberg.com', 'wsj.com'] } },
      { isNews: { "$eq": true } }
    ]
  } : null;

  if (filterDomain && !cleanQuery) {
    // CASE: Only site:domain -> Pure filter search
    const domainFilter: any = { domain: { "$in": domainVariations } };
    
    const vFilter = type === 'images' ? {
      "$and": [
        domainFilter,
        {
          "$or": [
            { image: { "$exists": true } },
            { thumbnail: { "$exists": true } },
            { ogImage: { "$exists": true } },
            { imageUrl: { "$exists": true } }
          ]
        }
      ]
    } : domainFilter;

    const domainRes = await index.query({
      vector: Array(768).fill(0),
      topK: 500,
      filter: vFilter,
      includeMetadata: true,
      namespace
    });
    keywordResults = domainRes;
  } else {
    // NORMAL HYBRID SEARCH
    let vector = providedVector || visualVector;

    if (!vector) {
      if (finalQuery || query) {
        vector = await getEmbedding(finalQuery || query);
      }
      
      // Safety Fallback: Use zero vector if all encodings fail
      if (!vector) {
        vector = Array(768).fill(0);
      }
    }

    if (!Array.isArray(vector)) {
      return res.status(400).json({ error: 'Search vector generation failed' });
    }

    // Dynamic filter
    let filter: any = {};
    if (type === 'images') {
      filter = { is_image: { "$eq": true } };
    } else {
      // Exclude direct image vectors from general site search to avoid duplicates
      filter = { is_image: { "$ne": true } };
    }

    if (filterDomain) {
      const domainF = { domain: { "$in": domainVariations } };
      filter = { "$and": [filter, domainF] };
    }
    if (newsFilter) {
      filter = { "$and": [filter, newsFilter] };
    }

    // Prepare keyword variations for better filtering
    const qLower = cleanQuery.toLowerCase();
    const qUpper = qLower.charAt(0).toUpperCase() + qLower.slice(1);
    const qBrand = qLower.toUpperCase();
    const variations = [...new Set([cleanQuery, qLower, qUpper, qBrand])];

    const [vRes, kRes] = await Promise.all([
      index.query({
        vector,
        topK: 500,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        includeMetadata: true,
        namespace
      }),
        index.query({
        vector: Array(vector.length).fill(0),
        filter: {
          ...filter,
          "$or": [
            { title: { "$in": variations } },
            { alt: { "$in": variations } },
            { text: { "$in": variations } },
            { name: { "$in": variations } },
            { brand: { "$in": variations } },
            { url: { "$in": variations } },
            { domain: { "$in": variations } },
            { domain: { "$in": domainVariations || [] } }
          ]
        },
        topK: 100,
        includeMetadata: true,
        namespace
      }).catch(() => ({ matches: [] }))
      ]).catch(err => { console.error("Pinecone query error:", err); return [ { matches: [] }, { matches: [] } ] });
    vectorResults = vRes;
    keywordResults = kRes;
  }

  try {
    const allMatches = [...vectorResults.matches, ...keywordResults.matches];
    
    const seenIds = new Set();
    const uniqueMatches = allMatches.filter(match => {
      if (seenIds.has(match.id)) return false;
      seenIds.add(match.id);
      return true;
    });

    const allResults = uniqueMatches.map(match => {
      const meta = match.metadata as any;
      const url = meta.url || '';
        let dom = 'unknown';
        try {
          if (url && url.startsWith('http')) {
            dom = new URL(url).hostname;
          }
        } catch (e) {
          console.warn("Invalid URL in metadata:", url);
        }

      // Filter out non-English wikipedia to reduce noise
      if (dom.includes('.wikipedia.org') && !dom.startsWith('en.wikipedia.org')) {
        return null;
      }

      return {
        ...meta,
        id: match.id,
        score: match.score,
        title: prettifyTitle(meta.title || meta.name || '', url),
        url: url,
        displayUrl: dom,
        snippet: cleanSnippet(meta.snippet || meta.text || meta.description || ''),
        image: meta.image || meta.thumbnail || meta.ogImage || meta.imageUrl || null,
        sourceIcon: `https://icons.duckduckgo.com/ip3/${dom}.ico`,
      };
    }).filter((r): r is any => r !== null);

    const q = (query || '').toLowerCase().trim();
    const keywords = q.split(/\s+/).filter(k => k.length > 2);

    const reranked = allResults.sort((a: any, b: any) => {
      let scoreA = a.score || 0;
      let scoreB = b.score || 0;

      // "YOU VISITED THIS PREVIOUSLY" Boosting
      if (clickedUrls.includes(a.url)) scoreA += 5.0;
      if (clickedUrls.includes(b.url)) scoreB += 5.0;

      if (q) {
        const domainA = (a.displayUrl || '').toLowerCase();
        const domainB = (b.displayUrl || '').toLowerCase();
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();

        if (domainA.startsWith(q) || domainA.includes(`.${q}`)) scoreA += 4.0;
        if (domainB.startsWith(q) || domainB.includes(`.${q}`)) scoreB += 4.0;
        if (domainA.includes(q)) scoreA += 2.0;
        if (domainB.includes(q)) scoreB += 2.0;

        if (titleA === q || titleA.startsWith(q) || titleA.includes(q)) scoreA += 2.0;
        if (titleB === q || titleB.startsWith(q) || titleB.includes(q)) scoreB += 2.0;

        keywords.forEach(kw => {
          if (titleA.includes(kw)) scoreA += 0.2;
          if (titleB.includes(kw)) scoreB += 0.2;
          if (a.snippet?.toLowerCase().includes(kw)) scoreA += 0.1;
          if (b.snippet?.toLowerCase().includes(kw)) scoreB += 0.1;
          if (a.alt?.toLowerCase().includes(kw)) scoreA += 0.3;
          if (b.alt?.toLowerCase().includes(kw)) scoreB += 0.3;
        });
      }

      // Global Authority boost
      const authorityDomains = ['reuters.com', 'gov', 'edu', 'nyt.com', 'bbc.co.uk'];
      const isWiki = (a.url || a.displayUrl || '').includes('wikipedia.org');
      const isWikiB = (b.url || b.displayUrl || '').includes('wikipedia.org');

      if (authorityDomains.some(d => a.url?.includes(d))) scoreA += 0.35;
      if (authorityDomains.some(d => b.url?.includes(d))) scoreB += 0.35;

      // Wikipedia boost nearly eliminated
      if (isWiki) scoreA += 0.01;
      if (isWikiB) scoreB += 0.01;

      // Heavy penalty for Wikipedia if it's a direct brand search for something else
      if (q && q.length > 2) {
        const brands = ['google', 'apple', 'amazon', 'microsoft', 'tesla', 'meta', 'spotify', 'netflix', 'disney', 'nvidia'];
        if (brands.some(b => q.includes(b))) {
          if (isWiki) scoreA -= 2.5;
          if (isWikiB) scoreB -= 2.5;
        }
      }

      return scoreB - scoreA;
    });

    // Normalization and Diversity logic
    const finalResults: any[] = [];
    const domainCountMap = new Map();

    reranked.forEach(res => {
      const url = res.url || '';
      let domainKey = res.displayUrl || 'unknown';
      
      // Improve diversity: Allow subdomains (books.google.com, news.google.com) to be distinct
      // but limit repetitions of exact same sub-site to 2 entries in total list
      const subSiteCount = domainCountMap.get(domainKey) || 0;
      
      if (subSiteCount < 2) { 
        finalResults.push(res);
        domainCountMap.set(domainKey, subSiteCount + 1);
      }
    });

    const paginatedResults = finalResults.slice(skip, skip + pageSize);
    const totalPages = Math.ceil(finalResults.length / pageSize);

    res.json({ 
      results: paginatedResults,
      dictionary: dictionaryResult,
      suggestKnowledgePanel,
      detectedEntity,
      isEnglishHelp,
      correction,
      originalQuery: correction ? query : null,
      page,
      totalPages,
      totalResults: finalResults.length,
      visualMathProblem
    });
  } catch (error: any) {
    console.error('Pinecone search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// OAUTH: GET AUTH URL
app.get('/api/auth/url', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback`;

  if (!googleClientId) {
    return res.status(503).json({ error: 'Google Client ID not configured' });
  }

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent'
  });

  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});

// OAUTH: CALLBACK
app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided');

  try {
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback`,
      grant_type: 'authorization_code'
    });

    const { access_token } = tokenResponse.data;
    const userResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    req.session!.user = userResponse.data;

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('OAuth callback error:', error.response?.data || error.message);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session?.user || null });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// --- AI ENDPOINTS ---
app.post('/api/ai/overview', async (req, res) => {
  try {
    const { query, context, isLinguisticHelp } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    const hasValidKey = !!(rawKey && rawKey.length > 20);

    // Priority 1: Gemini (Fastest & Best for Serverless)
    if (hasValidKey) {
      try {
        const prompt = isLinguisticHelp
          ? `Provide a concise grammar, spelling, and usage guide for: "${query}". Respond in Markdown with clear examples.`
          : `Provide a comprehensive AI Overview for the search query: "${query}". 
             Use the following search results as context: ${context || 'No specific context available.'}
             Format your response with Markdown (use bolding, lists, or tables where appropriate).`;

        const result = await aiModel.generateContent(prompt);
        const text = result.response.text();
        if (text) return res.json({ text });
      } catch (e: any) {
        console.error("Gemini AI Overview failed:", e.message);
      }
    }

    // Fallback: If context is present but Gemini failed, we can't do local summary anymore (to stay light)
    res.json({ 
      text: "The AI Overview is currently unavailable. This might be due to a missing API key or heavy traffic. Please check the search results below." 
    });
  } catch (globalErr: any) {
    console.error("Critical error in /api/ai/overview:", globalErr);
    res.status(500).json({ error: "Internal Server Error", message: globalErr.message });
  }
});

app.post('/api/ai/summarize', async (req, res) => {
  const { text, max_tokens = 60 } = req.body;
  try {
    if (rawKey && rawKey.length > 20) {
      const prompt = `Summarize the following text in about ${max_tokens} words:\n\n${text.substring(0, 3000)}`;
      const result = await aiModel.generateContent(prompt);
      return res.json({ summary: result.response.text() });
    }
    res.status(503).json({ error: "Summarizer unavailable (API Key missing)" });
  } catch (e: any) {
    console.error("Summarization error:", e);
    res.status(500).json({ error: e.message });
  }
});

  app.post('/api/ai/faq', async (req, res) => {
    const { query, context } = req.body;
    
    // FAQ can be derived from summary if Gemini fails
    try {
      if (rawKey && rawKey.length > 20) {
        const prompt = `Query: "${query}"\nContext: ${context}\nGenerate 5-6 relevant FAQs as JSON: [{"question": "...", "answer": "..."}]`;
        const result = await aiModel.generateContent(prompt);
        const text = result.response.text()?.replace(/```json/g, '').replace(/```/g, '').trim();
        return res.json(JSON.parse(text || '[]'));
      }
    } catch (e) {}

    // Local Fallback: Extract from text
    res.json([
      { "question": `What should I know about ${query}?`, "answer": `Explore the search results below to learn more about ${query} across multiple platforms and news sources.` }
    ]);
  });

  app.post('/api/ai/knowledge', async (req, res) => {
    const { entityName, entityType } = req.body;
    try {
      if (rawKey && rawKey.length > 20) {
        const prompt = `Entity: "${entityName}" (${entityType || 'General'})
Generate a high-quality Knowledge Panel JSON: {"title": "...", "subtitle": "...", "description": "...", "image": "...", "details": [...], "sections": [...]}`;

        const result = await aiModel.generateContent(prompt);
        const text = result.response.text()?.replace(/```json/g, '').replace(/```/g, '').trim();
        if (text === 'null') return res.json(null);
        return res.json(JSON.parse(text));
      }
    } catch (e) {}

    // Local Fallback
    res.json({
      title: entityName,
      subtitle: entityType || "General Information",
      description: `Exploring ${entityName}. Discover more by checking the search results and images provided below.`,
      image: `https://picsum.photos/seed/${encodeURIComponent(entityName)}/800/600`,
      details: [
        { label: "Search Topic", value: entityName }
      ],
      sections: [
        { title: "Quick Fact", content: `Scout has identified "${entityName}" as a relevant topic for your current search.` }
      ]
    });
  });

// --- VITE MIDDLEWARE ---
if (process.env.NODE_ENV !== 'production') {
  // Dynamically loading Vite to keep production startup light
  import('vite').then(async ({ createServer }) => {
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  });
} else {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// --- ERROR HANDLER ---
app.use((err: any, req: any, res: any, next: any) => {
  console.error('SERVER ERROR:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Only start listening if not running on Vercel or explicitly called via tsx/node
if (process.env.NODE_VITE_DEV === 'true' || process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;