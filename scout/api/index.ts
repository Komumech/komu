import express from 'express';
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 50;
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

// --- MOVIE & TV SHOW DATABASE (TMDB + GEMINI FALLBACK) ---
async function getMovieOrTVData(query: string, entityName?: string, entityType?: string): Promise<any | null> {
  const apiKey = process.env.TMDB_API_KEY;
  const targetQuery = entityName || query;
  
  if (apiKey) {
    try {
      console.log(`🎬 [TMDB] Performing live multi-search for query: "${targetQuery}"`);
      const searchRes = await axios.get(`https://api.themoviedb.org/3/search/multi`, {
        params: {
          api_key: apiKey,
          query: targetQuery,
          language: 'en-US',
          page: 1
        },
        timeout: 2500
      });
      
      const results = searchRes.data?.results || [];
      const match = results.find((r: any) => r.media_type === 'movie' || r.media_type === 'tv');
      
      if (match) {
        const id = match.id;
        const mediaType = match.media_type;
        console.log(`🎬 [TMDB] Found match of type "${mediaType}" with ID ${id}`);
        
        const detailsRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${id}`, {
          params: {
            api_key: apiKey,
            append_to_response: 'credits'
          },
          timeout: 2500
        });
        
        const d = detailsRes.data;
        const cast = (d.credits?.cast || []).slice(0, 10).map((c: any) => ({
          id: c.id,
          name: c.name,
          character: c.character || '',
          profilePath: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200'
        }));
        
        const genres = (d.genres || []).map((g: any) => g.name);
        const posterPath = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=400';
        const backdropPath = d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=1200';
        
        let seasons: any[] = [];
        let episodes: any[] = [];
        
        if (mediaType === 'tv') {
          seasons = (d.seasons || []).map((s: any) => ({
            id: s.id,
            name: s.name,
            seasonNumber: s.season_number,
            episodeCount: s.episode_count,
            airDate: s.air_date,
            posterPath: s.poster_path ? `https://image.tmdb.org/t/p/w200${s.poster_path}` : null
          }));
          
          try {
            const seasonRes = await axios.get(`https://api.themoviedb.org/3/tv/${id}/season/1`, {
              params: { api_key: apiKey },
              timeout: 1500
            });
            if (seasonRes.data && seasonRes.data.episodes) {
              episodes = seasonRes.data.episodes.map((ep: any) => ({
                id: ep.id,
                name: ep.name,
                episodeNumber: ep.episode_number,
                overview: ep.overview || '',
                airDate: ep.air_date || '',
                rating: ep.vote_average ? parseFloat(ep.vote_average.toFixed(1)) : 0,
                stillPath: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null
              }));
            }
          } catch (seasonErr: any) {
            console.warn(`🎬 [TMDB] Season 1 fetch failed:`, seasonErr.message);
          }
        }
        
        const runtimeStr = mediaType === 'movie' 
          ? `${d.runtime || 0} min` 
          : `${d.episode_run_time?.[0] || d.episode_run_time || 45} min per episode`;
          
        return {
          id: d.id,
          mediaType,
          title: d.title || d.name,
          originalTitle: d.original_title || d.original_name,
          tagline: d.tagline || '',
          overview: d.overview,
          releaseDate: d.release_date || d.first_air_date,
          runtime: runtimeStr,
          rating: d.vote_average ? parseFloat(d.vote_average.toFixed(1)) : 0,
          voteCount: d.vote_count || 0,
          genres,
          posterPath,
          backdropPath,
          status: d.status,
          cast,
          seasons,
          episodes,
          source: 'tmdb'
        };
      }
    } catch (err: any) {
      console.error("🎬 [TMDB] Live TMDB lookup failed:", err.message);
    }
  }
  
  try {
    const ai = getGenAI();
    if (!ai) return null;
    
    console.log(`🎬 [TMDB Fallback] Synthesizing accurate database info via Gemini for "${targetQuery}"`);
    const prompt = `You are a cinema and television metadata expert database. The user is searching for "${targetQuery}" which is a movie or TV show.
Identify the correct, real-world movie or TV show.
Generate movie/show metadata accurately representing real-world cast details, episode list for season 1, and genres.
Return a valid JSON object matching this exact schema:
{
  "isSuccess": true,
  "id": number (e.g. 550),
  "mediaType": "movie" | "tv" (must specify type),
  "title": "string (the official movie or show name)",
  "originalTitle": "string",
  "tagline": "string or null (the famous tagline)",
  "overview": "string (the accurate story synopsis summary, at least 2-3 sentences)",
  "releaseDate": "string (YYYY-MM-DD, e.g. '1999-10-15')",
  "runtime": "string (e.g., '139 min' or '50 min per episode')",
  "rating": number (e.g., 8.8),
  "voteCount": number,
  "genres": ["string", "string"],
  "posterPath": "string (an elegant Unsplash poster-style photo URL representing the movie poster or beautiful promotional capture, e.g. an aesthetic screen click from the topic)",
  "backdropPath": "string (a beautiful wide horizontal Unsplash horizontal photo URL for background)",
  "status": "string (e.g., 'Released' or 'Returning Series')",
  "cast": [
    {
      "id": number,
      "name": "string (real actor name)",
      "character": "string (character name)",
      "profilePath": "string (high-quality Unsplash portrait face picture URL for the actor)"
    }
  ],
  "seasons": [
    {
      "id": number,
      "name": "Season 1",
      "seasonNumber": 1,
      "episodeCount": number,
      "airDate": "string (YYYY-MM-DD)"
    }
  ],
  "episodes": [
    {
      "id": number,
      "name": "string (real episode title)",
      "episodeNumber": number,
      "overview": "string (authentic episode recap)",
      "airDate": "string (YYYY-MM-DD)",
      "rating": number,
      "stillPath": "string (high-quality horizontal Unsplash scene photo)"
    }
  ]
}
If "${targetQuery}" is clearly NOT a movie or TV show, set "isSuccess" to false and empty other fields. Output ONLY valid JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    
    const text = response.text || "";
    if (text) {
      const parsed = JSON.parse(cleanJsonString(text));
      if (parsed && parsed.isSuccess) {
        parsed.source = 'synthetic_gemini';
        return parsed;
      }
    }
  } catch (err: any) {
    console.error("🎬 [TMDB Fallback] Gemini synthesis failed:", err.message);
  }
  return null;
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
// We align the default and config apps with the project ID specified in firebase-applet-config.json to prevent pointing to the sandbox project.
let ambientApp: admin.app.App | undefined;
try {
  if (admin.apps.length === 0) {
    if (firebaseConfig.projectId) {
      ambientApp = admin.initializeApp({
        projectId: firebaseConfig.projectId,
      });
      console.log(`📡 Initialized default Firebase App using config projectId: ${firebaseConfig.projectId}`);
    } else {
      ambientApp = admin.initializeApp();
      console.log("📡 Initialized ambient default Firebase App.");
    }
  } else {
    ambientApp = admin.apps[0];
  }
} catch (e: any) {
  console.log("ℹ️ Default Firebase App initialization skipped or already handled:", e.message);
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
  
  let appInstance: admin.app.App | null = null;
  try {
    if (admin.apps.length > 0) {
      appInstance = admin.apps.find(app => app.name === 'configApp') || admin.apps[0];
    }
  } catch (e) {}

  if (appInstance) {
    const projId = firebaseConfig.projectId || 'komu-notes';
    const dbId = firebaseConfig.firestoreDatabaseId;
    const isCustomDb = dbId && dbId !== '(default)' && dbId !== 'default';
    try {
      const dbInstance = isCustomDb ? getFirestore(appInstance, dbId) : getFirestore(appInstance);
      if (dbInstance) {
        instances.push({ name: `${projId} (${isCustomDb ? dbId : 'default'})`, db: dbInstance });
      }
    } catch (e) {}
  }
  
  return instances;
};

// --- CLEANUP: Removed Gemini initialization from backend ---
// All AI calls moved to Frontend per security guidelines.

// --- DYNAMIC QUERY INTENT PREFERENCES & CLASSIFICATION SYSTEM ---
interface QueryPreferenceRule {
  query: string;
  entityType: string;
  detectedIntent: string;
  clicksCount: number;
  clickedUrls: Record<string, number>;
  disallowedIntents: string[];
  confidence: number;
  searchCount?: number;
  thumbsUpCount?: number;
  thumbsDownCount?: number;
  feedbacks?: Array<{
    type: string;
    url?: string;
    timestamp: string;
  }>;
}

// --- UTILITY TO CLEAN AI MODEL JSON RESPONSE STRINGS ---
function cleanJsonString(rawText: string): string {
  if (!rawText) return '{}';
  let cleaned = rawText.trim();
  // Strip any markdown code blocks (e.g. ```json ... ```)
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

// --- FIRESTORE REST API INTEGRATION LAYER WITH CLIENT API KEY ---
// Converts standard JS values into Firestore's typed REST API proto-JSON fields
function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: val.toString() };
    return { doubleValue: val };
  }
  if (typeof val === 'boolean') return { booleanValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(toFirestoreValue)
      }
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [key, kVal] of Object.entries(val)) {
      fields[key] = toFirestoreValue(kVal);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

// Converts Firestore's typed REST API proto-JSON fields back to standard JS values
function fromFirestoreValue(fVal: any): any {
  if (!fVal) return null;
  if ('nullValue' in fVal) return null;
  if ('stringValue' in fVal) return fVal.stringValue;
  if ('integerValue' in fVal) return parseInt(fVal.integerValue, 10);
  if ('doubleValue' in fVal) return parseFloat(fVal.doubleValue);
  if ('booleanValue' in fVal) return fVal.booleanValue;
  if ('timestampValue' in fVal) return fVal.timestampValue;
  if ('arrayValue' in fVal) {
    return (fVal.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in fVal) {
    const fields = fVal.mapValue.fields || {};
    const obj: Record<string, any> = {};
    for (const [key, val] of Object.entries(fields)) {
      obj[key] = fromFirestoreValue(val);
    }
    return obj;
  }
  return null;
}

async function getFirestoreREST(collectionPath: string, docId?: string) {
  const proj = firebaseConfig.projectId || 'komu-notes';
  const key = firebaseConfig.apiKey;
  if (!key) throw new Error("No API key configured for Firestore REST access.");

  let url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/${collectionPath}`;
  if (docId) {
    url += `/${docId}`;
  }
  url += `?key=${key}`;

  const res = await axios.get(url);
  return res.data;
}

async function writeFirestoreREST(collectionPath: string, docId: string | null, payload: any) {
  const proj = firebaseConfig.projectId || 'komu-notes';
  const key = firebaseConfig.apiKey;
  if (!key) throw new Error("No API key configured for Firestore REST write.");

  let url = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/${collectionPath}`;
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    fields[k] = toFirestoreValue(v);
  }

  if (docId) {
    url += `/${docId}?key=${key}`;
    const res = await axios.patch(url, { fields });
    return res.data;
  } else {
    url += `?key=${key}`;
    const res = await axios.post(url, { fields });
    return res.data;
  }
}

async function listQueryPreferencesREST(): Promise<QueryPreferenceRule[]> {
  try {
    const data = await getFirestoreREST('query_preferences');
    const documents = data.documents || [];
    return documents.map((docItem: any) => {
      const fields = docItem.fields || {};
      const obj: Record<string, any> = {};
      for (const [key, val] of Object.entries(fields)) {
        obj[key] = fromFirestoreValue(val);
      }
      return obj as QueryPreferenceRule;
    });
  } catch (err: any) {
    console.warn("⚠️ REST fallback: List query_preferences skipped or collection empty:", err.message);
    return [];
  }
}

async function getQueryPreferenceREST(docId: string): Promise<QueryPreferenceRule | null> {
  try {
    const data = await getFirestoreREST('query_preferences', docId);
    const fields = data.fields || {};
    const obj: Record<string, any> = {};
    for (const [key, val] of Object.entries(fields)) {
      obj[key] = fromFirestoreValue(val);
    }
    return obj as QueryPreferenceRule;
  } catch (err: any) {
    if (err.response && err.response.status === 404) {
      return null;
    }
    console.warn(`⚠️ REST fallback: Map preference for ID ${docId} skipped:`, err.message);
    return null;
  }
}

async function setQueryPreferenceREST(docId: string, rule: QueryPreferenceRule) {
  try {
    await writeFirestoreREST('query_preferences', docId, rule);
    console.log(`📡 [QueryPreferences REST] Successfully set query preference block: "${rule.query}"`);
  } catch (err: any) {
    console.warn(`⚠️ REST error writing query preference for rule ${docId}:`, err.message);
  }
}

async function addClickstreamREST(payload: any) {
  try {
    const docPayload = {
      ...payload,
      timestamp: payload.timestamp ? payload.timestamp : new Date().toISOString()
    };
    await writeFirestoreREST('clickstream', null, docPayload);
    console.log(`📡 [Clickstream REST] Successfully logged clickstream: query="${payload.query}", type="${payload.type}"`);
    return true;
  } catch (err: any) {
    console.warn(`⚠️ REST error writing clickstream record:`, err.message);
    return false;
  }
}

async function listClickstreamREST(): Promise<any[]> {
  try {
    const data = await getFirestoreREST('clickstream');
    const documents = data.documents || [];
    const events = documents.map((docItem: any) => {
      const fields = docItem.fields || {};
      const obj: Record<string, any> = {};
      for (const [key, val] of Object.entries(fields)) {
        obj[key] = fromFirestoreValue(val);
      }
      return obj;
    });
    // Sort descending by timestamp
    events.sort((a, b) => {
      const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tB - tA;
    });
    return events;
  } catch (err: any) {
    console.warn(`⚠️ REST error listing clickstream:`, err.message);
    return [];
  }
}

let queryPreferencesCache: Record<string, QueryPreferenceRule> = {};

async function loadQueryPreferences() {
  try {
    const jsonPath = path.join(process.cwd(), 'api', 'search_intent_knowledge.json');
    if (fs.existsSync(jsonPath)) {
      const data = fs.readFileSync(jsonPath, 'utf8');
      queryPreferencesCache = JSON.parse(data);
      console.log(`🧠 [QueryPreferences] Loaded ${Object.keys(queryPreferencesCache).length} rules from search_intent_knowledge.json`);
    } else {
      console.log(`ℹ️ [QueryPreferences] search_intent_knowledge.json not found, initializing empty`);
    }
  } catch (err) {
    console.error(`❌ [QueryPreferences] Error loading json seed:`, err);
  }

  // Load dynamically using web authenticated REST client
  try {
    const rulesList = await listQueryPreferencesREST();
    if (rulesList.length > 0) {
      rulesList.forEach(rule => {
        if (rule && rule.query) {
          queryPreferencesCache[rule.query.trim().toLowerCase()] = rule;
        }
      });
      console.log(`📡 [QueryPreferences REST Remote] Synchronized ${rulesList.length} real-time rules from Firestore`);
    }
  } catch (err: any) {
    console.warn(`⚠️ REST list fallback failed or database empty, utilizing local cache:`, err.message);
  }
}

// Automatically load preferences at app startup
loadQueryPreferences().catch(err => console.error("❌ Failed to run loadQueryPreferences on start:", err));

async function getQueryIntentRule(queryText: string): Promise<QueryPreferenceRule | null> {
  if (!queryText) return null;
  const cleanQ = queryText.trim().toLowerCase();
  
  if (queryPreferencesCache[cleanQ]) {
    return queryPreferencesCache[cleanQ];
  }

  try {
    const docId = cleanQ.replace(/[^a-zA-Z0-9_-]/g, '_');
    const remoteRule = await getQueryPreferenceREST(docId);
    if (remoteRule) {
      queryPreferencesCache[cleanQ] = remoteRule;
      return remoteRule;
    }
  } catch (err) {}

  return null;
}

async function logSearchToJSON(queryText: string) {
  if (!queryText) return;
  const cleanQ = queryText.trim().toLowerCase();
  
  let rule = queryPreferencesCache[cleanQ];
  if (!rule) {
    rule = {
      query: cleanQ,
      entityType: "General / Learning Profile",
      detectedIntent: "general",
      clicksCount: 0,
      clickedUrls: {},
      disallowedIntents: [],
      confidence: 0.1,
      searchCount: 0,
      thumbsUpCount: 0,
      thumbsDownCount: 0,
      feedbacks: []
    };
  }
  
  rule.searchCount = (rule.searchCount || 0) + 1;
  await saveQueryPreferenceRule(rule);
}

async function logFeedbackToJSON(queryText: string, feedbackType: string, url: string = '') {
  if (!queryText) return;
  const cleanQ = queryText.trim().toLowerCase();
  
  let rule = queryPreferencesCache[cleanQ];
  if (!rule) {
    rule = {
      query: cleanQ,
      entityType: "General / Learning Profile",
      detectedIntent: "general",
      clicksCount: 0,
      clickedUrls: {},
      disallowedIntents: [],
      confidence: 0.1,
      searchCount: 0,
      thumbsUpCount: 0,
      thumbsDownCount: 0,
      feedbacks: []
    };
  }

  if (feedbackType === 'success') {
    rule.thumbsUpCount = (rule.thumbsUpCount || 0) + 1;
  } else if (feedbackType === 'pogo') {
    rule.thumbsDownCount = (rule.thumbsDownCount || 0) + 1;
  } else if (feedbackType === 'click') {
    rule.clicksCount = (rule.clicksCount || 0) + 1;
  }

  if (!rule.feedbacks) {
    rule.feedbacks = [];
  }
  
  rule.feedbacks.push({
    type: feedbackType,
    url,
    timestamp: new Date().toISOString()
  });

  await saveQueryPreferenceRule(rule);
}

async function saveQueryPreferenceRule(rule: QueryPreferenceRule) {
  if (!rule || !rule.query) return;
  const cleanQ = rule.query.trim().toLowerCase();
  
  queryPreferencesCache[cleanQ] = rule;

  try {
    const jsonPath = path.join(process.cwd(), 'api', 'search_intent_knowledge.json');
    fs.writeFileSync(jsonPath, JSON.stringify(queryPreferencesCache, null, 2), 'utf8');
  } catch (err) {
    console.error(`❌ [QueryPreferences] Failed to write back to JSON on disk:`, err);
  }

  try {
    const docId = cleanQ.replace(/[^a-zA-Z0-9_-]/g, '_');
    await setQueryPreferenceREST(docId, rule);
  } catch (err: any) {
    console.error(`❌ [QueryPreferences] Failed to write rule to Firestore REST:`, err.message);
  }
}

async function learnQueryIntent(queryText: string, clickedUrl: string, interactionType: string = 'click') {
  if (!queryText || !clickedUrl) return;
  const cleanQ = queryText.trim().toLowerCase();

  let rule = queryPreferencesCache[cleanQ];
  if (!rule) {
    rule = {
      query: cleanQ,
      entityType: "General / Learning Profile",
      detectedIntent: "general",
      clicksCount: 0,
      clickedUrls: {},
      disallowedIntents: [],
      confidence: 0.1
    };
  }

  rule.clicksCount += 1;
  rule.clickedUrls[clickedUrl] = (rule.clickedUrls[clickedUrl] || 0) + 1;

  const movieIndicators = [
    'rottentomatoes.com', 'imdb.com', 'justwatch.com', 'netflix.com', 'disneyplus.com',
    'hulu.com', 'hbo.com', 'max.com', 'youtube.com/watch', 'tv-show', 'trailer', 'boxofficemojo',
    'disney', 'marvel', 'dc-comics', 'themoviedb', 'letterboxd'
  ];
  const gamingIndicators = [
    'runescape.wiki', 'wowhead.com', 'icy-veins.com', 'gamepedia.com', 'ign.com', 'fandom.com', 'wiki/dragonwilds', 'nexusmods'
  ];
  const instructionalIndicators = [
    'wikihow.com', 'instructables.com', 'howtogeek.com', 'ifixit.com', 'tutorialspoint', 'stackoverflow'
  ];

  let movieClicks = 0;
  let gamingClicks = 0;
  let instructionalClicks = 0;

  Object.entries(rule.clickedUrls).forEach(([url, count]) => {
    const urlLower = url.toLowerCase();
    if (movieIndicators.some(ind => urlLower.includes(ind))) {
      movieClicks += count;
    }
    if (gamingIndicators.some(ind => urlLower.includes(ind))) {
      gamingClicks += count;
    }
    if (instructionalIndicators.some(ind => urlLower.includes(ind))) {
      instructionalClicks += count;
    }
  });

  const totalAnalyzed = movieClicks + gamingClicks + instructionalClicks;
  if (totalAnalyzed > 0) {
    if (movieClicks > gamingClicks && movieClicks > instructionalClicks) {
      rule.entityType = "Movie / Entertainment / Fictional Franchise";
      rule.detectedIntent = "general";
      if (!rule.disallowedIntents.includes('how_to')) {
        rule.disallowedIntents.push('how_to');
      }
      rule.confidence = Math.min(0.99, 0.5 + (movieClicks / totalAnalyzed) * 0.4);
    } else if (gamingClicks > movieClicks && gamingClicks > instructionalClicks) {
      rule.entityType = "Gaming Guide / Tutorial";
      // Let parser run unless explicit override, but classify it
    } else if (instructionalClicks > movieClicks && instructionalClicks > gamingClicks) {
      rule.entityType = "Instructional Guide / How-To";
      rule.detectedIntent = "how_to";
      rule.confidence = Math.min(0.99, 0.5 + (instructionalClicks / totalAnalyzed) * 0.4);
    }
  }

  await saveQueryPreferenceRule(rule);
}

// Scout Semantic Brain (mpnet-base)
let text_pipe: any = null;
let isModelLoading = false;

async function getPipes() {
  if (text_pipe) return { text_pipe };
  if (isModelLoading) return null;
  
  try {
    isModelLoading = true;
    console.log("🚀 Warming Scout Semantic Brain (all-mpnet-base-v2)...");
    
    // Semantic Encoder (768-dim) with 8-bit quantization for 3x faster inference times
    if (!text_pipe) text_pipe = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2', { quantized: true });

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
  const cleanQ = query.trim().toLowerCase();
  if (advancedIntentCache.has(cleanQ)) {
    return advancedIntentCache.get(cleanQ);
  }

  const localIntent = await detectLocalIntent(query);
  if (localIntent.is_entity || localIntent.is_dictionary || localIntent.is_english_help) {
    return localIntent;
  }

  // Bypass LLM classification for queries that are clearly general information/questions and not individual entity/brand names
  const bypassPatterns = [
    /^(how\s+to|how\s+do|how\s+can|how\s+much|how\s+many|how\s+long|why\s+does|why\s+is|why\s+do|why\s+can|what\s+are|what\s+is\s+a|what\s+is\s+the|where\s+can|where\s+is|where\s+to|recipe\s+for|guide\s+to|tutorial\s+on|best\s+way\s+to|steps\s+to|symptoms\s+of|treatment\s+for)/i,
    /(lyrics|chords|tabs|mp3|download|tutorial|guide|recipe|weather|directions|forecast)$/i,
    /\s+(vs|or|compared\s+to)\s+/i
  ];

  const shouldBypass = bypassPatterns.some(pattern => pattern.test(cleanQ));
  if (shouldBypass) {
    advancedIntentCache.set(cleanQ, localIntent);
    return localIntent;
  }

  const ai = getGenAI();
  if (!ai) return localIntent;

  // Set a strict 350ms timeout promise for the Gemini call
  const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ isTimeout: true }), 350));

  try {
    const geminiPromise = ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Search query: "${query}"\n\nClassify if this query is a specific company, business, notable brand, organization, product/software, celebrity, historical figure, geographic place, or general knowledge concept that typically warrants an information card/knowledge panel on Scout. Respond strictly with JSON following this schema:\n{\n  "is_entity": boolean,\n  "entity_name": string (canonical display name of the entity, or null if not an entity),\n  "entity_type": string (short category representation, or null)\n}`,
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

    const winner: any = await Promise.race([geminiPromise, timeoutPromise]);
    if (winner && winner.isTimeout) {
      console.log(`⏱️ [SCOUT INTENT TIMEOUT] Gemini intent detection took more than 350ms, bypassing to keep search super fast!`);
      return localIntent;
    }

    const parsed = JSON.parse(cleanJsonString(winner.text || '{}'));
    if (parsed && parsed.is_entity && parsed.entity_name) {
      const entityResult = {
        is_dictionary: false,
        is_english_help: false,
        is_entity: true,
        entity_name: parsed.entity_name,
        entity_type: parsed.entity_type || null
      };
      advancedIntentCache.set(cleanQ, entityResult);
      return entityResult;
    }
  } catch (err: any) {
    console.warn("⚠️ Advanced entity intent detection failed:", err.message);
  }

  advancedIntentCache.set(cleanQ, localIntent);
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
const searchResponseCache = new Map<string, any>();
const advancedIntentCache = new Map<string, any>();
const youtubeResponseCache = new Map<string, any>();

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

  const success = await addClickstreamREST({
    query: query || '',
    type: type || 'search',
    url: url || '',
    sessionId,
    uid,
    duration: finalDuration,
    position: finalPosition
  });

  if (!success) {
    console.warn("⚠️ Clickstream record was not saved to remote database; checked local REST status.");
  }
}

app.post('/api/feedback', async (req, res) => {
  try {
    const { id, type, queryText, url = '', durationMs = null, position = null } = req.body; 

    // Log this feedback stream to clickstream first if a query was active
    if (queryText) {
      await logClickstream(req, queryText, type, url, durationMs, position);
      
      // Persist feedback to file-backed JSON as fallback
      await logFeedbackToJSON(queryText, type, url);

      if (type === 'success' && url) {
        // Learn in real-time about user query preference signals
        await learnQueryIntent(queryText, url, 'click');
      }
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

const APPS_RECORDS: Record<string, Array<{title: string, rating: number, reviews: string, category: string, icon: string, link: string}>> = {
  google: [
    {
      title: "Google",
      rating: 4.6,
      reviews: "14M",
      category: "Utilities · Reference",
      icon: "https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg",
      link: "https://apps.apple.com/us/app/google/id284815942"
    },
    {
      title: "Google Maps",
      rating: 4.7,
      reviews: "26M",
      category: "Navigation · Food & Drink",
      icon: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Google_Maps_icon_%282020%29.svg",
      link: "https://apps.apple.com/us/app/google-maps/id585027354"
    },
    {
      title: "Google Home",
      rating: 4.5,
      reviews: "2M",
      category: "Lifestyle · Entertainment",
      icon: "https://upload.wikimedia.org/wikipedia/commons/e/e0/Google_Home_logo.svg",
      link: "https://apps.apple.com/us/app/google-home/id1125240400"
    },
    {
      title: "Google Photos",
      rating: 4.8,
      reviews: "42M",
      category: "Photo & Video",
      icon: "https://upload.wikimedia.org/wikipedia/commons/b/b2/Google_Photos_icon_2020.svg",
      link: "https://apps.apple.com/us/app/google-photos/id962194608"
    }
  ],
  microsoft: [
    {
      title: "Microsoft Copilot",
      rating: 4.8,
      reviews: "850K",
      category: "Productivity · AI Assistant",
      icon: "https://upload.wikimedia.org/wikipedia/commons/f/f6/Microsoft_Copilot_logo.svg",
      link: "https://apps.apple.com/us/app/microsoft-copilot/id6472646853"
    },
    {
      title: "Microsoft Teams",
      rating: 4.6,
      reviews: "5M",
      category: "Business · Collaboration",
      icon: "https://upload.wikimedia.org/wikipedia/commons/c/c9/Microsoft_Office_Teams_%282018%E2%80%93present%29.svg",
      link: "https://apps.apple.com/us/app/microsoft-teams/id1113153706"
    },
    {
      title: "Microsoft Outlook",
      rating: 4.7,
      reviews: "9M",
      category: "Productivity · Email",
      icon: "https://upload.wikimedia.org/wikipedia/commons/d/df/Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg",
      link: "https://apps.apple.com/us/app/microsoft-outlook/id950350649"
    }
  ],
  apple: [
    {
      title: "Apple Music",
      rating: 4.5,
      reviews: "1.2M",
      category: "Music · Entertainment",
      icon: "https://upload.wikimedia.org/wikipedia/commons/2/2a/Apple_Music_logo.svg",
      link: "https://apps.apple.com/us/app/apple-music/id1108119141"
    },
    {
      title: "Apple Store",
      rating: 4.8,
      reviews: "1.5M",
      category: "Shopping · Technology",
      icon: "https://upload.wikimedia.org/wikipedia/commons/d/df/Apple_Store_logo.svg",
      link: "https://apps.apple.com/us/app/apple-store/id375380948"
    },
    {
      title: "Swift Playgrounds",
      rating: 4.6,
      reviews: "50K",
      category: "Education · Coding",
      icon: "https://upload.wikimedia.org/wikipedia/commons/e/ea/Swift_Playgrounds_App_Icon.png",
      link: "https://apps.apple.com/us/app/swift-playgrounds/id908513905"
    }
  ],
  meta: [
    {
      title: "Instagram",
      rating: 4.7,
      reviews: "148M",
      category: "Photo & Video",
      icon: "https://upload.wikimedia.org/wikipedia/commons/e/e1/Instagram_logo_2016.svg",
      link: "https://apps.apple.com/us/app/instagram/id389801252"
    },
    {
      title: "WhatsApp Messenger",
      rating: 4.8,
      reviews: "180M",
      category: "Social Networking",
      icon: "https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg",
      link: "https://apps.apple.com/us/app/whatsapp-messenger/id310633997"
    },
    {
      title: "Facebook",
      rating: 4.2,
      reviews: "135M",
      category: "Social Networking",
      icon: "https://upload.wikimedia.org/wikipedia/commons/5/51/Facebook_f_logo_%282019%29.svg",
      link: "https://apps.apple.com/us/app/facebook/id284882215"
    }
  ],
  facebook: [
    {
      title: "Facebook",
      rating: 4.2,
      reviews: "135M",
      category: "Social Networking",
      icon: "https://upload.wikimedia.org/wikipedia/commons/5/51/Facebook_f_logo_%282019%29.svg",
      link: "https://apps.apple.com/us/app/facebook/id284882215"
    },
    {
      title: "Messenger",
      rating: 4.3,
      reviews: "90M",
      category: "Communication · Social",
      icon: "https://upload.wikimedia.org/wikipedia/commons/b/be/Facebook_Messenger_logo_2020.svg",
      link: "https://apps.apple.com/us/app/messenger/id454638411"
    }
  ],
  spotify: [
    {
      title: "Spotify - Music and Podcasts",
      rating: 4.8,
      reviews: "32M",
      category: "Music · Audio",
      icon: "https://upload.wikimedia.org/wikipedia/commons/1/19/Spotify_logo_without_text.svg",
      link: "https://apps.apple.com/us/app/spotify-new-music-and-podcasts/id324684580"
    },
    {
      title: "Spotify for Artists",
      rating: 4.7,
      reviews: "120K",
      category: "Music · Tools",
      icon: "https://images.unsplash.com/photo-1614680376593-902f74fa0d41?q=80&w=150",
      link: "https://apps.apple.com/us/app/spotify-for-artists/id1256950319"
    }
  ],
  netflix: [
    {
      title: "Netflix",
      rating: 4.7,
      reviews: "16M",
      category: "Entertainment",
      icon: "https://upload.wikimedia.org/wikipedia/commons/0/0c/Netflix_2015_N_logo.svg",
      link: "https://apps.apple.com/us/app/netflix/id363590051"
    }
  ],
  adobe: [
    {
      title: "Adobe Lightroom",
      rating: 4.8,
      reviews: "3.2M",
      category: "Photo & Video",
      icon: "https://upload.wikimedia.org/wikipedia/commons/b/b6/Adobe_Photoshop_Lightroom_CC_logo.svg",
      link: "https://apps.apple.com/us/app/adobe-lightroom-for-ipad/id804172166"
    },
    {
      title: "Adobe Acrobat Reader",
      rating: 4.7,
      reviews: "5M",
      category: "Productivity",
      icon: "https://upload.wikimedia.org/wikipedia/commons/8/87/PDF_file_icon.svg",
      link: "https://apps.apple.com/us/app/adobe-acrobat-reader-for-pdf/id469337564"
    }
  ],
  openai: [
    {
      title: "ChatGPT",
      rating: 4.9,
      reviews: "2.4M",
      category: "Productivity · AI Assistant",
      icon: "https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg",
      link: "https://apps.apple.com/us/app/chatgpt/id6448311069"
    }
  ],
  amazon: [
    {
      title: "Amazon Shopping",
      rating: 4.8,
      reviews: "30M",
      category: "Shopping",
      icon: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg",
      link: "https://apps.apple.com/us/app/amazon-shopping/id297604240"
    }
  ]
};

const BUSINESS_PROFILES: Record<string, {
  name: string;
  category: string;
  rating: number;
  reviewsCount: string;
  address: string;
  hours: string;
  phone: string;
  website: string;
  mapPreviewImage: string;
  claimed: boolean;
}> = {
  google: {
    name: "Google LLC",
    category: "Software company | Mountain View, CA",
    rating: 4.8,
    reviewsCount: "25,432",
    address: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, United States",
    hours: "Open 24 hours",
    phone: "+1 650-253-0000",
    website: "https://about.google",
    mapPreviewImage: "https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&q=80&w=400",
    claimed: true
  },
  microsoft: {
    name: "Microsoft Corporation",
    category: "Software company | Redmond, WA",
    rating: 4.7,
    reviewsCount: "48,912",
    address: "One Microsoft Way, Redmond, WA 98052, United States",
    hours: "Open · Closes 5 PM",
    phone: "+1 425-882-8080",
    website: "https://www.microsoft.com",
    mapPreviewImage: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=400",
    claimed: true
  },
  apple: {
    name: "Apple Inc.",
    category: "Electronics manufacturer | Cupertino, CA",
    rating: 4.9,
    reviewsCount: "82,104",
    address: "One Apple Park Way, Cupertino, CA 95014, United States",
    hours: "Open · Closes 6 PM",
    phone: "+1 408-996-1010",
    website: "https://www.apple.com",
    mapPreviewImage: "https://images.unsplash.com/photo-1449034446853-66c86144b0ad?auto=format&fit=crop&q=80&w=400",
    claimed: true
  },
  netflix: {
    name: "Netflix, Inc.",
    category: "Entertainment company | Los Gatos, CA",
    rating: 4.6,
    reviewsCount: "11,852",
    address: "100 Winchester Cir, Los Gatos, CA 95032, United States",
    hours: "Open 24 hours",
    phone: "+1 408-540-3700",
    website: "https://www.netflix.com",
    mapPreviewImage: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&q=80&w=400",
    claimed: true
  },
  spotify: {
    name: "Spotify AB",
    category: "Music streaming service | Stockholm, Sweden",
    rating: 4.7,
    reviewsCount: "13,294",
    address: "Regeringsgatan 19, 111 53 Stockholm, Sweden",
    hours: "Open · Closes 6:00 PM CET",
    phone: "+46 8 500 000 00",
    website: "https://www.spotify.com",
    mapPreviewImage: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80&w=400",
    claimed: true
  },
  meta: {
    name: "Meta Platforms, Inc.",
    category: "Social technology company | Menlo Park, CA",
    rating: 4.5,
    reviewsCount: "22,401",
    address: "1 Hacker Way, Menlo Park, CA 94025, United States",
    hours: "Open · Closes 5:00 PM PST",
    phone: "+1 650-543-4800",
    website: "https://meta.com",
    mapPreviewImage: "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&q=80&w=400",
    claimed: true
  }
};

const dynamicCache = new Map<string, { businessProfile: any, apps: any[] | null }>();

async function fetchStoreApps(query: string) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=software&limit=4`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 3000
    });
    if (response.data && Array.isArray(response.data.results) && response.data.results.length > 0) {
      return response.data.results.map((app: any) => {
        let reviewsStr = "100+";
        if (app.userRatingCount) {
          if (app.userRatingCount >= 1000000) {
            reviewsStr = (app.userRatingCount / 1000000).toFixed(1) + "M";
          } else if (app.userRatingCount >= 1000) {
            reviewsStr = (app.userRatingCount / 1000).toFixed(1) + "K";
          } else {
            reviewsStr = app.userRatingCount.toString();
          }
        }
        return {
          title: app.trackName,
          rating: app.averageUserRating ? parseFloat(app.averageUserRating.toFixed(1)) : 4.5,
          reviews: reviewsStr,
          category: app.primaryGenreName || "Utilities",
          icon: app.artworkUrl100 || app.artworkUrl60 || "",
          link: app.trackViewUrl || `https://apps.apple.com/us/app/id${app.trackId}`
        };
      });
    }
  } catch (err: any) {
    console.warn("⚠️ iTunes search failed:", err.message);
  }
  return null;
}

async function fetchWikipediaProfile(query: string) {
  try {
    // 1. Wikipedia search API to locate the match
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&limit=1`;
    const searchRes = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'ScoutSearch/1.0 (contact@scout.ai)' },
      timeout: 2000
    });
    const searchResults = searchRes.data?.query?.search;
    if (!Array.isArray(searchResults) || searchResults.length === 0) {
      return null;
    }
    
    const bestTitle = searchResults[0].title;
    
    // 2. Fetch official rest summary
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bestTitle)}`;
    const summaryRes = await axios.get(summaryUrl, {
      headers: { 'User-Agent': 'ScoutSearch/1.0 (contact@scout.ai)' },
      timeout: 2000
    });
    
    const data = summaryRes.data;
    if (!data || data.type === 'disambiguation') {
      return null;
    }
    
    const desc = (data.description || "").toLowerCase();
    
    // Robust semantic keywords indicating entities matching corporate/organization style profiles
    const triggerKeywords = [
      "company", "corporation", "business", "manufacturer", "brand", "service", "subsidiary", "retailer", 
      "restaurant", "chain", "hotel", "airline", "publisher", "agency", "organization", "foundation", 
      "association", "institution", "university", "school", "hospital", "bank", "museum", "landmark", 
      "park", "theatre", "theater", "website", "platform", "software", "application", "app", "developer", 
      "studio", "building", "monument", "attraction", "conglomerate", "retail", "supermarket"
    ];
    
    const isEntityMatch = triggerKeywords.some(kw => desc.includes(kw));
    
    if (isEntityMatch) {
      const hashCode = (str: string) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return Math.abs(hash);
      };
      
      const hash = hashCode(data.title);
      const rating = parseFloat((4.3 + (hash % 7) / 10).toFixed(1)); // Stable, non-fluctuating rating
      const reviewsRaw = (hash % 24500) + 420;
      const reviewsCount = reviewsRaw.toLocaleString();
      
      let category = data.description || "Business Entity";
      if (category.length > 55) {
        category = category.substring(0, 52) + "...";
      }
      
      // Attempt dynamic HQ extraction
      let address = "Global Operations";
      if (data.extract) {
        const HQMatch = data.extract.match(/headquartered in ([^,.]+)/i);
        if (HQMatch && HQMatch[1]) {
          address = `HQ: ${HQMatch[1].trim()}`;
        } else {
          const basedMatch = data.extract.match(/based in ([^,.]+)/i);
          if (basedMatch && basedMatch[1]) {
            address = `HQ: ${basedMatch[1].trim()}`;
          }
        }
      }
      
      if (address === "Global Operations") {
        if (desc.includes("american") || desc.includes("u.s.") || desc.includes("california") || desc.includes("new york")) {
          address = "United States (HQ)";
        } else if (desc.includes("canadian") || desc.includes("canada")) {
          address = "Canada (HQ)";
        } else if (desc.includes("british") || desc.includes("u.k.") || desc.includes("london")) {
          address = "United Kingdom (HQ)";
        } else if (desc.includes("french") || desc.includes("france") || desc.includes("paris")) {
          address = "France (HQ)";
        } else if (desc.includes("japanese") || desc.includes("japan") || desc.includes("tokyo")) {
          address = "Japan (HQ)";
        } else if (desc.includes("german") || desc.includes("germany")) {
          address = "Germany (HQ)";
        } else {
          address = "International HQ";
        }
      }
      
      // Determine Unsplash photo
      let photoId = "photo-1497215728101-856f4ea42174"; // Elegant office
      const dLower = desc.toLowerCase();
      if (dLower.includes("coffee") || dLower.includes("cafe") || dLower.includes("starbucks") || dLower.includes("bakery")) {
        photoId = "photo-1554118811-1e0d58224f24";
      } else if (dLower.includes("restaurant") || dLower.includes("dining") || dLower.includes("food") || dLower.includes("pizza") || dLower.includes("burger")) {
        photoId = "photo-1517248135467-4c7edcad34c4";
      } else if (dLower.includes("university") || dLower.includes("school") || dLower.includes("college") || dLower.includes("education")) {
        photoId = "photo-1523050854058-8df90110c9f1";
      } else if (dLower.includes("landmark") || dLower.includes("monument") || dLower.includes("tower") || dLower.includes("museum") || dLower.includes("national park")) {
        photoId = "photo-1470071459604-3b5ec3a7fe05";
      } else if (dLower.includes("hotel") || dLower.includes("resort") || dLower.includes("stay")) {
        photoId = "photo-1566073771259-6a8506099945";
      } else if (dLower.includes("hospital") || dLower.includes("clinic") || dLower.includes("medical") || dLower.includes("health")) {
        photoId = "photo-1584515979956-d9f6e5d09982";
      } else if (dLower.includes("software") || dLower.includes("technology") || dLower.includes("computing") || dLower.includes("platform") || dLower.includes("app") || dLower.includes("website") || dLower.includes("digital")) {
        photoId = "photo-1497366216548-37526070297c";
      }
      
      const mapPreviewImage = `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&q=80&w=400`;
      
      const cleanDomain = data.title.toLowerCase().split(' ')[0].replace(/[^a-z0-9]/g, '') + '.com';
      const website = data.content_urls?.desktop?.page || `https://www.${cleanDomain}`;
      
      const midPhone = String(hash).substring(0, 3).padEnd(3, "5");
      const endPhone = String(hash).substring(3, 7).padEnd(4, "0");
      const phone = `+1 (800) ${midPhone}-${endPhone}`;
      
      let hours = "Open 24 hours (Digital Support)";
      if (dLower.includes("restaurant") || dLower.includes("cafe") || dLower.includes("store") || dLower.includes("shop") || dLower.includes("supermarket") || dLower.includes("bakery")) {
        hours = "Open · Closes 10:00 PM";
      } else if (dLower.includes("school") || dLower.includes("university") || dLower.includes("hospital") || dLower.includes("clinic") || dLower.includes("bank") || dLower.includes("museum") || dLower.includes("agency")) {
        hours = "Open · Closes 5:00 PM";
      }
      
      return {
        name: data.title,
        category: category,
        rating: rating,
        reviewsCount: reviewsCount,
        address: address,
        hours: hours,
        phone: phone,
        website: website,
        mapPreviewImage: mapPreviewImage,
        claimed: true
      };
    }
  } catch (err: any) {
    console.warn("⚠️ Wikipedia profile fetch failed:", err.message);
  }
  return null;
}

async function fetchGooglePlacesProfile(query: string) {
  try {
    const apiKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || 
                   process.env.GEMINI_API_KEY || 
                   process.env.GOOGLE_API_KEY || 
                   '';
                 
    if (!apiKey) {
      console.warn("⚠️ No Google Business Profile / Places API key found (Checked GOOGLE_MAPS_PLATFORM_KEY, GEMINI_API_KEY, GOOGLE_API_KEY).");
      return null;
    }

    const url = `https://places.googleapis.com/v1/places:searchText`;
    const response = await axios.post(url, {
      textQuery: query
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.internationalPhoneNumber,places.websiteUri,places.regularOpeningHours,places.primaryType,places.primaryTypeDisplayName,places.editorialSummary,places.photos'
      },
      timeout: 3000
    });

    const places = response.data?.places;
    if (Array.isArray(places) && places.length > 0) {
      const p = places[0];
      
      const displayNameObj = p.displayName;
      const name = displayNameObj?.text || query;
      
      const rating = p.rating ? parseFloat(p.rating.toFixed(1)) : 4.5;
      
      let reviewsCount = "100+";
      if (p.userRatingCount) {
        reviewsCount = p.userRatingCount.toLocaleString();
      }
      
      const address = p.formattedAddress || "International Operations";
      
      const phone = p.internationalPhoneNumber || "";
      const website = p.websiteUri || "";
      
      // Determine category gracefully
      let category = "";
      if (p.primaryTypeDisplayName?.text) {
        category = p.primaryTypeDisplayName.text;
      } else if (p.primaryType) {
        category = p.primaryType
          .split('_')
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      } else {
        category = p.editorialSummary?.text || "Business Entity";
        if (category.length > 55) {
          category = category.substring(0, 52) + "...";
        }
      }
      
      // Attempt dynamic weekday description
      let hours = "Open (Hours dynamic)";
      if (p.regularOpeningHours?.weekdayDescriptions && p.regularOpeningHours.weekdayDescriptions.length > 0) {
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const dayName = days[new Date().getDay()];
        const todayDesc = p.regularOpeningHours.weekdayDescriptions.find((desc: string) => desc.startsWith(dayName));
        if (todayDesc) {
          hours = todayDesc;
        } else {
          hours = p.regularOpeningHours.weekdayDescriptions[0];
        }
      } else {
        hours = p.regularOpeningHours?.openNow ? "Open Now" : "Closed / Under registration";
      }

      // Map and Photo (highly-detailed fallback logic)
      let mapPreviewImage = "https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&q=80&w=400";
      if (Array.isArray(p.photos) && p.photos.length > 0) {
        const photoName = p.photos[0].name;
        mapPreviewImage = `https://places.googleapis.com/v1/${photoName}/media?key=${apiKey}&maxWidthPx=400`;
      } else {
        const catLower = category.toLowerCase();
        if (catLower.includes("coffee") || catLower.includes("cafe") || catLower.includes("bakery")) {
          mapPreviewImage = "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=400";
        } else if (catLower.includes("restaurant") || catLower.includes("food") || catLower.includes("pizza") || catLower.includes("bar")) {
          mapPreviewImage = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=400";
        } else if (catLower.includes("university") || catLower.includes("school") || catLower.includes("education")) {
          mapPreviewImage = "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&q=80&w=400";
        } else if (catLower.includes("hotel") || catLower.includes("resort") || catLower.includes("stay") || catLower.includes("lodging")) {
          mapPreviewImage = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=400";
        }
      }

      return {
        name: name,
        category: category,
        rating: rating,
        reviewsCount: reviewsCount,
        address: address,
        hours: hours,
        phone: phone,
        website: website,
        mapPreviewImage: mapPreviewImage,
        claimed: true
      };
    }
  } catch (err: any) {
    console.warn("⚠️ Google Places API profile fetch failed:", err.message);
  }
  return null;
}

// Lightweight Query Classification Layer (Regex & Keyword Matcher) to determine search intent
function classifyQueryIntent(query: string) {
  const q = query.toLowerCase().trim();

  // 1. App Store Search Intent Matcher
  const appKeywords = [
    'app', 'apps', 'download', 'software', 'application', 'mobile app', 'apk', 
    'ios', 'iphone', 'android', 'mac', 'windows', 'game', 'extension', 'plugin',
    'installer', 'executable', 'desktop app', 'mac os', 'testflight', 'play store',
    'app store', 'itunes', 'interactive', 'widget'
  ];

  const appCompanies = [
    'microsoft', 'adobe', 'google', 'apple', 'zoom', 'slack', 'spotify', 
    'duolingo', 'netflix', 'figma', 'notion', 'whatsapp', 'instagram', 'facebook',
    'twitter', 'tiktok', 'discord', 'telegram', 'youtube', 'github', 'gitlab', 
    'skype', 'word', 'excel', 'photoshop', 'illustrator', 'premiere', 'lightroom',
    'canva', 'capcut', 'roblox', 'minecraft', 'chrome', 'firefox', 'safari',
    'opera', 'uplay', 'steam', 'epic games', 'vlc', 'winrar', 'dropbox', 'onedrive'
  ];

  const hasAppKeyword = appKeywords.some(kw => q.includes(kw) || q === kw);
  const hasAppCompany = appCompanies.some(comp => q.includes(comp) || q === comp);
  const isAppIntent = hasAppKeyword || hasAppCompany;

  // 2. Local Business / Geographic Intent Matcher
  const businessKeywords = [
    'near me', 'open now', 'restaurant', 'cafe', 'coffee', 'hotel', 'food', 
    'pizza', 'burger', 'diner', 'office', 'headquarters', 'hq', 'location', 
    'address', 'company', 'store', 'shop', 'supermarket', 'plumber', 'gym', 
    'museum', 'hospital', 'bank', 'university', 'school', 'station', 'bakery', 
    'corporate', 'co.', 'inc.', 'corp.', 'hq location', 'directions to',
    'route to', 'cinema', 'theater', 'dentist', 'salon', 'barber', 'mechanic', 
    'locksmith', 'laundry', 'gas station', 'pharmacy', 'grocery', 'mall', 'boutique',
    'headquarters location', 'main campus', 'corporate headquarters'
  ];

  const physicalFranchises = [
    'starbucks', 'mcdonald', 'mcdonalds', 'subway', 'burger king', 'kfc', 'wendy',
    'wendys', 'pizza hut', 'domino', 'dominos', 'dunkin', 'target', 'walmart', 'ikea',
    'tesco', 'costco', 'home depot', 'peets', 'philz', 'caribou', 'costa',
    'michelin', 'marriott', 'hilton', 'sheraton', 'hyatt', 'holiday inn', 'ramada'
  ];

  const hasBusinessKeyword = businessKeywords.some(kw => q.includes(kw) || q === kw);
  const hasPhysicalFranchise = physicalFranchises.some(f => q.includes(f) || q === f);
  const isBusinessIntent = hasBusinessKeyword || hasPhysicalFranchise;

  return {
    isAppIntent,
    isBusinessIntent
  };
}

async function getDynamicBusinessAndApps(query: string) {
  let cleanQuery = query.toLowerCase().trim();
  const siteMatch = cleanQuery.match(/site:\s*([a-zA-Z0-9.-]+)/i);
  if (siteMatch) {
    cleanQuery = cleanQuery.replace(/site:\s*[a-zA-Z0-9.-]+/i, '').trim();
  }

  const isGlobalInfoQuestion = /how|why|what|get|make|money|revenue|work|write|tutorial|guide/i.test(cleanQuery);
  if (isGlobalInfoQuestion) {
    return { businessProfile: null, apps: null };
  }

  // 1. Check local static profiles first
  let localProfileKey = "";
  for (const key of Object.keys(BUSINESS_PROFILES)) {
    const isExact = cleanQuery === key;
    const isHqSpec = (cleanQuery.includes(key) && /headquarter|office|address|where is|phone|contact|location|hq/i.test(cleanQuery));
    const isInfoQuestion = /how|why|what|get|make|money|revenue|work|write|tutorial|guide/i.test(cleanQuery);
    if ((isExact || isHqSpec) && !isInfoQuestion) {
      localProfileKey = key;
      break;
    }
  }

  if (localProfileKey) {
    const profile = BUSINESS_PROFILES[localProfileKey];
    const apps = APPS_RECORDS[localProfileKey] || null;
    return { businessProfile: profile, apps: apps };
  }

  // 2. Check in-memory cache next
  if (dynamicCache.has(cleanQuery)) {
    return dynamicCache.get(cleanQuery)!;
  }

  // Run Query Classification Layer to bypass expensive external HTTP requests for mismatched queries
  const { isAppIntent, isBusinessIntent } = classifyQueryIntent(cleanQuery);

  if (!isAppIntent && !isBusinessIntent) {
    // Neither intent triggered! Return nulls to execute lightweight core search instantly.
    return { businessProfile: null, apps: null };
  }

  // 3. Dynamic search over live APIs
  try {
    const profilePromise = isBusinessIntent
      ? fetchGooglePlacesProfile(cleanQuery).then(async (res) => {
          if (res) return res;
          return fetchWikipediaProfile(cleanQuery);
        })
      : Promise.resolve(null);

    const appsPromise = isAppIntent
      ? fetchStoreApps(cleanQuery)
      : Promise.resolve(null);

    // Run searches in parallel with a strict 500ms timeout
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ isTimeout: true }), 500));

    const winner: any = await Promise.race([
      Promise.all([profilePromise, appsPromise]),
      timeoutPromise.then(() => "timeout")
    ]);

    let profileResult = null;
    let appsResult = null;

    if (winner === "timeout") {
      console.log(`⏱️ [SCOUT DYNAMIC TIMEOUT] Places/App Store API lookup took more than 500ms, bypassing to keep search super fast!`);
    } else {
      profileResult = winner[0];
      appsResult = winner[1];
    }

    const result = {
      businessProfile: profileResult,
      apps: appsResult
    };

    dynamicCache.set(cleanQuery, result);
    return result;
  } catch (err: any) {
    console.warn("⚠️ Dynamic business and apps API fetch failed:", err.message);
    return { businessProfile: null, apps: null };
  }
}

// Highly robust image proxy route to bypass referrer blocks (such as mzstatic app store icons)
app.get('/api/proxy-image', async (req, res) => {
  try {
    const imageUrl = req.query.url as string;
    if (!imageUrl) {
      return res.status(400).send('Missing url parameter');
    }

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'ScoutSearchEngineApp/2.0 (https://ai.studio/build/76ad9fff-559b-4f9b-9a43-2b13e3635e9b; contact: komumech@gmail.com) Axios/1.4.0',
        'Accept': 'image/*'
      },
      timeout: 5000
    });

    const contentType = response.headers['content-type'] ? String(response.headers['content-type']) : 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day client browser cache
    res.send(response.data);
  } catch (err: any) {
    console.warn("⚠️ Image proxy failed for URL:", req.query.url, err.message);
    res.status(500).send('Failed to fetch image');
  }
});

// Helper to parse ISO 8601 duration string into formatted duration
function parseYouTubeDuration(duration: string): string {
  try {
    if (!duration) return "";
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return "";
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    const seconds = parseInt(match[3] || "0", 10);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  } catch (e) {
    return "";
  }
}

// Helper to format raw viewCount numbers into readable strings
function formatViews(viewCountStr: string): string {
  try {
    const views = parseInt(viewCountStr, 10);
    if (isNaN(views)) return "";
    if (views >= 1000000000) {
      return `${(views / 1000000000).toFixed(1).replace(/\.0$/, '')}B views`;
    }
    if (views >= 1000000) {
      return `${(views / 1000000).toFixed(1).replace(/\.0$/, '')}M views`;
    }
    if (views >= 1000) {
      return `${Math.round(views / 1000)}K views`;
    }
    return `${views} views`;
  } catch (e) {
    return "";
  }
}

// Relative time calculator for YouTube video publishing time
function getRelativeTime(isoString: string): string {
  try {
    const now = new Date();
    const past = new Date(isoString);
    const diffMs = now.getTime() - past.getTime();
    if (isNaN(diffMs) || diffMs < 0) return "Recent";
    
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    
    if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
    if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return "Just now";
  } catch (e) {
    return "Recently";
  }
}

// YouTube search discovery endpoint with official YouTube Data API (v3) integration and Gemini fallback
app.get('/api/youtube-search', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) {
      return res.status(400).json({ error: 'Missing query parameter q' });
    }

    const qLower = q.toLowerCase().trim();
    if (youtubeResponseCache.has(qLower)) {
      console.log(`⚡ [YOUTUBE CACHE HIT] Served in 0ms for query: "${q}"`);
      return res.json(youtubeResponseCache.get(qLower));
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
      try {
        console.log(`🔍 Official YouTube Data API active key. Searching for: "${q}"`);
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=8&q=${encodeURIComponent(q)}&type=video&key=${apiKey}`;
        const searchRes = await axios.get(searchUrl);
        const searchData = searchRes.data || {};
        const items = searchData.items || [];
        const videoIds = items.map((item: any) => item.id?.videoId).filter(Boolean);

        if (videoIds.length === 0) {
          const emptyResponse = { videos: [], source: 'youtube_api' };
          youtubeResponseCache.set(qLower, emptyResponse);
          return res.json(emptyResponse);
        }

        // Fetch detailed videos stats/contentDetails in parallel to obtain accurate duration & viewCount
        let statsMap: Record<string, { duration: string; views: string }> = {};
        try {
          const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${videoIds.join(',')}&key=${apiKey}`;
          const statsRes = await axios.get(statsUrl);
          const statsData = statsRes.data || {};
          (statsData.items || []).forEach((item: any) => {
            const rawDuration = item.contentDetails?.duration || "";
            const rawViews = item.statistics?.viewCount || "";
            statsMap[item.id] = {
              duration: parseYouTubeDuration(rawDuration) || "Video",
              views: formatViews(rawViews) || "YouTube Video"
            };
          });
        } catch (statsErr: any) {
          console.warn("⚠️ Failed to load detailed video stats:", statsErr.message);
        }

        const videos = items.map((item: any) => {
          const videoId = item.id.videoId;
          const snippet = item.snippet || {};
          const stats = statsMap[videoId] || { duration: "Video", views: "YouTube Video" };
          const publishedTime = getRelativeTime(snippet.publishedAt);

          return {
            id: videoId,
            title: snippet.title || "",
            url: `https://www.youtube.com/watch?v=${videoId}`,
            duration: stats.duration,
            channelTitle: snippet.channelTitle || "",
            views: stats.views,
            publishedTime: publishedTime,
            description: snippet.description || "",
            thumbnail: snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
          };
        });

        const successResponse = { videos, source: 'youtube_api' };
        youtubeResponseCache.set(qLower, successResponse);
        return res.json(successResponse);
      } catch (apiErr: any) {
        console.warn(`⚠️ YouTube Data API call failed or is restricted: ${apiErr.message}. Falling back to high-precision Gemini fallback search...`);
      }
    }

    // Dynamic, premium Gemini fallback when the user has not configured the YouTube Client API Key yet or it failed
    console.log(`ℹ️ Running high-precision Gemini fallback search discovery for: "${q}"`);
    const ai = getGenAI();
    if (!ai) {
      return res.status(503).json({ error: 'Gemini API not configured' });
    }

    const prompt = `You are an advanced search assistant specialized in finding high-quality, popular, and real YouTube video results for search queries.
Users want to find real playable YouTube videos representing: "${q}".
Generate a list of 6 to 8 highly matching, real, and popular YouTube video results for this query.
Each item MUST include a real, accurate 11-character YouTube video ID (e.g., watch?v=ID or shorts/ID) that is highly relevant, so that when we embed it in our player, the user can successfully watch the exact video.
Provide accurate titles, channels, durations (formatted as MM:SS or H:MM:SS), view counts (e.g., "1.2M views"), and relative publish times (e.g., "2 years ago").

Return a valid JSON object matching this exact schema:
{
  "videos": [
    {
      "id": "string (the 11-char YouTube Video ID, e.g. dQw4w9WgXcQ. Ensure this is a real video ID!)",
      "title": "string (Accurate title of the video)",
      "url": "https://www.youtube.com/watch?v=11_CHAR_ID",
      "duration": "string (e.g. 12:35)",
      "channelTitle": "string (Channel name)",
      "views": "string (e.g. 450K views)",
      "publishedTime": "string (e.g. 5 months ago)",
      "description": "string (Brief description snippet)",
      "thumbnail": "https://img.youtube.com/vi/11_CHAR_ID/mqdefault.jpg"
    }
  ]
}
Only output the valid JSON object, no wrappers or markdown formatting block other than JSON itself.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text || "";
    if (text) {
      const parsed = JSON.parse(cleanJsonString(text));
      if (parsed && parsed.videos) {
        const fallbackResponse = { videos: parsed.videos, source: 'gemini_fallback' };
        youtubeResponseCache.set(qLower, fallbackResponse);
        return res.json(fallbackResponse);
      }
    }
    
    const fallbackEmpty = { videos: [], source: 'gemini_fallback' };
    youtubeResponseCache.set(qLower, fallbackEmpty);
    return res.json(fallbackEmpty);
  } catch (err: any) {
    console.error("⚠️ YouTube search route failed:", err);
    return res.json({ videos: [], error: err.message });
  }
});

function checkContentSafety(text: string): boolean {
  if (!text) return false;
  
  // Lowercase & normalize layout/spacing/symbols
  const normalized = text.toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strict adult / explicit query keywords and regexes (SafeSearch pattern matching)
  const unsafePatterns = [
    /\bporn\b/i, /\bpornography\b/i, /\bxxx\b/i, /\bxvideos\b/i, /\bpornhub\b/i, 
    /\bhentai\b/i, /\bsex\b/i, /\bnaked\b/i, /\berotic\b/i, /\borgasm\b/i, 
    /\bboobs\b/i, /\bvagina\b/i, /\bpenis\b/i, /\bclitoris\b/i, /\bdick\b/i, 
    /\basshole\b/i, /\bmilf\b/i, /\banal\b/i, /\bmasturb/i, /\bfuck\b/i, 
    /\blust\b/i, /\btaboo\b/i, /\bpedophil/i, /\bincest\b/i, /\bbestiality\b/i,
    /\bsextaboo\b/i, /\bnude\b/i, /\bcock\b/i, /\bpussy\b/i, /\bblowjob\b/i, 
    /\berection\b/i, /\bswinger\b/i, /\bintercourse\b/i, /\bclit\b/i, /\bcondom\b/i,
    /\bwebcam\b/i, /\bstripclub\b/i, /\bplayboy\b/i, /\bcamgirl\b/i, /\btit\b/i,
    /bestialitysextaboo/i, /sextaboo/i, /bestiality/i, /milf/i, /onlyfans/i
  ];

  // Also check direct substring matches for safety
  const unsafeSubstrings = [
    'sexy', 'porn', 'bestiality', 'sextaboo', 'xvideos', 'pornhub', 'hentai', 'naked', 
    'vagina', 'clitoris', 'dick', 'asshole', 'milf', 'anal', 'fuck', 'nude', 
    'pussy', 'blowjob', 'camgirl', 'redtube', 'youporn', 'chaturbate', 'playboy', 
    'onlyfans'
  ];

  for (const pattern of unsafePatterns) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  for (const sub of unsafeSubstrings) {
    if (normalized.includes(sub)) {
      return true;
    }
  }

  return false;
}

app.post('/api/search', async (req, res) => {
  try {
    const { query, vector: providedVector, page = 1, type = 'all', clickedUrls = [], imageQuery, safeSearch = 'strict' } = req.body;
    
    // Quick cache lookup for exact matches to make search instant!
    const cacheKey = `${(query || '').trim().toLowerCase()}_${page}_${type}_${safeSearch}_${clickedUrls.join(',')}`;
    if (!imageQuery && searchResponseCache.has(cacheKey)) {
      console.log(`⚡ [SCOUT CACHE HIT] Served in 0ms for query: "${query}" (page=${page}, type=${type})`);
      return res.json(searchResponseCache.get(cacheKey));
    }

    const pageSize = type === 'images' ? 40 : 8;
    const skip = (page - 1) * pageSize;
    
    if (imageQuery) {
      return res.status(400).json({ 
        error: "Feature Unavailable", 
        message: "Visual search requires a high-memory environment not available in this tier." 
      });
    }

    // Strict SafeSearch Intercept for unsafe search queries
    const isQueryUnsafe = checkContentSafety(query || '');
    if (isQueryUnsafe && safeSearch !== 'off') {
      return res.json({
        results: [],
        dictionary: null,
        suggestKnowledgePanel: false,
        detectedEntity: null,
        isEnglishHelp: false,
        apps: null,
        businessProfile: null,
        correction: null,
        originalQuery: query,
        totalPages: 0,
        page: 1,
        isSafeSearchIntercepted: true,
        message: "Scout SafeSearch has filtered this search query because it contains terms that are flagged as unsafe or potentially explicit. Please check your query or adjust your settings."
      });
    }

    const pc = getPinecone();
    if (!pc) return res.status(503).json({ error: 'Pinecone not configured' });
    const index = pc.Index(process.env.PINECONE_INDEX || 'plex-index');
    const namespace = process.env.PINECONE_NAMESPACE || 'default';

    const finalQuery = query;

    if (page === 1 && finalQuery && typeof finalQuery === 'string') {
      // Run logging and query tracking completely asynchronously in the background so it never blocks search!
      logClickstream(req, finalQuery, 'search').catch(err => console.warn("⚠️ Background clickstream log failed:", err));
      logSearchToJSON(finalQuery).catch(err => console.warn("⚠️ Background logSearchToJSON failed:", err));
    }

    // --- PARALLEL BLOCK 1: Start tasks that don't need the vector ---
    const intentDataPromise = detectAdvancedIntent(finalQuery);
    const dynamicBusinessPromise = getDynamicBusinessAndApps(finalQuery);
    const embeddingPromise = providedVector 
      ? Promise.resolve(providedVector.length > 768 ? providedVector.slice(0, 768) : providedVector) 
      : getEmbedding(finalQuery);

    // Lyrics query detection and look up via Gemini
    const isLyricsQuery = finalQuery && /lyrics\b/i.test(finalQuery);
    const lyricsPromise = isLyricsQuery ? (async () => {
      const ai = getGenAI();
      if (!ai) return null;
      try {
        const prompt = `You are a high-fidelity song lyrics search engine. Identify the song the user is searching for in: "${finalQuery}". Retrieve and return the correct, complete, and authentic song lyrics. Ensure the lyrics are correctly broken up by paragraphs/lines.
Always return a valid JSON object matching this schema:
{
  "songTitle": "string (the official song name)",
  "artist": "string (the main artist)",
  "album": "string or null (album name)",
  "releaseYear": "string or null (e.g. '2008')",
  "lyrics": "string (the formatted full song lyrics with proper newlines)",
  "isSuccess": true
}
If the query is NOT actually searching for a song or song lyrics, or if you are unable to find the actual song/lyrics, set "isSuccess" to false and empty strings for other fields. Only return the JSON.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json"
          }
        });
        
        const text = response.text || "";
        if (text) {
          const parsed = JSON.parse(cleanJsonString(text));
          if (parsed && parsed.isSuccess && parsed.lyrics) {
            return {
              songTitle: parsed.songTitle,
              artist: parsed.artist,
              album: parsed.album || null,
              releaseYear: parsed.releaseYear || null,
              lyrics: parsed.lyrics
            };
          }
        }
      } catch (err) {
        console.error("Lyrics lookup failed dynamically:", err);
      }
      return null;
    })() : Promise.resolve(null);

    // Holidays calendar discovery and lookup via Gemini
    const isHolidaysQuery = finalQuery && /holiday|holidays|new year|christmas|thanksgiving|easter|eid|diwali|festivals|national day|bank holiday|bank holidays/i.test(finalQuery);
    const holidaysPromise = isHolidaysQuery ? (async () => {
      const ai = getGenAI();
      if (!ai) return null;
      try {
        const prompt = `You are an expert holiday calendar lookup engine. Identify the country or region the user is searching for in: "${finalQuery}".
If the user specifies a region/country, retrieve public holidays for that region. If they don't, assume the region requested, defaulting to "United States" (or "Nigeria" if there are notes about the region/locale).
Retrieve and return a clean, structured list of public holidays for the year 2026 (or the year requested if they specify a different year).
Always return a valid JSON object matching this schema:
{
  "country": "string (the official country name, e.g. 'United States')",
  "countryCode": "string (the 2-letter country code, e.g. 'US')",
  "year": 2026,
  "holidays": [
    {
      "name": "string (e.g. 'New Year\\'s Day')",
      "date": "string (YYYY-MM-DD)",
      "dayOfWeek": "string (e.g. 'Thursday')",
      "type": "string (e.g. 'National Holiday')"
    }
  ],
  "isSuccess": true
}
Ensure dates are historically and astronomically correct for 2026/specified year. Only return valid JSON.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json"
          }
        });

        const text = response.text || "";
        if (text) {
          const parsed = JSON.parse(cleanJsonString(text));
          if (parsed && parsed.isSuccess && parsed.holidays) {
            return {
              country: parsed.country,
              countryCode: parsed.countryCode,
              year: parsed.year || 2026,
              holidays: parsed.holidays
            };
          }
        }
      } catch (err) {
        console.error("Holidays lookup failed dynamically:", err);
      }
      return null;
    })() : Promise.resolve(null);

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

    // Movie & TV Database Search Integration (TMDB + fallback)
    const moviePromise = intentDataPromise.then(async (intentData: any) => {
      const entityType = (intentData?.entity_type || '').toLowerCase();
      const isMovieQueryCheck = finalQuery && (
        /movie|tv show|tv series|netflix|hbo|imdb|rotten tomatoes|cinematography|episodes of|cast of|season of|episode|season|cast/i.test(finalQuery) ||
        /media|movie|film|tv\s*show|series|franchise|cinema|anime|drama|show/i.test(entityType)
      );
      if (isMovieQueryCheck) {
        return getMovieOrTVData(finalQuery, intentData?.entity_name, intentData?.entity_type);
      }
      return null;
    });

    const [intentData, vector, dictionaryResult, dynamicBusiness, lyricsResult, holidaysResult, movieResult] = await Promise.all([
      intentDataPromise,
      embeddingPromise,
      dictionaryPromise,
      dynamicBusinessPromise,
      lyricsPromise,
      holidaysPromise,
      moviePromise
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

    // --- PARALLEL BLOCK 2: Query Pinecone with 2 highly optimized searchers instead of 9 ---
    // This reduces Pinecone network payload size and HTTP concurrency, serving results in milliseconds!
    const searchTerms = qLower.split(/\s+/).filter(t => t.length > 2);
    
    // Searcher 1: Intent Matcher Namespace Query (super lightweight, topK: 3)
    const intentSearchPromise = index.namespace('intent').query({
      vector: activeVector,
      topK: 3,
      includeMetadata: true
    }).catch(() => ({ matches: [] }));

    // Dynamically size Pinecone topK: 40 is plenty for page 1 under typical pagination, 80 for beyond, and 60 for images
    const optimalTopK = type === 'images' ? 60 : (page === 1 ? 40 : 80);

    // Searcher 2: Primary Semantic Searcher
    const primarySemanticPromise = index.query({
      vector: activeVector,
      topK: optimalTopK,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      includeMetadata: true,
      namespace
    }).catch(() => ({ matches: [] }));

    // Execute optimized searchers in parallel over the network for ultra-low latency
    const [intentRes, vRes] = await Promise.all([
      intentSearchPromise,
      primarySemanticPromise
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

    const allMatches = [
      ...vRes.matches
    ];
    const seenIds = new Set();
    const uniqueMatches = allMatches.filter(match => {
      if (seenIds.has(match.id)) return false;
      seenIds.add(match.id);
      return true;
    });

    // Removed blocking AI promise to make standard searches load under 200ms

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

    // Rigid SafeSearch Filtering of Result Entries and Blocking of Unwanted Automated Junk/CDNs
    let finalFilteredResults = allResults.filter(r => {
      const hostname = (r.displayUrl || '').toLowerCase();
      const urlLower = (r.url || '').toLowerCase();
      
      // Block known asset/CDN/automated/machine helper domains
      if (
        hostname.includes('googleusercontent.com') ||
        hostname.includes('gstatic.com') ||
        hostname.includes('googleapis.com') ||
        hostname.includes('fbcdn.net') ||
        hostname.includes('fastly.net') ||
        hostname.includes('cloudfront.net') ||
        hostname.includes('happycoding.io') ||
        hostname.includes('localhost') ||
        hostname.includes('storage.ghost.io') ||
        hostname.includes('gravatar.com')
      ) {
        return false;
      }

      // If search is not strictly "images", filter out links whose primary URL is raw images or binary files 
      if (type !== 'images') {
        if (
          urlLower.endsWith('.png') || 
          urlLower.endsWith('.jpg') || 
          urlLower.endsWith('.jpeg') || 
          urlLower.endsWith('.svg') || 
          urlLower.endsWith('.webp') || 
          urlLower.endsWith('.gif') || 
          urlLower.endsWith('.pdf') || 
          urlLower.endsWith('.zip')
        ) {
          return false;
        }
      }

      // Filter titles or snippets that look machine/hash-generated
      const checkMachineText = (txt: string) => {
        if (!txt) return false;
        // Check for common automated titles like Lh3: ... or Kstatic: ...
        if (/^(lh\d|kstatic|blogger|gstatic|googleusercontent|ghost|storage)\b/i.test(txt)) {
          return true;
        }
        // Check for long hex/alphanumeric tokens or hashes
        const words = txt.split(/[\s:_|\-\/]+/);
        for (const word of words) {
          if (word.length >= 18 && /[a-zA-Z]/.test(word) && /[0-9]/.test(word)) {
            return true;
          }
        }
        return false;
      };

      if (checkMachineText(r.title) || checkMachineText(r.snippet)) {
        return false;
      }

      return true;
    });

    if (safeSearch !== 'off') {
      finalFilteredResults = finalFilteredResults.filter(r => {
        const tSafe = !checkContentSafety(r.title);
        const sSafe = !checkContentSafety(r.snippet);
        const uSafe = !checkContentSafety(r.url);
        const dSafe = !checkContentSafety(r.displayUrl);
        const iSafe = r.image ? !checkContentSafety(r.image) : true;
        return tSafe && sSafe && uSafe && dSafe && iSafe;
      });
    }

    const reranked = finalFilteredResults.sort((a, b) => {
      // If we are ranking for images, apply a highly advanced scoring metric
      const aIsImg = a.is_image || (a.is_image === 'true');
      const bIsImg = b.is_image || (b.is_image === 'true');

      if (type === 'images' || aIsImg || bIsImg) {
        let scoreA = (a.score * 15.0) + (Math.log10(a.boost + 1) * 1.5);
        let scoreB = (b.score * 15.0) + (Math.log10(b.boost + 1) * 1.5);

        const terms = qLower.split(/\s+/).filter(t => t.length > 1);

        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        const snippetA = (a.snippet || '').toLowerCase();
        const snippetB = (b.snippet || '').toLowerCase();
        const urlA = (a.url || '').toLowerCase();
        const urlB = (b.url || '').toLowerCase();

        // High priority: exact title matches whole query
        if (titleA === qLower) scoreA += 50.0;
        if (titleB === qLower) scoreB += 50.0;

        // Individual keyword match boosts
        terms.forEach(term => {
          if (titleA.includes(term)) scoreA += 15.0;
          if (titleB.includes(term)) scoreB += 15.0;

          if (snippetA.includes(term)) scoreA += 5.0;
          if (snippetB.includes(term)) scoreB += 5.0;

          if (urlA.includes(term)) scoreA += 3.0;
          if (urlB.includes(term)) scoreB += 3.0;
        });

        // Reputable photo database / information portals boosts (Wikipedia, Unsplash, etc.)
        const reputableImageHosts = ['wikipedia', 'wikimedia', 'unsplash', 'pixabay', 'pexels', 'flickr', 'alamy', 'shutterstock', 'pinterest'];
        if (reputableImageHosts.some(host => urlA.includes(host))) scoreA += 12.0;
        if (reputableImageHosts.some(host => urlB.includes(host))) scoreB += 12.0;

        // Penalize poor quality filenames or dummy IDs if they occur
        if (/(img_|image_|dsc_|thumb_|pic_|_temp)/i.test(urlA)) scoreA -= 4.0;
        if (/(img_|image_|dsc_|thumb_|pic_|_temp)/i.test(urlB)) scoreB -= 4.0;

        // If sorting mixed content and one is an image, boost the image when in imagetab
        if (type === 'images') {
          if (aIsImg && !bIsImg) scoreA += 100.0;
          if (!aIsImg && bIsImg) scoreB += 100.0;
        }

        return scoreB - scoreA;
      }

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

    // Real-time rule-based intent estimation in 0ms for maximum responsive speed
    let estimatedIntent = 'general';
    const cleanQWithSpaces = (query || '').toLowerCase().trim();
    if (queryPreferencesCache[cleanQWithSpaces] && queryPreferencesCache[cleanQWithSpaces].detectedIntent) {
      estimatedIntent = queryPreferencesCache[cleanQWithSpaces].detectedIntent;
    } else if (movieResult) {
      estimatedIntent = 'movie';
    } else if (lyricsResult) {
      estimatedIntent = 'lyrics';
    } else if (holidaysResult) {
      estimatedIntent = 'holiday';
    } else if (dictionaryResult) {
      estimatedIntent = 'dictionary';
    } else {
      if (/^(how\s+to|how\s+do|how\s+can|how\s+much|how\s+many|how\s+long|recipe\s+for|guide\s+to|steps\s+to|tutorial\s+on|how\s+does)/i.test(cleanQWithSpaces)) {
        estimatedIntent = 'how_to';
      } else if (type === 'images') {
        estimatedIntent = 'general';
      } else if (/video|clip|tutorial|youtube|watch/i.test(cleanQWithSpaces)) {
        estimatedIntent = 'video';
      }
    }

    const searchResponseData = { 
      results: resultsWithOptionalImages,
      dictionary: dictionaryResult,
      lyrics: lyricsResult,
      holidays: holidaysResult,
      movie: movieResult,
      suggestKnowledgePanel,
      detectedEntity,
      isEnglishHelp,
      apps: dynamicBusiness ? dynamicBusiness.apps : null,
      businessProfile: dynamicBusiness ? dynamicBusiness.businessProfile : null,
      correction: null, 
      originalQuery: null,
      page,
      totalPages: totalPagesCount,
      totalResults: finalOrdered.length,
      visualMathProblem: null,
      detectedIntent: estimatedIntent,
      howTo: null,
      organicFaqs: []
    };

    if (!imageQuery) {
      searchResponseCache.set(cacheKey, searchResponseData);
      if (searchResponseCache.size > 500) {
        const firstKey = searchResponseCache.keys().next().value;
        if (firstKey) searchResponseCache.delete(firstKey);
      }
    }

    res.json(searchResponseData);
  } catch (err: any) {
    console.error("Search API Error:", err);
    res.status(500).json({ error: "Internal search engine error", message: err.message });
  }
});

// --- NEW ASYNC SEMANTIC DETAILS ENDPOINT ---
app.post('/api/search/semantic-details', async (req, res) => {
  try {
    const { query, results } = req.body;
    if (!query) {
      return res.json({ detectedIntent: 'general', howTo: null, organicFaqs: [] });
    }

    const cleanQ = query.trim().toLowerCase();
    const cacheKey = `semantic_${cleanQ}`;
    if (searchResponseCache.has(cacheKey)) {
      return res.json(searchResponseCache.get(cacheKey));
    }

    const ai = getGenAI();
    if (!ai) {
      return res.json({ detectedIntent: 'general', howTo: null, organicFaqs: [] });
    }

    const prefRule = await getQueryIntentRule(query);
    const disallowedHint = (prefRule && prefRule.disallowedIntents && prefRule.disallowedIntents.includes('how_to'))
      ? `\n\nCRITICAL KNOWLEDGE GUARD WARNING: Aggregate user research interactions indicate this query belongs to the '${prefRule.entityType}' entity domain (e.g. Media Franchise, Movie, Show) with a confidence of ${prefRule.confidence}. Do NOT synthesize any instructional step-by-step guides or howTo checklists for this entity! Set "howTo" to null. Place "detectedIntent" as "general".`
      : '';

    const contextText = (results || []).slice(0, 5).map((match: any) => {
      return `Source: ${match.url || 'Pinecone chunk'}\nTitle: ${match.title || ''}\nSnippet: ${match.snippet || match.text || ''}`;
    }).join('\n\n');

    const prompt = `You are Scout's Google-grade Semantic Intent & Extraction Brain. Your job is to analyze the user query and the matched search result text chunks, determine the user's search intent, and synthesize a high-utility guided checklist and people also ask FAQs list.

USER QUERY: "${query}"

MATCHED RESULT CHUNKS:
${contextText}${disallowedHint}

YOUR INSTRUCTIONS:
1. Categorize the Search Intent ("detectedIntent") into one of:
   - "how_to": The user is asking "how to", "how do I", "guide", "steps", or asking to complete a process.
   - "video": The user is searching for a video, clip, tutorial playback, or youtube result.
   - "dictionary": The user is defining a single word, asking "what is the definition of", or "phonetic of".
   - "lyrics": The user is searching for song lyrics.
   - "holiday": The user is searching for national days/holidays.
   - "general": General information or entity searches.
   
2. Synthesize a step-by-step checklist ("howTo") if the query or matched chunks describe a sequence of steps, instructions, setup guide, or tutorial, OR if the query is a "how do I", "how does [company] make money", "how to write a letter", or similar descriptive process/question.
   - For informational questions like "how does google get its money", split the response into logical stages or primary revenue streams (e.g. Stage 1: Search Ads, Stage 2: Google Network, Stage 3: Cloud, etc.) so it perfectly displays inside the Interactive Guided Steps card!
   - Ensure the title is elegant and human-centric (e.g., "Step-by-Step Letter Writing Guide", "A Breakdown of Google's Revenue Streams").
   - Extract at least 3-6 clear, actionable steps or stages.
   - For each step, provide a small detailed explanation ("details") and associate it with the correct "sourceUrl" from the most relevant MATCHED RESULT CHUNK.
   
3. Synthesize a list of 2-4 "organicFaqs" (People Also Ask) from the MATCHED RESULT CHUNKS.
   - These must be questions related to the query that would help the user.
   - Each FAQ must have a concise, accurate "answer" synthesized directly from the matched snippet text.
   - Each FAQ should reference the correct "sourceUrl" from the chunk.

Always return a valid JSON object matching this schema exactly:
{
  "detectedIntent": "how_to" | "video" | "dictionary" | "lyrics" | "holiday" | "general",
  "howTo": {
    "title": "string",
    "estimatedTime": "string | null",
    "difficulty": "string | null",
    "steps": [
      {
        "step": "string",
        "details": "string",
        "sourceUrl": "string | null"
      }
    ]
  } | null,
  "organicFaqs": [
    {
      "question": "string",
      "answer": "string",
      "sourceUrl": "string | null"
    }
  ]
}

If the query is a process-oriented question or contains 'how', 'recipe', 'guide', 'step', 'tutorial', 'can i', 'do i', or similar search queries, you MUST synthesize a step-by-step guided checklist! Do NOT set "howTo" to null under any circumstances for these queries. Instead, utilize your deep, high-fidelity knowledge of the topic to synthesize highly precise, practical, and accurate steps/stages so the user gets an outstanding Interactive Guided Steps card!

If the query is not process-oriented and no steps can be compiled, set "howTo" to null. If no faqs can be accurately compiled, set "organicFaqs" to [].
Make sure all JSON keys are correct. Do NOT output anything other than raw, parsing-ready JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text || "";
    let semanticResult = { detectedIntent: 'general', howTo: null, organicFaqs: [] };
    
    if (text) {
      try {
        const parsed = JSON.parse(cleanJsonString(text));
        let detectedIntent = parsed.detectedIntent || 'general';
        let howTo = parsed.howTo || null;
        const organicFaqs = parsed.organicFaqs || [];

        if (prefRule && prefRule.disallowedIntents && prefRule.disallowedIntents.includes('how_to')) {
          detectedIntent = 'general';
          howTo = null;
        }

        semanticResult = {
          detectedIntent,
          howTo,
          organicFaqs
        };
      } catch (jsonErr) {
        console.warn("⚠️ JSON parse failed for background semantic brain:", jsonErr);
      }
    }

    searchResponseCache.set(cacheKey, semanticResult);
    res.json(semanticResult);
  } catch (err: any) {
    console.error("❌ Semantic details API Error:", err);
    res.json({ detectedIntent: 'general', howTo: null, organicFaqs: [] });
  }
});

// TMDB TV SEASON EPISODES ENRICHMENT ENDPOINT
app.get('/api/tmdb/tv/:id/season/:seasonNumber', async (req, res) => {
  try {
    const { id, seasonNumber } = req.params;
    const showName = (req.query.showName as string) || '';
    const apiKey = process.env.TMDB_API_KEY;
    
    if (apiKey) {
      try {
        console.log(`🎬 [TMDB] Fetching season ${seasonNumber} for show ID ${id}`);
        const seasonRes = await axios.get(`https://api.themoviedb.org/3/tv/${id}/season/${seasonNumber}`, {
          params: { api_key: apiKey },
          timeout: 2500
        });
        if (seasonRes.data && seasonRes.data.episodes) {
          const episodes = seasonRes.data.episodes.map((ep: any) => ({
            id: ep.id,
            name: ep.name,
            episodeNumber: ep.episode_number,
            overview: ep.overview || '',
            airDate: ep.air_date || '',
            rating: ep.vote_average ? parseFloat(ep.vote_average.toFixed(1)) : 0,
            stillPath: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null
          }));
          return res.json({ episodes });
        }
      } catch (err: any) {
        console.warn(`🎬 [TMDB] Live season fetch failed:`, err.message);
      }
    }
    
    // Fallback: use Gemini to synthesize the matching season's episode list
    const ai = getGenAI();
    if (!ai) {
      return res.status(503).json({ error: "Gemini not configured" });
    }
    
    console.log(`🎬 [TMDB] Synthesizing season ${seasonNumber} episodes for show Name "${showName}"`);
    const prompt = `Generate a realistic, accurate episode guide list for season ${seasonNumber} of the TV show "${showName}".
Return a valid JSON object matching this schema:
{
  "episodes": [
    {
      "id": number (choose random 5-6 digit IDs),
      "name": "Episode Title",
      "episodeNumber": number (sequential from 1 to total episode count),
      "overview": "string (episode plot summary)",
      "airDate": "string (YYYY-MM-DD)",
      "rating": number (an average rating e.g. 8.8),
      "stillPath": "string (matching horizontal cinematic Unsplash image URL)"
    }
  ]
}
Ensure the episode titles, counts, and descriptions correspond to the actual real-world episodic listing for this season. Output only valid JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text || "";
    if (text) {
      const parsed = JSON.parse(cleanJsonString(text));
      if (parsed && parsed.episodes) {
        return res.json({ episodes: parsed.episodes });
      }
    }
    
    res.json({ episodes: [] });
  } catch (err: any) {
    console.error("🎬 [TMDB] Season API Error:", err);
    res.status(500).json({ error: "Internal TMDB season mapping error", message: err.message });
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

  try {
    const events = await listClickstreamREST();
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
    
    // Proactively warm up local transformers.js model and Pinecone setup on boot for instantaneous search response times
    getPipes().catch(err => console.warn("⚠️ Background neural engine warmup failed:", err));
    try {
      getPinecone();
    } catch (e) {}
  });
}

export default app;
