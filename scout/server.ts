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
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini (using stable SDK)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Lazy load pipelines
let embedder: any = null;
let classifier: any = null;

const getEmbedder = async () => {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');
  }
  return embedder;
};

const getClassifier = async () => {
  if (!classifier) {
    classifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli');
  }
  return classifier;
};

// Local Intent Detection Helper
async function detectLocalIntent(query: string) {
  const q = query.toLowerCase().trim();
  
  // 1. Quick RegEx for obvious patterns
  // Prefix patterns: "define x", "meaning of x"
  const prefixMatch = q.match(/^(define|meaning of|definition of|synonym for|antonym for|what is the meaning of|what is the definition of)\s+(.+)/i);
  if (prefixMatch) {
    const word = prefixMatch[2].trim();
    if (word) return { is_dictionary: true, dictionary_word: word, is_english_help: false, is_entity: false };
  }

  // Suffix patterns: "x meaning", "x definition"
  const suffixMatch = q.match(/^(.+)\s+(meaning|definition)$/i);
  if (suffixMatch) {
    const word = suffixMatch[1].trim();
    if (word) return { is_dictionary: true, dictionary_word: word, is_english_help: false, is_entity: false };
  }

  const englishMatch = q.match(/^(how to spell|correct spelling of|grammar check|is .+ correct|how to use)\s+(.+)/i);
  if (englishMatch) {
    return { is_dictionary: false, is_english_help: true, is_entity: false };
  }

  // 2. Local semantic classifier (Totally free, no API limits)
  try {
    const pipe = await getClassifier();
    const result = await pipe(query, [
      'dictionary lookup', 
      'english grammar help', 
      'info about a person or place', 
      'general'
    ]);

    const topLabel = result.labels[0];
    const topScore = result.scores[0];

    if (topScore > 0.35) {
      if (topLabel === 'dictionary lookup') {
        const word = query
          .replace(/^(define|meaning of|definition of|what is the meaning of|what is the definition of|what is|what's)\s*/gi, '')
          .replace(/\s*(meaning|definition)$/gi, '')
          .trim();
        if (word && word.length > 1) {
          return { is_dictionary: true, dictionary_word: word, is_english_help: false, is_entity: false };
        }
      }
      if (topLabel === 'english grammar help') {
        return { is_dictionary: false, is_english_help: true, is_entity: false };
      }
      if (topLabel === 'info about a person or place') {
        const entityName = query.replace(/^(who is|what is|where is|tell me about|about)\s+/gi, '').trim();
        return { is_dictionary: false, is_english_help: false, is_entity: true, entity_name: entityName };
      }
    }
  } catch (err) {
    console.error("Local intent error:", err);
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
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
      const response = await axios.get(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q as string)}`);
      res.json(response.data[1] || []);
    } catch (error) {
      res.json([]);
    }
  });

  // SEARCH VIA PINECONE (Supports direct query, pre-generated vector, or site: filters)
  app.post('/api/search', async (req, res) => {
    const { query, vector: providedVector, page = 1, type = 'all', clickedUrls = [] } = req.body;
    const pageSize = 10;
    const skip = (page - 1) * pageSize;
    
    const pc = getPinecone();
    if (!pc) return res.status(503).json({ error: 'Pinecone not configured' });
    const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
    const namespace = process.env.PINECONE_NAMESPACE || '';

    // 0. Autocorrect (Spell check) via Gemini
    let correction = null;
    let finalQuery = query;
    try {
      if (process.env.GEMINI_API_KEY) {
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
      console.error("Autocorrect error:", e);
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
      let vector = providedVector;

      if (!vector && query) {
        try {
          const pipe = await getEmbedder();
          const output = await pipe(cleanQuery || query, { pooling: 'mean', normalize: true });
          vector = Array.from(output.data);
        } catch (err: any) {
          console.error('Embedding error:', err.message);
          return res.status(500).json({ error: 'Failed to generate search vector locally' });
        }
      }

      if (!vector || !Array.isArray(vector)) {
        return res.status(400).json({ error: 'Vector or Query is required' });
      }

      // Dynamic filter
      let filter: any = {};
      if (type === 'images') {
        filter["$or"] = [
          { image: { "$exists": true } },
          { thumbnail: { "$exists": true } },
          { ogImage: { "$exists": true } },
          { imageUrl: { "$exists": true } }
        ];
      }
      if (filterDomain) {
        const domainF = { domain: { "$in": domainVariations } };
        filter = filter["$or"] 
          ? { "$and": [domainF, { "$or": filter["$or"] }] }
          : domainF;
      }
      if (newsFilter) {
        filter = Object.keys(filter).length > 0
          ? { "$and": [filter, newsFilter] }
          : newsFilter;
      }

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
              { title: { "$eq": cleanQuery } },
              { name: { "$eq": cleanQuery } },
              { brand: { "$eq": cleanQuery } },
              { url: { "$eq": cleanQuery } },
              { domain: { "$eq": cleanQuery } },
              { domain: { "$eq": filterDomain } }
            ]
          },
          topK: 100,
          includeMetadata: true,
          namespace
        }).catch(() => ({ matches: [] }))
      ]);
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
        const dom = url ? new URL(url).hostname : 'unknown';

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

          if (domainA.startsWith(q)) scoreA += 2.0;
          if (domainB.startsWith(q)) scoreB += 2.0;
          if (domainA.includes(q)) scoreA += 1.0;
          if (domainB.includes(q)) scoreB += 1.0;

          if (titleA === q) scoreA += 0.8;
          if (titleB === q) scoreB += 0.8;
          if (titleA.includes(q)) scoreA += 0.4;
          if (titleB.includes(q)) scoreB += 0.4;

          keywords.forEach(kw => {
            if (titleA.includes(kw)) scoreA += 0.2;
            if (titleB.includes(kw)) scoreB += 0.2;
            if (a.snippet?.toLowerCase().includes(kw)) scoreA += 0.1;
            if (b.snippet?.toLowerCase().includes(kw)) scoreB += 0.1;
          });
        }

        // Global Authority boost
        const authorityDomains = ['wikipedia.org', 'reuters.com', 'gov', 'edu', 'nyt.com', 'bbc.co.uk'];
        if (authorityDomains.some(d => a.url?.includes(d))) scoreA += 0.15;
        if (authorityDomains.some(d => b.url?.includes(d))) scoreB += 0.15;

        return scoreB - scoreA;
      });

      // Pagination with Throttled Sitelinks
      const finalResults: any[] = [];
      const domainCountMap = new Map();

      reranked.forEach(res => {
        const dom = res.displayUrl;
        const count = domainCountMap.get(dom) || 0;
        if (count < 1) { // Only allow 1 main result from each domain in the primary list
          finalResults.push(res);
          domainCountMap.set(dom, count + 1);
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
        totalResults: finalResults.length
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

  // --- VITE MIDDLEWARE ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Only start listening if not running on Vercel or explicitly called via tsx/node
  if (process.env.NODE_VITE_DEV === 'true' || process.env.NODE_ENV !== 'production') {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

  return app;
}

const appPromise = startServer();
export default appPromise;
