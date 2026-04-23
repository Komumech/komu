import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieSession from 'cookie-session';
import { Pinecone } from '@pinecone-database/pinecone';
import axios from 'axios';
import { pipeline, RawImage, env } from '@xenova/transformers';

dotenv.config();

// --- SERVERLESS OPTIMIZATION ---
// Prevent Transformers.js from trying to write to read-only directories
env.allowLocalModels = false;
if (process.env.NODE_ENV === 'production') {
  env.cacheDir = '/tmp';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CLEANUP: Removed Gemini initialization from backend ---
// All AI calls moved to Frontend per security guidelines.

// Local Multimodal "Scout Vision" Engine (768 dimensions)
let text_pipe: any = null;
let vision_pipe: any = null;
let feature_pipe: any = null;
let isModelLoading = false;
async function getPipes() {
  if (text_pipe && vision_pipe) return { text_pipe, vision_pipe };
  if (isModelLoading) return null;
  
  try {
    isModelLoading = true;
    console.log("🚀 Warming Multimodal Engines (768-dim)...");
    
    if (!text_pipe) text_pipe = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');
    if (!vision_pipe) vision_pipe = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');

    console.log("✅ Scout Multimodal Engines ready!");
    return { text_pipe, vision_pipe };
  } catch (err: any) {
    console.error("❌ Multimodal Engine failure:", err.message);
    return null;
  } finally {
    isModelLoading = false;
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
  return null;
}

// Local Intent Detection Helper
async function detectLocalIntent(query: string) {
  const q = query.toLowerCase().trim();
  
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
    .replace(/\[\d+\]/g, '') 
    .replace(/(\||\-|─|═){2,}(\s?(\||\-|─|═){2,})*/g, ' ') 
    .replace(/\s+/g, ' ')
    .trim();
}

function prettifyTitle(title: string, url: string) {
  if (!url || !title) return title;
  try {
    const parsed = new URL(url);
    const domainPart = parsed.hostname.replace('www.', '').split('.')[0];
    const capitalizedDomain = domainPart.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname.length > 3) {
      const segments = parsed.pathname.split('/').filter(s => s && !s.includes('.') && s.length > 2);
      if (segments.length > 0) {
        const lastSegment = segments[segments.length - 1]
          .replace(/(_|-)/g, ' ')
          .split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        return `${capitalizedDomain} | ${lastSegment}`;
      }
    }
  } catch (e) {}
  return title;
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.set('trust proxy', 1);
app.use(cors());
  
  app.use(cookieSession({
    name: 'session',
    keys: [process.env.COOKIE_SECRET || 'scout-secret'],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: true,
    sameSite: 'none',
    httpOnly: true,
  }));

let pinecone: Pinecone | null = null;
const getPinecone = () => {
  if (!pinecone) {
    if (!process.env.PINECONE_KEY) return null;
    pinecone = new Pinecone({ apiKey: process.env.PINECONE_KEY.trim() });
  }
  return pinecone;
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/suggestions', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
      const response = await axios.get(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q as string)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 2000
      });
    res.json(response.data[1] || []);
  } catch (error) {
    console.error("Suggestions error:", error);
    res.json([]);
  }
});
app.post('/api/feedback', async (req, res) => {
  try {
    const { id, type } = req.body; // type: 'success' | 'pogo'
    if (!id) return res.status(400).json({ error: 'Record ID required' });

    const pc = getPinecone();
    if (!pc) return res.status(503).json({ error: 'Database unavailable' });
    const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
    const namespace = process.env.PINECONE_NAMESPACE || 'default';

    // Fetch current state
    const fetchRes = await index.namespace(namespace).fetch({ ids: [id] });
    const record = fetchRes.records[id];
    if (!record) return res.status(404).json({ error: 'Record not found' });

    let currentBoost = parseFloat(record.metadata?.popularity_boost as string) || 1.0;

    // Adjust based on signal
    if (type === 'success') {
      currentBoost = Math.min(3.0, currentBoost + 0.05); // Cap at 3x
    } else if (type === 'pogo') {
      currentBoost = Math.max(0.5, currentBoost - 0.05); // Floor at 0.5x
    }

    // Update asynchronously
    await index.namespace(namespace).update({
      id,
      metadata: { ...record.metadata, popularity_boost: String(currentBoost) }
    });

    res.json({ success: true, boost: currentBoost });
  } catch (error) {
    console.error("Feedback error:", error);
    res.status(500).json({ error: 'Feedback loop failed' });
  }
});
app.post('/api/search', async (req, res) => {
  try {
    const { query, vector: providedVector, page = 1, type = 'all', clickedUrls = [], imageQuery } = req.body;
    const pageSize = 10;
    const skip = (page - 1) * pageSize;
    
    const pc = getPinecone();
    if (!pc) return res.status(503).json({ error: 'Pinecone not configured' });
    const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
    const namespace = process.env.PINECONE_NAMESPACE || '';

    let finalQuery = query;

    // VISUAL SEARCH LOGIC (Local CLIP Vectorization)
    let visualVector: number[] | null = null;
    if (imageQuery && imageQuery.startsWith('data:image')) {
      try {
        console.log("Scout Lens: Process started...");
        const pipes = await getPipes();
        
        if (!pipes) {
          return res.status(503).json({ 
            error: "Neural Engines Warming Up", 
            message: "Scout Lens is currently loading its neural models. This usually takes 30-60 seconds on first start. Please try again in a moment." 
          });
        }

        if (pipes?.vision_pipe) {
          try {
            // Use RawImage.read for stable data URL processing
            const image = await RawImage.read(imageQuery); 
            const output = await pipes.vision_pipe(image);
            visualVector = Array.from(output.data);
            
            // Pad or interpolate to 768 dimensions if necessary to match index
            if (visualVector && visualVector.length === 512) {
               visualVector = [...visualVector, ...Array(256).fill(0)];
            }
            console.log(`✅ Scout Lens: Vector match generated (${visualVector.length} dims)`);
          } catch (innerErr: any) {
            console.error("Scout Lens: extraction failure:", innerErr.message);
          }
        }
      } catch (err: any) {
        console.warn("Scout Lens: system failure:", err.message);
      }
    }

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
          dictionaryResult = {
            word: data.word,
            phonetic: data.phonetic || data.phonetics?.[0]?.text || '',
            audio: data.phonetics.find((p: any) => p.audio)?.audio || '',
            class: data.meanings[0]?.partOfSpeech || '',
            definition: data.meanings[0]?.definitions[0]?.definition || '',
            example: data.meanings[0]?.definitions[0]?.example || '',
            synonyms: data.meanings[0]?.synonyms?.slice(0, 5) || [],
            antonyms: data.meanings[0]?.antonyms?.slice(0, 5) || []
          };
        }
      } catch (err) {}
    }

    const siteMatch = query?.match(/site:\s*([a-zA-Z0-9.-]+)/i);
    const filterDomain = siteMatch ? siteMatch[1].toLowerCase() : null;
    const cleanQuery = filterDomain ? query.replace(/site:\s*[a-zA-Z0-9.-]+/i, '').trim() : query;
    const domainVariations = filterDomain ? [filterDomain, `www.${filterDomain}`] : null;

    let vectorResults: any = { matches: [] };
    let keywordResults: any = { matches: [] };

    const newsFilter = type === 'news' ? {
      "$or": [
        { domain: { "$in": ['nytimes.com', 'bbc.co.uk', 'reuters.com', 'theverge.com', 'cnn.com', 'theguardian.com'] } },
        { isNews: { "$eq": true } }
      ]
    } : null;

    let vector = providedVector || visualVector;
    
    // Safety check: Truncate to 768 if it's from a higher-dim model
    if (vector && Array.isArray(vector) && vector.length > 768) {
      vector = vector.slice(0, 768);
    }

    if (!vector && finalQuery) {
      console.log("Scout: Generating semantic embedding for query...");
      const pipes = await getPipes();
      if (!pipes) {
        return res.status(503).json({ 
          error: "Neural Engines Warming Up", 
          message: "Scout's semantic embedding engine is loading. Please try again in a few seconds." 
        });
      }
      vector = await getEmbedding(finalQuery);
    }
    
    if (!vector) vector = Array(768).fill(0);

    let filter: any = {};
    if (type === 'images') filter = { is_image: { "$eq": true } };
    else filter = { is_image: { "$ne": true } };

    if (filterDomain) filter = { "$and": [filter, { domain: { "$in": domainVariations } }] };
    if (newsFilter) filter = { "$and": [filter, newsFilter] };

    const qLower = cleanQuery.toLowerCase();
    const brands = ['google', 'apple', 'facebook', 'microsoft', 'amazon', 'github', 'openai', 'anthropic'];
    const activeBrand = brands.find(b => qLower.includes(b));

    const variations = [...new Set([
      cleanQuery, 
      qLower, 
      qLower.toUpperCase(),
      `${qLower}.com`,
      `${qLower}.org`,
      `${qLower}.net`,
      `www.${qLower}.com`,
      `www.${qLower}`,
      `${qLower} search`,
      `${qLower} official`
    ])];

    const [vRes, kRes] = await Promise.all([
      index.namespace(namespace || 'default')
        .query({
          vector,
          topK: 500,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          includeMetadata: true,
        })
        .catch(err => {
          console.error("Vector query failed:", err);
          return { matches: [] };
        }),
      index.namespace(namespace || 'default')
        .query({
        vector: Array(vector.length).fill(0),
        filter: {
          ...filter,
          "$or": [
            { title: { "$in": variations } },
            { text: { "$in": variations } },
            { domain: { "$in": variations || [] } }
          ]
        },
        topK: 100,
        includeMetadata: true,
      }).catch(err => {
        console.error("Keyword query failed:", err);
        return { matches: [] };
      })
    ]);

    vectorResults = vRes;
    keywordResults = kRes;

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
      try { if (url) dom = new URL(url).hostname; } catch (e) {}

      // Identify Navigational Intent
      const cleanDom = dom.toLowerCase().replace('www.', '');
      const isNavIntent = cleanDom.includes(qLower.replace(/\s+/g, '')) && (cleanDom.length <= qLower.length + 8);
      const isExactMatch = cleanDom === `${qLower.replace(/\s+/g, '')}.com` || cleanDom === `${qLower.replace(/\s+/g, '')}.org`;
      
      // Is it an official property of the detected brand?
      const isOfficialProperty = activeBrand && cleanDom.endsWith(`${activeBrand}.com`);
      
      const isRootDomain = dom.split('.').length <= 3 && !dom.includes('github') && !dom.includes('theverge'); 
      const boost = parseFloat(meta.popularity_boost) || 1.0;

      return {
        ...meta,
        id: match.id,
        score: match.score || 0,
        boost,
        isNavIntent,
        isExactMatch,
        isRootDomain,
        isOfficialProperty,
        title: prettifyTitle(meta.title || meta.name || '', url),
        url: url,
        displayUrl: dom,
        snippet: cleanSnippet(meta.snippet || meta.text || meta.description || ''),
        image: meta.image || meta.thumbnail || meta.ogImage || meta.imageUrl || null,
        sourceIcon: `https://icons.duckduckgo.com/ip3/${dom}.ico`,
      };
    });

    const reranked = allResults.sort((a, b) => {
      // 1. Start with User Intent Hybrid Score
      let sA = (a.score * 0.7) + (a.boost * 0.3);
      let sB = (b.score * 0.7) + (b.boost * 0.3);

      // 2. Navigational/Brand Centric Pins (Astronomical boosts to guarantee order)
      if (a.isExactMatch) sA += 10.0;
      if (b.isExactMatch) sB += 10.0;
      
      if (a.isOfficialProperty) sA += 5.0;
      if (b.isOfficialProperty) sB += 5.0;

      if (a.isNavIntent && a.isRootDomain) sA += 10.0;
      if (b.isNavIntent && b.isRootDomain) sB += 10.0;

      // Semantic Strength
      const tA = a.title.toLowerCase();
      const tB = b.title.toLowerCase();
      if (tA === qLower) sA += 30.0;
      if (tB === qLower) sB += 30.0;
      if (tA.includes(qLower)) sA += 2.0;
      if (tB.includes(qLower)) sB += 2.0;

      if (clickedUrls.includes(a.url)) sA += 5.0;
      if (clickedUrls.includes(b.url)) sB += 5.0;

      // Penalize deep links for generic searches
      if (a.url.length > 70 && !a.isExactMatch && !a.isOfficialProperty) sA -= 1.0;
      if (b.url.length > 70 && !b.isExactMatch && !b.isOfficialProperty) sB -= 1.0;

      return sB - sA;
    });

    // Smart Diversity: Group official sites together, but demote secondary domains
    const finalResults: any[] = [];
    const domainCountMap = new Map();
    reranked.forEach(res => {
      const domainKey = res.displayUrl || 'unknown';
      const count = domainCountMap.get(domainKey) || 0;
      
      // Allow many results for official properties (e.g. show many Google sites for "Google")
      // But restrict third-party sites (e.g. limit github items to 2 when searching Google)
      const limit = res.isOfficialProperty ? 8 : 2; 

      if (count < limit) { 
        finalResults.push(res);
        domainCountMap.set(domainKey, count + 1);
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
      correction: null, 
      originalQuery: null,
      page,
      totalPages,
      totalResults: finalResults.length,
      visualMathProblem: null 
    });
  } catch (err: any) {
    console.error("Search API Error:", err);
    res.status(500).json({ error: "Internal search engine error", message: err.message });
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

app.post('/api/logout', (req, res) => { req.session = null; res.json({ success: true }); });

// Vite Middleware
if (process.env.NODE_ENV !== 'production') {
  // Use dynamic import to prevent Vite from crashing production environments
  import('vite').then(async ({ createServer }) => {
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  });
} else {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});