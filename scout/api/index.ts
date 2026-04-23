import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieSession from 'cookie-session';
import { Pinecone } from '@pinecone-database/pinecone';
import axios from 'axios';
import { pipeline, env } from '@xenova/transformers';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

dotenv.config();

// --- SERVERLESS OPTIMIZATION ---
env.allowLocalModels = false;
if (process.env.NODE_ENV === 'production') {
  env.cacheDir = '/tmp';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- FIREBASE ADMIN INITIALIZATION ---
let firebaseApp: admin.app.App | null | undefined = undefined;

try {
  const apps = admin.apps || [];

  if (apps.length === 0) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;

    if (privateKey && clientEmail) {
      // This version handles double-escaped backslashes AND literal newlines
      const formattedKey = privateKey
        .replace(/\\n/g, '\n')     // Fixes escaped newlines
        .replace(/"/g, '')         // Removes accidental extra quotes
        .trim();                   // Removes accidental spaces at the start/end

      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: projectId,
          clientEmail: clientEmail,
          privateKey: formattedKey,
        }),
        databaseURL: `https://${projectId}.firebaseio.com`
      });
      console.log("✅ Firebase Admin: Service Account Mode Success");
    } else {
      // Safe fallback for local development or limited access
      firebaseApp = admin.initializeApp({
        projectId: projectId,
        databaseURL: `https://${projectId}.firebaseio.com`
      });
      console.log("⚠️ Firebase Admin: Project ID Mode (Limited)");
    }
  } else {
    firebaseApp = apps[0];
  }
} catch (err: any) {
  console.error("❌ Firebase Admin Critical Init Error:", err.message);
  firebaseApp = null;
}

// --- FIRESTORE INITIALIZATION ---
// We wrap this in a getter or a safe check to prevent the 503 crash
let db: any = null;
if (firebaseApp) {
  try {
    db = getFirestore(firebaseApp, "(default)");
  } catch (firestoreErr) {
    console.error("❌ Firestore Setup Error:", firestoreErr);
  }
}



// --- NEURAL ENGINE ---
let text_pipe: any = null;
let isModelLoading = false;

async function getPipes() {
  if (text_pipe) return { text_pipe };
  if (isModelLoading) return null;
  
  try {
    isModelLoading = true;
    console.log("🚀 Warming Scout Semantic Brain (all-mpnet-base-v2)...");
    
    if (!text_pipe) {
      text_pipe = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');
    }

    console.log("✅ Scout Semantic Brain ready!");
    return { text_pipe };
  } catch (err: any) {
    console.error("❌ Neural Engine failure:", err.message);
    return null;
  } finally {
    isModelLoading = false;
  }
}



async function getEmbedding(text: string): Promise<number[] | null> {
  if (!text) return null;
  const cacheKey = text.toLowerCase().trim();
  if (embeddingCache.has(cacheKey)) return embeddingCache.get(cacheKey)!;
  
  try {
    const pipes = await getPipes();
    if (pipes?.text_pipe) {
      const output = await pipes.text_pipe(text, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data) as number[];
      embeddingCache.set(cacheKey, vector);
      // Prune cache if too large
      if (embeddingCache.size > 200) {
        const firstKey = embeddingCache.keys().next().value;
        if (firstKey) embeddingCache.delete(firstKey);
      }
      return vector;
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
  let cleanTitle = title?.trim()?.replace(/\s+/g, ' ') || "";
  const genericTerms = ['home', 'index', 'support', 'help', 'page', 'untitled', 'welcome', 'login', 'signup', 'account', 'main', 'start', 'navbar', 'articles', 'news'];
  
  try {
    const parsed = new URL(url);
    const domainParts = parsed.hostname.toLowerCase().replace('www.', '').split('.');
    let domainName = domainParts[0];
    if (domainParts.length > 2 && (domainParts[0] === 'support' || domainParts[0] === 'api' || domainParts[0] === 'dev' || domainParts[0] === 'docs' || domainParts[0] === 'news' || domainParts[0] === 'blog')) {
      domainName = domainParts[1];
    }
    
    const brand = domainName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    if (!cleanTitle || /^(untitled|document|page|home|index|welcome|untitled page|web page)$/i.test(cleanTitle) || cleanTitle.length < 2) {
      if (parsed.pathname && parsed.pathname !== '/') {
        const segments = parsed.pathname.split('/').filter(s => s && s.length > 2 && !s.includes('.'));
        if (segments.length > 0) {
           const page = segments[segments.length - 1].replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
           return brand ? `${brand}: ${page}` : page;
        }
      }
      return brand || "Web Page";
    }

    const lowerTitle = cleanTitle.toLowerCase();
    const isGeneric = genericTerms.some(term => lowerTitle === term) || 
                      (cleanTitle.length < 10 && genericTerms.some(term => lowerTitle.includes(term)));

    if (isGeneric) {
      const segments = parsed.pathname.split('/').filter(s => s && s.length > 2 && !s.includes('.'));
      if (segments.length > 1) {
         const specific = segments[segments.length - 1].replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
         if (specific.toLowerCase() !== lowerTitle) {
            return `${brand}: ${cleanTitle} - ${specific}`;
         }
      }
      return `${brand}: ${cleanTitle}`;
    }

    if (!lowerTitle.includes(brand.toLowerCase()) && cleanTitle.length < 40) {
      return `${brand}: ${cleanTitle}`;
    }

    return cleanTitle;
  } catch (e) {
    return cleanTitle || "Web Page";
  }
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Simple Embedding Cache (Global)
const embeddingCache = new Map<string, number[]>();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.set('trust proxy', 1);
app.use(cors());
  
  app.use(cookieSession({
  name: 'session',
  keys: [process.env.COOKIE_SECRET || 'scout-secret'],
  maxAge: 30 * 24 * 60 * 60 * 1000, 
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

async function updateQueryIntent(queryText: string, docId: string, signal: 'success' | 'pogo') {
  const pc = getPinecone();
  if (!pc) return;
  
  const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
  const namespace = 'intent';
  const queryVector = await getEmbedding(queryText);
  if (!queryVector) return;

  const queryHash = Buffer.from(queryText.toLowerCase().trim()).toString('base64').slice(0, 50);
  
  try {
    const fetchRes = await index.namespace(namespace).fetch({ ids: [queryHash] });
    const record = fetchRes.records?.[queryHash];
    
    let docWeights: Record<string, number> = {};
    if (record?.metadata?.doc_weights) {
      docWeights = JSON.parse(record.metadata.doc_weights as string);
    }

    const currentWeight = docWeights[docId] || 0;
    const adjustment = signal === 'success' ? 1.0 : -0.5;
    docWeights[docId] = Math.max(0, currentWeight + adjustment);

    const sortedDocs = Object.entries(docWeights)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);
    const prunedWeights = Object.fromEntries(sortedDocs);

    // Correct Pinecone SDK upsert syntax for version 7.x
    await index.namespace(namespace).upsert({
      records: [{
        id: queryHash,
        values: queryVector,
        metadata: {
          query_text: queryText,
          doc_weights: JSON.stringify(prunedWeights),
          last_updated: new Date().toISOString()
        }
      }]
    });
    
    console.log(`🧠 Intent Updated: "${queryText}" -> Doc:${docId} (Signal: ${signal})`);
  } catch (err) {
    console.warn("⚠️ Intent update failed:", err);
  }
}

app.post('/api/feedback', async (req, res) => {
  try {
    const { id, type, queryText } = req.body; 
    if (!id) return res.status(400).json({ error: 'Record ID required' });

    const pc = getPinecone();
    if (!pc) return res.status(503).json({ error: 'Database unavailable' });
    const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
    const namespace = process.env.PINECONE_NAMESPACE || 'default';

    const fetchRes = await index.namespace(namespace).fetch({ ids: [id] });
    const record = fetchRes.records[id];
    if (!record) return res.status(404).json({ error: 'Record not found' });

    let currentBoost = parseFloat(record.metadata?.popularity_boost as string) || 1.0;

    // Phase 2: The "Listen" Phase
    if (type === 'success') {
      currentBoost = Math.min(3.0, currentBoost + 0.1); 
    } else if (type === 'pogo') {
      currentBoost = Math.max(0.5, currentBoost - 0.1); 
    }

    await index.namespace(namespace).update({
      id,
      metadata: { ...record.metadata, popularity_boost: String(currentBoost) }
    });

    if (queryText) {
      updateQueryIntent(queryText, id, type);
    }

    res.json({ success: true, boost: currentBoost });
  } catch (error) {
    console.error("Feedback error:", error);
    res.status(500).json({ error: 'Feedback loop failed' });
  }
});
app.post('/api/search', async (req, res) => {
  try {
    const { query, vector: providedVector, page = 1, type = 'all', clickedUrls = [], imageQuery } = req.body;
    const pageSize = 40;
    const skip = (page - 1) * pageSize;
    
    const pc = getPinecone();
    if (!pc) return res.status(503).json({ error: 'Pinecone not configured' });
    const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
    const namespace = process.env.PINECONE_NAMESPACE || 'default';

    let finalQuery = query;

    if (imageQuery) {
      console.warn("Visual search disabled in serverless mode to prevent memory crashes.");
      return res.status(400).json({ 
        error: "Feature Unavailable", 
        message: "Visual search requires a high-memory environment not available in this tier." 
      });
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

    let vector = providedVector;
    
    // Safety check: Truncate to 768 if it's from a higher-dim model
    if (vector && vector.length > 768) {
      vector = vector.slice(0, 768);
    }

    if (!vector && finalQuery) {
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
    // 'all' type now includes images by not having an explicit negative filter

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

    // Step 2: Intent Retrieval (What did others choose?)
    // Phase 4: The "Act" Phase
    let intentBoosts: Record<string, number> = {};
    try {
      const intentRes = await index.namespace('intent').query({
        vector,
        topK: 3,
        includeMetadata: true
      });
      
      intentRes.matches.forEach(match => {
        if (match.metadata?.doc_weights) {
          const weights = JSON.parse(match.metadata.doc_weights as string);
          // Intent Relevance decreases as the query match gets further away
          const intentStrength = match.score || 0; 
          Object.entries(weights).forEach(([docId, weight]) => {
            const current = intentBoosts[docId] || 0;
            intentBoosts[docId] = current + ((weight as number) * intentStrength * 5.0);
          });
        }
      });
    } catch (e) {
      console.warn("Intent lookup failed, falling back to pure semantic search");
    }

    const [vRes, kRes] = await Promise.all([
      index.query({
        vector,
        topK: 1000,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        includeMetadata: true,
        namespace
      }).catch(err => {
        console.error("Vector query failed:", err);
        return { matches: [] };
      }),
      index.query({
        vector: Array(vector.length).fill(0),
        filter: {
          ...filter,
          "$or": [
            { title: { "$in": variations } },
            { text: { "$in": variations } },
            { name: { "$in": variations } },
            { domain: { "$in": variations || [] } }
          ]
        },
        topK: 250,
        includeMetadata: true,
        namespace
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
      // 1. Hybrid Score: Vector Similarity + Popularity Boost
      // mpnet scores are usually between 0.3 and 0.9.
      let sA = (a.score * 0.8) + (Math.log10(a.boost + 1) * 0.2);
      let sB = (b.score * 0.8) + (Math.log10(b.boost + 1) * 0.2);

      // 2. Exact Title/Domain Matches (Super High Boost)
      const tA = a.title.toLowerCase().trim();
      const tB = b.title.toLowerCase().trim();
      const nA = a.name?.toLowerCase().trim() || '';
      const nB = b.name?.toLowerCase().trim() || '';

      if (tA === qLower || nA === qLower) sA += 50.0;
      if (tB === qLower || nB === qLower) sB += 50.0;
      
      if (a.isExactMatch) sA += 100.0;
      if (b.isExactMatch) sB += 100.0;
      
      if (a.isOfficialProperty) sA += 40.0;
      if (b.isOfficialProperty) sB += 40.0;

      // 3. Navigational Strength
      if (a.isNavIntent && a.isRootDomain) sA += 15.0;
      if (b.isNavIntent && b.isRootDomain) sB += 15.0;

      // 4. Content Relevance (Title inclusion)
      if (tA.includes(qLower)) sA += 2.0;
      if (tB.includes(qLower)) sB += 2.0;

      // 5. Intent Re-ranking (Collaborative IQ)
      const intentBoost = intentBoosts[a.id] || 0;
      const intentBoostB = intentBoosts[b.id] || 0;
      sA += intentBoost;
      sB += intentBoostB;

      // 6. User Feedback (Clicks)
      if (clickedUrls.includes(a.url)) sA += 10.0;
      if (clickedUrls.includes(b.url)) sB += 10.0;

      // 7. Quality Penalties
      if (a.url.length > 80 && !a.isExactMatch && !a.isOfficialProperty) sA -= 2.0;
      if (b.url.length > 80 && !b.isExactMatch && !b.isOfficialProperty) sB -= 2.0;

      return sB - sA;
    });

    // --- SEGREGATION FOR TAB-SPECIFIC PAGINATION ---
    const webResults = reranked.filter(r => !r.is_image);
    const imageResults = reranked.filter(r => r.is_image);

    // Decide which pool to paginate based on the tab
    let poolToPaginate = webResults;
    if (type === 'images') {
      poolToPaginate = imageResults;
    } else if (type === 'news') {
      poolToPaginate = webResults;
    }

    // Step 5: Diversity & Nesting Limit for Web Results (only if in 'all' or 'news' tab)
    let finalOrdered: any[] = [];
    if (type !== 'images') {
      const groupedResults: Record<string, any[]> = {};
      
      poolToPaginate.forEach(res => {
        const dom = res.displayUrl.toLowerCase().replace('www.', '');
        if (!groupedResults[dom]) groupedResults[dom] = [];
        // Nesting Limit: Max 4 results per domain (1 primary + 3 secondaries)
        if (groupedResults[dom].length < 4) {
          groupedResults[dom].push(res);
        }
      });

      const seenDomains = new Set();
      poolToPaginate.forEach(res => {
        const dom = res.displayUrl.toLowerCase().replace('www.', '');
        if (!seenDomains.has(dom)) {
          const matches = groupedResults[dom];
          if (matches) {
            finalOrdered.push(...matches);
          }
          seenDomains.add(dom);
        }
      });
    } else {
      finalOrdered = poolToPaginate;
    }

    // SLICE BASED ON REQUESTED PAGE
    const paginatedResults = finalOrdered.slice(skip, skip + pageSize);
    const totalPagesCount = Math.ceil(finalOrdered.length / pageSize);

    // If 'all' tab, we mix in some top images so the ImageStrip always works on page 1
    // We add them at the end of the results array for the frontend to handle
    let resultsWithOptionalImages = paginatedResults;
    if (type === 'all' && imageResults.length > 0) {
       // Only add images to the payload if they aren't already represented 
       // This ensures ResultsView has image data for the strip without breaking pagination
       resultsWithOptionalImages = [...paginatedResults, ...imageResults.slice(0, 10)];
    }

    res.json({ 
      results: resultsWithOptionalImages,
      dictionary: dictionaryResult,
      suggestKnowledgePanel,
      detectedEntity,
      isEnglishHelp,
      correction: null, 
      originalQuery: null,
      page,
      totalPages: totalPagesCount,
      totalResults: finalOrdered.length,
      visualMathProblem: null 
    });
  } catch (err: any) {
    console.error("Search API Error:", err);
    res.status(500).json({ error: "Internal search engine error", message: err.message });
  }
});

// Helper to get the consistent Redirect URI
const getRedirectUri = (req: any) => {
  // Use APP_URL if set, otherwise fallback to the current request host
  const host = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  // Ensure this matches EXACTLY what you put in Google Cloud Console
  return `${host}/api/auth/callback`;
};

// OAUTH: GET AUTH URL
app.get('/api/auth/url', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = getRedirectUri(req);

  if (!googleClientId) {
    return res.status(503).json({ error: 'Google Client ID missing' });
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
// Added /api/ prefix to match Vercel's default routing for /api/index.ts
app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = getRedirectUri(req);

  if (!code) return res.status(400).send('No code provided');

  try {
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: googleClientId,
      client_secret: googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const { access_token } = tokenResponse.data;
    const userResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    // Save user to session
    if (req.session) {
      req.session.user = userResponse.data;
    }

    // Success script: close popup and notify parent
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: "OAUTH_AUTH_SUCCESS" }, "*");
              window.close();
            } else {
              window.location.href = "/";
            }
          </script>
          <p>Authentication successful! You can close this window.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("❌ OAuth Callback Error:", error.response?.data || error.message);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/me', (req, res) => res.json({ user: req.session?.user || null }));
app.post('/api/logout', (req, res) => { req.session = null; res.json({ success: true }); });

// --- AI TRAINING EXPORT (Phase 3) ---
const ADMIN_EMAILS = ['komumech@gmail.com']; // Your authorized email

app.post('/api/admin/clickstream', async (req, res) => {
  try {
    if (!db) {
      console.error("❌ Database not initialized");
      return res.status(503).json({ error: "Database unavailable" });
    }

    const { type, query, url, uid } = req.body;

    // This is what forces the creation of the collection
    await db.collection('clickstream').add({
      type: type || 'search',
      query: query || '',
      url: url || '',
      uid: uid || 'anonymous',
      timestamp: new Date()
    });

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("❌ Firestore Write Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/clickstream', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });

  // Admin Guard
  const user = req.session?.user;
  if (!user || !ADMIN_EMAILS.includes(user.email)) {
    return res.status(403).json({ error: 'Unauthorized: Admin access only' });
  }

  try {
    const snapshot = await db.collection('clickstream').orderBy('timestamp', 'desc').limit(1000).get();
    const data = snapshot.docs.map((doc: admin.firestore.QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate()
    }));
    res.json(data);
  } catch (err: any) {
    // Return empty array instead of 500 if collection hasn't been created yet
    res.json([]);
  }
});

// Vite Middleware
const isProduction = process.env.NODE_ENV === 'production';
const distPath = path.join(process.cwd(), 'dist');
const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

if (isProduction && hasDist) {
  console.log("Serving production build from dist/");
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else if (!process.env.VERCEL) {
  console.log("🚀 Starting Vite middleware...");
  try {
    const { createServer } = await import('vite');
    const vite = await createServer({ 
      server: { middlewareMode: true }, 
      appType: 'spa' 
    });
    app.use(vite.middlewares);
  } catch (err) {
    console.error("❌ Failed to start Vite middleware:", err);
  }
} else {
  // On Vercel, if we reach here, it's an API route or let rewrites handle it.
  console.log("Vercel environment detected. Server ready for API requests.");
}

// Start Server (Only when NOT on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;