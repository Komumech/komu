import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieSession from 'cookie-session';
import { Pinecone } from '@pinecone-database/pinecone';
import axios from 'axios';
import { pipeline, env } from '@xenova/transformers';

dotenv.config();

// Configure Xenova for Serverless (Vercel)
// We must use /tmp as it is the only writable directory
env.allowLocalModels = false;
env.cacheDir = '/tmp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lazy load embedding pipeline
let embedder: any = null;
const getEmbedder = async () => {
  if (!embedder) {
    // WARNING: This model is 400MB+. 
    // Vercel Serverless Functions have a 10s-60s timeout and memory limits.
    // If this fails, consider using an external embedding API.
    embedder = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');
  }
  return embedder;
};

const app = express();

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

  // SEARCH VIA PINECONE (Supports direct query or pre-generated vector)
  app.post('/api/search', async (req, res) => {
    const { query, vector: providedVector, page = 1 } = req.body;
    const pageSize = 10;
    const skip = (page - 1) * pageSize;
    
    let vector = providedVector;

    // IF NO VECTOR BUT QUERY IS PROVIDED, EMBED ON SERVER (Using local Transformers.js for 768 dims)
    if (!vector && query) {
      try {
        const pipe = await getEmbedder();
        const output = await pipe(query, { pooling: 'mean', normalize: true });
        vector = Array.from(output.data);
      } catch (err: any) {
        console.error('Embedding error:', err.message);
        return res.status(500).json({ error: 'Failed to generate search vector locally' });
      }
    }

    if (!vector || !Array.isArray(vector)) {
      return res.status(400).json({ error: 'Vector or Query is required' });
    }

    const pc = getPinecone();
    if (!pc) {
      return res.status(503).json({ error: 'Pinecone not configured' });
    }

    try {
      const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
      
      // HYBRID SEARCH: Vector Query + Metadata Match Query
      // We perform both in parallel to ensure we get semantically similar results AND exact keyword/brand matches
      const [vectorResponse, keywordResponse] = await Promise.all([
        index.query({
          vector,
          topK: 100,
          includeMetadata: true,
        }),
        // Exact Keyword Filter: Try to find documents where title or url matches the query exactly
        // This acts as a "Direct Search" to the index alongside the vector space
        index.query({
          vector: Array(vector.length).fill(0), // Filter-only query
          filter: {
            "$or": [
              { title: { "$eq": query } },
              { name: { "$eq": query } },
              { brand: { "$eq": query } },
              { url: { "$eq": query } }
            ]
          },
          topK: 20,
          includeMetadata: true
        }).catch(() => ({ matches: [] })) // Fail-safe for indexes without these fields
      ]);

      const allMatches = [...vectorResponse.matches, ...keywordResponse.matches];
      
      // Deduplicate by ID
      const seenIds = new Set();
      const uniqueMatches = allMatches.filter(match => {
        if (seenIds.has(match.id)) return false;
        seenIds.add(match.id);
        return true;
      });

      const allResults = uniqueMatches.map(match => {
        const meta = match.metadata as any;
        const dom = meta.url ? new URL(meta.url).hostname : 'unknown';
        return {
          id: match.id,
          score: match.score,
          title: meta.title || meta.name || '',
          url: meta.url || '',
          displayUrl: dom,
          snippet: meta.text || meta.snippet || meta.description || '',
          image: meta.image || meta.thumbnail || meta.ogImage || null,
          sourceIcon: `https://icons.duckduckgo.com/ip3/${dom}.ico`,
          ...meta
        };
      });

      // IMPROVED HYBRID RERANKING (Brand & Domain Aware)
      const q = (query || '').toLowerCase().trim();
      const keywords = q.split(/\s+/).filter(k => k.length > 2);

      const reranked = allResults.sort((a: any, b: any) => {
        let scoreA = a.score || 0;
        let scoreB = b.score || 0;

        if (q) {
          const domainA = (a.displayUrl || '').toLowerCase();
          const domainB = (b.displayUrl || '').toLowerCase();
          const titleA = (a.title || '').toLowerCase();
          const titleB = (b.title || '').toLowerCase();

          // CRITICAL: Brand Domain Match (e.g., search "Microsoft" -> microsoft.com)
          // If the query is contained in the domain start, it's likely the official site
          if (domainA.startsWith(q)) scoreA += 2.0;
          if (domainB.startsWith(q)) scoreB += 2.0;

          // Boost if domain contains the query
          if (domainA.includes(q)) scoreA += 1.0;
          if (domainB.includes(q)) scoreB += 1.0;

          // Penalize social media or secondary profiles if searching for a brand
          const secondarySites = ['linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com', 'crunchbase.com'];
          if (secondarySites.some(s => domainA.includes(s)) && !q.includes('linkedin')) scoreA -= 0.5;
          if (secondarySites.some(s => domainB.includes(s)) && !q.includes('linkedin')) scoreB -= 0.5;

          // Boost exact title match
          if (titleA === q) scoreA += 0.8;
          if (titleB === q) scoreB += 0.8;

          // Boost partial title matches
          if (titleA.includes(q)) scoreA += 0.4;
          if (titleB.includes(q)) scoreB += 0.4;

          // Keyword matches
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

      // Pagination slice
      const paginatedResults = reranked.slice(skip, skip + pageSize);
      const totalPages = Math.ceil(reranked.length / pageSize);

      res.json({ 
        results: paginatedResults,
        page,
        totalPages,
        totalResults: reranked.length
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

// Remove Vite middleware and the manual app.listen call.
// Vercel handles static routing via vercel.json and runs the app instance.
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

// CRITICAL: Export for Vercel
export default app;
