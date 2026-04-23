import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieSession from 'cookie-session';
import { Pinecone } from '@pinecone-database/pinecone';
import axios from 'axios';
import { pipeline } from '@xenova/transformers';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CLEANUP: Removed Gemini initialization from backend ---
// All AI calls moved to Frontend per security guidelines.

// Scout Semantic Brain (mpnet-base)
let text_pipe: any = null;
let isModelLoading = false;

async function getPipes() {
  if (text_pipe) return { text_pipe };
  if (isModelLoading) return null;
  
  try {
    isModelLoading = true;
    console.log("🚀 Warming Scout Semantic Brain (all-mpnet-base-v2)...");
    
    // Semantic Encoder (768-dim) 
    if (!text_pipe) text_pipe = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');

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
  let cleanTitle = title?.trim()?.replace(/\s+/g, ' ') || "";
  const genericTerms = ['home', 'index', 'support', 'help', 'page', 'untitled', 'welcome', 'login', 'signup', 'account', 'main', 'start', 'navbar', 'articles', 'news'];
  
  try {
    const parsed = new URL(url);
    const domainParts = parsed.hostname.toLowerCase().replace('www.', '').split('.');
    // Better Brand Extraction: ignore common prefixes, take the recognizable "middle" part
    let domainName = domainParts[0];
    if (domainParts.length > 2 && (domainParts[0] === 'support' || domainParts[0] === 'api' || domainParts[0] === 'dev' || domainParts[0] === 'docs' || domainParts[0] === 'news' || domainParts[0] === 'blog')) {
      domainName = domainParts[1];
    }
    
    const brand = domainName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // 1. If title is placeholder/empty or generically titled
    if (!cleanTitle || /^(untitled|document|page|home|index|welcome|untitled page|web page)$/i.test(cleanTitle) || cleanTitle.length < 2) {
      if (parsed.pathname && parsed.pathname !== '/') {
        const segments = parsed.pathname.split('/').filter(s => s && s.length > 2 && !s.includes('.'));
        if (segments.length > 0) {
           const page = segments[segments.length - 1].replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
           // Ensure we don't just return ":" if brand is empty
           return brand ? `${brand}: ${page}` : page;
        }
      }
      return brand || "Web Page";
    }

    // 2. If title is too generic (e.g. "Support")
    const lowerTitle = cleanTitle.toLowerCase();
    const isGeneric = genericTerms.some(term => lowerTitle === term) || 
                      (cleanTitle.length < 10 && genericTerms.some(term => lowerTitle.includes(term)));

    if (isGeneric) {
      const segments = parsed.pathname.split('/').filter(s => s && s.length > 2 && !s.includes('.'));
      if (segments.length > 1) {
         const specific = segments[segments.length - 1].replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
         // Avoid repeating the same word twice
         if (specific.toLowerCase() !== lowerTitle) {
            return `${brand}: ${cleanTitle} - ${specific}`;
         }
      }
      return `${brand}: ${cleanTitle}`;
    }

    // 3. Ensure Brand is represented for shorter titles to provide context
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

// --- COLLECTIVE MEMORY / INTENT LOGIC ---
// In a production environment, this would be a background job.
// Here we implement "Active Learning" on every interaction.
async function updateQueryIntent(queryText: string, docId: string, signal: 'success' | 'pogo') {
  const pc = getPinecone();
  if (!pc) return;
  
  const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
  const namespace = 'intent';
  const queryVector = await getEmbedding(queryText);
  if (!queryVector) return;

  // We use a hashed ID for the query to prevent duplicate intent entries for the same query text
  const queryHash = Buffer.from(queryText.toLowerCase().trim()).toString('base64').slice(0, 50);
  
  try {
    // 1. Fetch current intent state for this query
    const fetchRes = await index.namespace(namespace).fetch({ ids: [queryHash] });
    const record = fetchRes.records?.[queryHash];
    
    let docWeights: Record<string, number> = {};
    if (record?.metadata?.doc_weights) {
      docWeights = JSON.parse(record.metadata.doc_weights as string);
    }

    // 2. Adjust Weights based on Signal (Collaborative Ranking)
    // A success is +1.0, a pogo (quick exit) is -0.5
    const currentWeight = docWeights[docId] || 0;
    const adjustment = signal === 'success' ? 1.0 : -0.5;
    docWeights[docId] = Math.max(0, currentWeight + adjustment);

    // 3. Keep only top performers for this query to keep metadata size small
    const sortedDocs = Object.entries(docWeights)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);
    const prunedWeights = Object.fromEntries(sortedDocs);

    // 4. Update Intent Index
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
    const index = pc.Index(process.env.PINECONE_INDEX || 'scout');
    const namespace = process.env.PINECONE_NAMESPACE || 'default';

    // Fetch current state
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

    // Update main index metadata (Global Popularity)
    await index.namespace(namespace).update({
      id,
      metadata: { ...record.metadata, popularity_boost: String(currentBoost) }
    });

    // Phase 3: The "Learn" Phase (Collective Brain)
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

// OAUTH: GET AUTH URL
app.get('/api/auth/url', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback`;
  if (!googleClientId) return res.status(503).json({ error: 'Google Client ID missing' });

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
    res.send('<html><body><script>if(window.opener){window.opener.postMessage({type:"OAUTH_AUTH_SUCCESS"}, "*");window.close();}else{window.location.href="/";}</script></body></html>');
  } catch (error) {
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/me', (req, res) => res.json({ user: req.session?.user || null }));
app.post('/api/logout', (req, res) => { req.session = null; res.json({ success: true }); });

// Vite Middleware
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});