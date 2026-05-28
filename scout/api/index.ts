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
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

let aiInstance: GoogleGenAI | null = null;
function getGenAI() {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("⚠️ GEMINI_API_KEY is not configured on the server. Skipping advanced entity detection.");
      return null;
    }
    aiInstance = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiInstance;
}

// --- SERVERLESS OPTIMIZATION ---
// Ensure Transformers.js uses a writable directory for models in production
env.allowLocalModels = false;
if (process.env.NODE_ENV === 'production') {
  env.cacheDir = '/tmp';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read Firebase config robustly
const configPath = path.join(__dirname, '../firebase-applet-config.json');
let firebaseConfig: any = {};
try {
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) {
  console.error("❌ Failed to read firebase-applet-config.json synchronously:", e);
}

// Initialize Firebase Admin (Server-side)
// We use a dual setup:
// 1. Ambient Default App (no options): automatically utilizes default credentials/project in the Cloud Run space
// 2. Named Config App (with custom project options): utilizes configurations loaded from firebase-applet-config.json
let ambientApp: admin.app.App | undefined;
try {
  if (admin.apps.length === 0) {
    ambientApp = admin.initializeApp();
    console.log("📡 Initialized ambient default Firebase App.");
  } else {
    ambientApp = admin.apps[0];
  }
} catch (e: any) {
  console.log("ℹ️ Ambient default Firebase App initialization skipped or already handled:", e.message);
}

let configApp: admin.app.App | undefined;
if (firebaseConfig.projectId) {
  try {
    const existing = admin.apps.find(app => app.name === 'configApp');
    if (existing) {
      configApp = existing;
    } else {
      configApp = admin.initializeApp({
        projectId: firebaseConfig.projectId,
      }, 'configApp');
      console.log(`📡 Initialized config-specific Firebase App named "configApp" on project: ${firebaseConfig.projectId}`);
    }
  } catch (err: any) {
    console.log("ℹ️ Config Firebase App initialization skipped or failed:", err.message);
  }
}

const db = (ambientApp && firebaseConfig.firestoreDatabaseId)
  ? getFirestore(ambientApp, firebaseConfig.firestoreDatabaseId)
  : (ambientApp ? getFirestore(ambientApp) : null);

const getDbs = () => {
  const instances: Array<{ name: string; db: any }> = [];
  
  // Try to find the default/ambient app
  let defaultAppInstance: admin.app.App | null = null;
  try {
    defaultAppInstance = admin.apps.find(app => app.name === '[DEFAULT]') || null;
    if (!defaultAppInstance && admin.apps.length > 0) {
      defaultAppInstance = admin.apps[0];
    }
  } catch (e) {}

  // 1. Default App instances
  if (defaultAppInstance) {
    try {
      const dbDefault = getFirestore(defaultAppInstance);
      if (dbDefault) {
        instances.push({ name: 'Ambient App (default database)', db: dbDefault });
      }
    } catch (e) {}

    const dbId = firebaseConfig.firestoreDatabaseId;
    if (dbId && dbId !== '(default)' && dbId !== 'default') {
      try {
        const dbCustom = getFirestore(defaultAppInstance, dbId);
        if (dbCustom) {
          instances.push({ name: `Ambient App (custom database: ${dbId})`, db: dbCustom });
        }
      } catch (e) {}
    }
  }

  // 2. Config App instances
  let cfgAppInstance: admin.app.App | null = null;
  try {
    cfgAppInstance = admin.apps.find(app => app.name === 'configApp') || null;
  } catch (e) {}

  if (cfgAppInstance) {
    try {
      const dbConfigDefault = getFirestore(cfgAppInstance);
      if (dbConfigDefault) {
        instances.push({ name: 'Config App (default database)', db: dbConfigDefault });
      }
    } catch (e) {}

    const dbId = firebaseConfig.firestoreDatabaseId;
    if (dbId && dbId !== '(default)' && dbId !== 'default') {
      try {
        const dbConfigCustom = getFirestore(cfgAppInstance, dbId);
        if (dbConfigCustom) {
          instances.push({ name: `Config App (custom database: ${dbId})`, db: dbConfigCustom });
        }
      } catch (e) {}
    }
  }

  return instances;
};

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

// Advanced Intent Detection Helper via Gemini 3.5 Flash
async function detectAdvancedIntent(query: string) {
  const localIntent = await detectLocalIntent(query);
  if (localIntent.is_entity || localIntent.is_dictionary || localIntent.is_english_help) {
    return localIntent;
  }

  const ai = getGenAI();
  if (!ai) return localIntent;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Search query: "${query}"\n\nClassify if this query is a specific company, business, notable brand, organization, product/software, celebrity, historical figure, geographic place, or general knowledge concept that typically warrants an information card/knowledge panel on Scout. Note that general search phrases (e.g. "cloud computing services", "how to build a website", "buy shoes") should NOT be classified as entities. Only specific entities or brands themselves (e.g. "Microsoft Azure", "Apple", "Nvidia", "McDonald's", "Python programming language", "France") should be classified as entities.\n\nRespond strictly with JSON following this schema:\n{\n  "is_entity": boolean,\n  "entity_name": string (canonical display name of the entity, e.g. "Microsoft Azure" for "azure", "Apple Inc." for "apple" or "apple company", "McDonald's" for "mcdonalds", or null if not an entity),\n  "entity_type": string (short category representation, e.g. "Cloud computing platform", "Technology company", "Fast food restaurant", or null)\n}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            is_entity: { type: Type.BOOLEAN },
            entity_name: { type: Type.STRING },
            entity_type: { type: Type.STRING }
          },
          required: ["is_entity"]
        }
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    if (parsed && parsed.is_entity && parsed.entity_name) {
      return {
        is_dictionary: false,
        is_english_help: false,
        is_entity: true,
        entity_name: parsed.entity_name,
        entity_type: parsed.entity_type || null
      };
    }
  } catch (err: any) {
    console.warn("⚠️ Advanced entity intent detection failed:", err.message);
  }

  return localIntent;
}

function cleanSnippet(text: string) {
  if (!text) return '';
  return text
    .replace(/\[\d+\]/g, '') 
    .replace(/(\||\-|─|═){2,}(\s?(\||\-|─|═){2,})*/g, ' ') 
    .replace(/\s+/g, ' ')
    .trim();
}

function isMostlyEnglish(text: string): boolean {
  if (!text) return true;
  
  const cleanText = text.trim();
  if (cleanText.length === 0) return true;

  // 1. Cyrillic, Arabic, Chinese/Japanese/Korean/EastAsian, Hindi/Devanagari, Hebrew, Tamil, Thai, Kannada, Telugu, Bengali
  const nonLatinRegex = /[\u0400-\u04FF\u0600-\u06FF\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u0900-\u097f\u0590-\u05ff\u0b80-\u0bff\u0e00-\u0e7f\u0c80-\u0cff\u0c00-\u0c7f\u0980-\u09ff]/;
  if (nonLatinRegex.test(cleanText)) {
    return false;
  }

  // 2. Check for UTF-8 mojibake patterns of Cyrillic (words mis-decoded as Latin-1 containing frequent Ð and Ñ)
  const mojibakeCount = (cleanText.match(/[\u00D0\u00D1]/g) || []).length;
  if (mojibakeCount > 3 && mojibakeCount / cleanText.length > 0.05) {
    return false;
  }

  // 3. Score against common English stopwords
  const words = cleanText.toLowerCase().split(/[^a-z\'\-]+/);
  
  const englishWords = new Set([
    'the', 'and', 'of', 'to', 'is', 'you', 'that', 'it', 'he', 'was', 'for', 'on', 'are', 'as', 'with', 
    'his', 'they', 'i', 'at', 'be', 'this', 'have', 'from', 'or', 'one', 'had', 'by', 'but', 
    'not', 'what', 'all', 'were', 'we', 'when', 'your', 'can', 'there', 'use', 'an', 'each', 
    'which', 'she', 'do', 'how', 'their', 'if', 'will', 'up', 'other', 'about', 'out', 'many', 'then', 
    'them', 'these', 'so', 'some', 'her', 'would', 'make', 'like', 'him', 'into', 'time', 'has', 
    'look', 'two', 'more', 'write', 'go', 'see', 'no', 'way', 'could', 'people', 'my', 'than', 
    'first', 'been', 'call', 'who', 'its', 'now', 'find'
  ]);

  const nonEnglishIdentifiers = new Set([
    // French
    'les', 'des', 'pour', 'dans', 'avec', 'mais', 'nous', 'vous', 'leur',
    // Spanish / Portuguese
    'los', 'las', 'para', 'con', 'pero', 'como', 'este', 'esta', 'mais',
    // German
    'der', 'die', 'das', 'den', 'dem', 'des', 'mit', 'und', 'ist', 'sind', 'von',
    // Finnish
    'ja', 'se', 'ei', 'hän', 'he', 'että', 'mutta', 'tai', 'vai', 'onko', 'kyse',
    // Norwegian / Danish / Swedish
    'og', 'jeg', 'det', 'eller', 'men', 'på', 'til', 'vi', 'de', 'ikke'
  ]);

  let englishCount = 0;
  let nonEnglishCount = 0;
  let totalWordsChecked = 0;

  for (const w of words) {
    if (w.length > 1) {
      totalWordsChecked++;
      if (englishWords.has(w)) {
        englishCount++;
      } else if (nonEnglishIdentifiers.has(w)) {
        nonEnglishCount++;
      }
    }
  }

  if (nonEnglishCount > englishCount && nonEnglishCount > 0) {
    return false;
  }

  if (totalWordsChecked > 5 && englishCount === 0) {
    return false;
  }

  return true;
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
  secure: process.env.NODE_ENV === 'production',
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

async function logClickstream(req: any, query: string, type: string, url: string = '', durationMs: number | null = null, position: number | null = null) {
  const dbs = getDbs();
  if (dbs.length === 0) {
    console.log("ℹ️ No Firestore databases initialized to write clickstream.");
    return;
  }

  const reqSessionId = req?.body?.sessionId;
  const reqUid = req?.body?.uid;

  let sessionId = reqSessionId;
  if (!sessionId) {
    if (req && req.session) {
      if (!req.session.session_id) {
        req.session.session_id = 'sess-' + Math.random().toString(36).substring(2, 12);
      }
      sessionId = req.session.session_id;
    } else {
      sessionId = 'sess-unknown';
    }
  }

  let uid = reqUid;
  if (!uid) {
    if (req && req.session && req.session.user) {
      uid = req.session.user.sub || req.session.user.email || 'user';
    } else {
      uid = 'guest';
    }
  }

  const finalDuration = durationMs !== null ? durationMs : (req?.body?.durationMs !== undefined ? req.body.durationMs : null);
  const finalPosition = position !== null ? position : (req?.body?.position !== undefined ? req.body.position : null);

  let writtenSuccessfully = false;

  for (const { name, db: dbInstance } of dbs) {
    try {
      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      await dbInstance.collection('clickstream').add({
        query: query || '',
        type: type || 'search',
        url: url || '',
        timestamp,
        sessionId,
        uid,
        duration: finalDuration,
        position: finalPosition
      });
      console.log(`📡 Successfully logged clickstream to [${name}]: query="${query}", type="${type}", url="${url}", sesh="${sessionId}"`);
      writtenSuccessfully = true;
    } catch (err: any) {
      console.error(`❌ Clickstream log failed for database [${name}] with error:`, err);
    }
  }

  if (!writtenSuccessfully) {
    console.warn("⚠️ Clickstream record was not saved to any available server-side database partition; fallback check recommended.");
  }
}

app.post('/api/feedback', async (req, res) => {
  try {
    const { id, type, queryText, url = '', durationMs = null, position = null } = req.body; 

    // Log this feedback stream to clickstream first if a query was active
    if (queryText) {
      await logClickstream(req, queryText, type, url, durationMs, position);
    }

    if (!id) return res.status(400).json({ error: 'Record ID required' });

    const pc = getPinecone();
    if (!pc) {
      return res.json({ success: true, message: 'Logged to Firestore successfully. Pinecone database not configured offline.' });
    }
    const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
    const namespace = process.env.PINECONE_NAMESPACE || 'default';

    const fetchRes = await index.namespace(namespace).fetch({ ids: [id] });
    const record = fetchRes.records[id];
    if (!record) return res.status(404).json({ error: 'Record not found in Pinecone' });

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
    const pageSize = type === 'images' ? 40 : 8;
    const skip = (page - 1) * pageSize;
    
    if (imageQuery) {
      return res.status(400).json({ 
        error: "Feature Unavailable", 
        message: "Visual search requires a high-memory environment not available in this tier." 
      });
    }

    const pc = getPinecone();
    if (!pc) return res.status(503).json({ error: 'Pinecone not configured' });
    const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
    const namespace = process.env.PINECONE_NAMESPACE || 'default';

    const finalQuery = query;

    if (page === 1 && finalQuery && typeof finalQuery === 'string') {
      await logClickstream(req, finalQuery, 'search');
    }

    // --- PARALLEL BLOCK 1: Start tasks that don't need the vector ---
    const intentDataPromise = detectAdvancedIntent(finalQuery);
    const embeddingPromise = providedVector 
      ? Promise.resolve(providedVector.length > 768 ? providedVector.slice(0, 768) : providedVector) 
      : getEmbedding(finalQuery);

    // Dictionary lookup can be parallelized with embeddings
    const dictionaryPromise = intentDataPromise.then(async (intentData: any) => {
      if (intentData?.is_dictionary && intentData.dictionary_word) {
        try {
          const word = intentData.dictionary_word.trim();
          const dictUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
          const dictRes = await axios.get(dictUrl, { timeout: 1500 });
          const data = dictRes.data[0];
          if (data) {
            return {
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
      return null;
    });

    const [intentData, vector, dictionaryResult] = await Promise.all([
      intentDataPromise,
      embeddingPromise,
      dictionaryPromise
    ]);

    let suggestKnowledgePanel = intentData?.is_entity || false;
    let detectedEntity = intentData?.is_entity ? { name: intentData.entity_name, type: (intentData as any).entity_type || null } : null;
    let isEnglishHelp = intentData?.is_english_help || false;

    if (!vector) {
      if (finalQuery) {
        return res.status(503).json({ 
          error: "Neural Engines Warming Up", 
          message: "Wait while Scout warms up its brain." 
        });
      }
    }
    
    const activeVector = vector || Array(768).fill(0);

    const siteMatch = query?.match(/site:\s*([a-zA-Z0-9.-]+)/i);
    const filterDomain = siteMatch ? siteMatch[1].toLowerCase() : null;
    const cleanQuery = filterDomain ? query.replace(/site:\s*[a-zA-Z0-9.-]+/i, '').trim() : query;
    const domainVariations = filterDomain ? [filterDomain, `www.${filterDomain}`] : null;

    const newsFilter = type === 'news' ? {
      "$or": [
        { domain: { "$in": ['nytimes.com', 'bbc.co.uk', 'reuters.com', 'theverge.com', 'cnn.com', 'theguardian.com'] } },
        { isNews: { "$eq": true } }
      ]
    } : null;

    let filter: any = {};
    if (type === 'images') filter = { is_image: { "$eq": true } };
    if (filterDomain) filter = { "$and": [filter, { domain: { "$in": domainVariations } }] };
    if (newsFilter) filter = { "$and": [filter, newsFilter] };

    const qLower = cleanQuery.toLowerCase();
    const variations = [...new Set([
      cleanQuery, qLower, qLower.toUpperCase(), `${qLower}.com`, `${qLower}.org`,
      `${qLower}.net`, `www.${qLower}.com`, `www.${qLower}`, `${qLower} search`, `${qLower} official`
    ])];

    // --- PARALLEL BLOCK 2: Query Pinecone for everything ---
    const [intentRes, vRes, kRes] = await Promise.all([
      index.namespace('intent').query({
        vector: activeVector,
        topK: 3,
        includeMetadata: true
      }).catch(() => ({ matches: [] })),
      index.query({
        vector: activeVector,
        topK: 1000,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        includeMetadata: true,
        namespace
      }).catch(() => ({ matches: [] })),
      index.query({
        vector: Array(activeVector.length).fill(0),
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
      }).catch(() => ({ matches: [] }))
    ]);

    let intentBoosts: Record<string, number> = {};
    intentRes.matches.forEach(match => {
      if (match.metadata?.doc_weights) {
        const weights = JSON.parse(match.metadata.doc_weights as string);
        const intentStrength = match.score || 0; 
        Object.entries(weights).forEach(([docId, weight]) => {
          intentBoosts[docId] = (intentBoosts[docId] || 0) + ((weight as number) * intentStrength * 5.0);
        });
      }
    });

    const brands = ['google', 'apple', 'facebook', 'microsoft', 'amazon', 'github', 'openai', 'anthropic'];
    const activeBrand = brands.find(b => qLower.includes(b));

    const allMatches = [...vRes.matches, ...kRes.matches];
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

      const titleStr = meta.title || meta.name || '';
      const snippetStr = meta.snippet || meta.text || meta.description || '';
      const isEnglish = isMostlyEnglish(snippetStr);

      return {
        ...meta,
        id: match.id,
        score: match.score || 0,
        boost,
        isNavIntent,
        isExactMatch,
        isRootDomain,
        isOfficialProperty,
        isEnglish,
        title: prettifyTitle(titleStr, url),
        url: url,
        displayUrl: dom,
        snippet: cleanSnippet(snippetStr),
        image: meta.image || meta.thumbnail || meta.ogImage || meta.imageUrl || null,
        sourceIcon: `https://icons.duckduckgo.com/ip3/${dom}.ico`,
      };
    });

    const reranked = allResults.sort((a, b) => {
      // 1. Hybrid Score: Vector Similarity + Popularity Boost
      // mpnet scores are usually between 0.3 and 0.9.
      let sA = (a.score * 0.8) + (Math.log10(a.boost + 1) * 0.2);
      let sB = (b.score * 0.8) + (Math.log10(b.boost + 1) * 0.2);

      // Prioritize English results
      if (a.isEnglish && !b.isEnglish) sA += 25.0;
      if (!a.isEnglish && b.isEnglish) sB += 25.0;

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
       resultsWithOptionalImages = [...paginatedResults, ...imageResults.slice(0, 30)];
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
  const clientRedirectUri = req.query.redirectUri as string;
  const redirectUri = clientRedirectUri || `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback`;
  
  if (req.session) {
    (req.session as any).oauth_redirect_uri = redirectUri;
  }

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
    const sessionRedirectUri = (req.session as any)?.oauth_redirect_uri || `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback`;
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: sessionRedirectUri,
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

// --- AI TRAINING EXPORT (Phase 3) ---
const ADMIN_EMAILS = ['komumech@gmail.com']; // Your authorized email

app.get('/api/admin/clickstream', async (req, res) => {
  // Admin Guard
  const user = req.session?.user;
  if (!user || !ADMIN_EMAILS.includes(user.email?.toLowerCase())) {
    return res.status(403).json({ error: 'Unauthorized: Admin access only' });
  }

  const dbs = getDbs();
  if (dbs.length === 0) {
    console.log("⚠️ No active Firestore databases available. Returning empty response.");
    return res.json([]);
  }

  try {
    const allEventsMap = new Map<string, any>();

    for (const { name, db: dbInstance } of dbs) {
      try {
        let snapshot;
        try {
          snapshot = await dbInstance.collection('clickstream').orderBy('timestamp', 'desc').limit(1000).get();
        } catch (orderErr: any) {
          console.warn("⚠️ Firestore orderBy timestamp failed, trying unordered fetch:", orderErr.message);
          snapshot = await dbInstance.collection('clickstream').limit(1000).get();
        }

        snapshot.docs.forEach(doc => {
          const data = doc.data();
          let dateObj: Date;
          if (data.timestamp) {
            if (typeof data.timestamp.toDate === 'function') {
              dateObj = data.timestamp.toDate();
            } else if (data.timestamp._seconds !== undefined) {
              dateObj = new Date(data.timestamp._seconds * 1000);
            } else {
              dateObj = new Date(data.timestamp);
            }
          } else {
            dateObj = new Date();
          }
          
          allEventsMap.set(doc.id, {
            id: doc.id,
            ...data,
            timestamp: dateObj
          });
        });
      } catch (dbErr: any) {
        console.error(`❌ Failed to query clickstream from a Firestore database named [${name}]:`, dbErr);
      }
    }

    const events = Array.from(allEventsMap.values());

    // Sort in-memory to guarantee descending/ascending order correctly
    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    // Process analytics and respond purely with the real events
    res.json(events);
  } catch (err: any) {
    console.error("❌ Clickstream retrieval failed:", err.message);
    res.status(500).json({ error: "Failed to load real clickstream database", message: err.message });
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
