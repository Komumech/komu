/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, Fragment } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Mic, Image as ImageIcon, Video, MapPin, Newspaper, X, LayoutGrid, User, Trophy, Menu, ArrowRight, ExternalLink, Sparkles, Loader2, LogOut, ChevronLeft, ChevronRight, Camera, Check, Zap, BarChart3, TrendingUp, Target, MousePointer2, Clock, PlayCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area } from 'recharts';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, arrayUnion } from "firebase/firestore";
import firebaseConfig from '../firebase-applet-config.json';
import { GoogleGenAI, Type } from "@google/genai";
import { SearchResult, AIOverview, KnowledgePanel, VisualAnalysis } from './types';

// Initialize Gemini on the Frontend
const API_KEY = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenAI({ apiKey: API_KEY || 'AI-NOT-SET' });
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export default function App() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiOverview, setAiOverview] = useState<AIOverview | null>(null);
  const [isOverviewExpanded, setIsOverviewExpanded] = useState(false);
  const [aiRateLimited, setAiRateLimited] = useState(false);
  const [scoutKnowledge, setScoutKnowledge] = useState<any>(null);
  const [faq, setFaq] = useState<{ question: string; answer: string }[]>([]);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [homeBg, setHomeBg] = useState<string>('');
  const [dictionary, setDictionary] = useState<any>(null);
  const [directAnswer, setDirectAnswer] = useState<any>(null);
  const [correction, setCorrection] = useState<string | null>(null);
  const [originalQuery, setOriginalQuery] = useState<string | null>(null);
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [clickedUrls, setClickedUrls] = useState<string[]>([]);
  const [isSignoutOpen, setIsSignoutOpen] = useState(false);
  const [knowledgePanel, setKnowledgePanel] = useState<KnowledgePanel | null>(null);
  const [isAppsOpen, setIsAppsOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [analyticsEvents, setAnalyticsEvents] = useState<any[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [isEnglishHelp, setIsEnglishHelp] = useState(false);
  const [imageQuery, setImageQuery] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<SearchResult | null>(null);
  const [visualAnalysis, setVisualAnalysis] = useState<VisualAnalysis | null>(null);
  const [isVisualSearching, setIsVisualSearching] = useState(false);
  const [visualMathProblem, setVisualMathProblem] = useState<any>(null);
  const [selectedVideo, setSelectedVideo] = useState<any>(null); // New state for video modal
  const [searchStage, setSearchStage] = useState<'idle' | 'extracting' | 'vectorizing' | 'ranking'>('idle');
  const sessionId = useRef(`sess-${Math.random().toString(36).substring(2, 15)}`).current;
  const lastQueryRef = useRef<string>('');
  const lastClickRef = useRef<{ id: string; url: string; time: number; query: string } | null>(null);
  const appsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Click outside listener for suggestions and apps
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
      if (appsRef.current && !appsRef.current.contains(event.target as Node)) {
        setIsAppsOpen(false);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && lastClickRef.current) {
        const now = Date.now();
        const durationMs = now - lastClickRef.current.time;
        const durationSeconds = durationMs / 1000;
        
        // Pogo-sticking: if return < 20 seconds (Frustrated bounce)
        // Dwell: if stay > 60 seconds (High satisfaction)
        let type = 'success';
        if (durationSeconds < 20) type = 'pogo';
        else if (durationSeconds > 60) type = 'dwell';

        console.log(`User Signal: ${type} after ${durationSeconds.toFixed(1)}s`);
        
        axios.post('/api/feedback', { 
          id: lastClickRef.current.id, 
          type, 
          queryText: lastClickRef.current.query,
          durationMs
        }).catch(() => {});

        // AI Training Log: dwell_update for Learning to Rank
        axios.post('/api/admin/clickstream', {
          type: 'dwell_update',
          query: lastClickRef.current.query,
          url: lastClickRef.current.url,
          duration: durationSeconds,
          sessionId: sessionId,
          uid: user?.sub || 'guest'
        }).catch(() => {});

        lastClickRef.current = null;
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // SWITCH TAB SEARCH
  useEffect(() => {
    if (isSearching && query.trim()) {
      handleSearch(query, 1);
    }
  }, [activeTab]);

  // Random Background for Home
  useEffect(() => {
    const backgrounds = [
      'https://picsum.photos/seed/scout-1/1920/1080?blur=1',
      'https://picsum.photos/seed/scout-vibe/1920/1080?blur=1',
      'https://picsum.photos/seed/minimal/1920/1080?blur=1',
      'https://picsum.photos/seed/abstract/1920/1080?blur=1',
      'https://picsum.photos/seed/nature/1920/1080?blur=1',
      'https://picsum.photos/seed/space/1920/1080?blur=1'
    ];
    setHomeBg(backgrounds[Math.floor(Math.random() * backgrounds.length)]);
  }, []);

  // SPEECH RECOGNITION SETUP
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      
      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result: any) => result.transcript)
          .join('');
        setQuery(transcript);
        if (event.results[0].isFinal) {
          setTimeout(() => {
            setIsListening(false);
            handleSearch(transcript);
          }, 500);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setMicError("Microphone access is blocked. Please enable it in your browser settings.");
          setTimeout(() => setMicError(null), 5000);
        }
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch (e) {}
      setIsListening(false);
    } else {
      try {
        setQuery('');
        recognitionRef.current?.start();
      } catch (e) {
        console.error('Failed to start recognition:', e);
        setIsListening(false);
      }
    }
  };

  // LOAD USER HISTORY & CLICKS
  useEffect(() => {
    if (!user?.sub) return;
    const loadHistory = async () => {
      try {
        const userDoc = await getDoc(doc(db, "users", user.sub));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserHistory(data.queries || []);
          setClickedUrls(data.clickedUrls || []);
        }
      } catch (e) { console.error("Error loading history:", e); }
    };
    loadHistory();
  }, [user]);

  // SEARCH SUGGESTIONS (Merged with History)
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        // Find matches in history first
        const historyMatches = userHistory
          .filter(h => h.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 3);

        const res = await fetch(`/api/suggestions?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error("Failed suggestions");
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) throw new Error("Non-JSON");
        
        const data = await res.json();
        
        // Merge history and global, with history appearing first
        const merged = [...new Set([...historyMatches, ...data])];
        setSuggestions(merged.slice(0, 6));
      } catch (e) {
        setSuggestions([]);
      }
    };

    const timer = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timer);
  }, [query, userHistory]);

  // AUTH CHECK
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/me');
        if (!res.ok) return;
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
           const data = await res.json();
           setUser(data.user);
        }
      } catch (e) {
        console.warn("Auth check failed", e);
      }
    };

    checkAuth();

    const handleOAuthSuccess = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) return;
      
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const recheckAuth = async () => {
          try {
            const res = await fetch('/api/me');
            if (res.ok) {
              const contentType = res.headers.get("content-type");
              if (contentType && contentType.includes("application/json")) {
                const data = await res.json();
                setUser(data.user);
              }
            }
          } catch (e) {}
        };
        recheckAuth();
      }
    };

    window.addEventListener('message', handleOAuthSuccess);
    return () => window.removeEventListener('message', handleOAuthSuccess);
  }, []);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/url');
      if (!res.ok) throw new Error("Login failed");
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) throw new Error("Non-JSON");
      
      const { url } = await res.json();
      const width = 600, height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(url, 'google_login', `width=${width},height=${height},left=${left},top=${top}`);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch('/api/admin/clickstream');
      if (res.ok) {
        const data = await res.json();
        setAnalyticsEvents(data);
      }
    } catch (e) {
      console.error("Failed to fetch analytics", e);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    setUser(null);
  };

  const handleSearch = async (e?: React.FormEvent | string, requestedPage = 1, visualQuery?: string) => {
    if (e && typeof e !== 'string') e.preventDefault();
    let finalQuery = typeof e === 'string' ? e : query;
    const currentVisualQuery = visualQuery || imageQuery;
    
    // If searching keyword from Results header, reset to 'All' tab so panel shows
    const isFreshSearch = e !== undefined && requestedPage === 1 && !visualQuery;
    if (isFreshSearch && activeTab !== 'all') {
      if (typeof e === 'string') setQuery(e);
      setActiveTab('all');
      return; // setActiveTab triggers useEffect which calls handleSearch again
    }

    if (!finalQuery.trim() && !currentVisualQuery) return;

    setLoading(true);
    setIsSearching(true);
    setResults([]); 
    setSearchStage(currentVisualQuery ? 'extracting' : 'ranking');
    setVisualMathProblem(null);
    setVisualAnalysis(null);
    setAiOverview(null);
    setScoutKnowledge(null);
    setDictionary(null);
    setDirectAnswer(null);
    setKnowledgePanel(null);
    setIsEnglishHelp(false);
    setFaq([]);
    setShowSuggestions(false);
    setError(null);
    setPage(requestedPage);
    setCorrection(null);
    setOriginalQuery(null);
    lastQueryRef.current = finalQuery;

    let vector = null;

    // PERFORM FRONTEND VISUAL ANALYSIS IF IMAGE IS PRESENT
    if (currentVisualQuery && requestedPage === 1) {
      setSearchStage('extracting');
      await new Promise(r => setTimeout(r, 800)); // Show scanning start
      setSearchStage('vectorizing');
    }

    // Neural embeddings are now handled server-side using mpnet-base for consistency and precision.
    // compatibility with the CLIP-ViT-L-14 latent space.

    // AUTOCORRECT ON FRONTEND (Adhering to rules)
    if (!currentVisualQuery && requestedPage === 1 && finalQuery.length > 3 && API_KEY && API_KEY !== 'AI-NOT-SET') {
      try {
        const autocorrectPrompt = `Act as a search engine spell checker. Check if "${finalQuery}" has obvious typos. 
        If it has an obvious typo, return ONLY the corrected string. 
        If it is likely correct or a brand name, return the exact same string.
        Be conservative. Only correct if you are 95% certain.`;
        
        const r = await genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: autocorrectPrompt
        });
        const text = r.text?.trim() || "";
        if (text.toLowerCase() !== finalQuery.toLowerCase() && text.length > 0 && text.length < 100) {
          setCorrection(text);
          setOriginalQuery(finalQuery);
          finalQuery = text;
        }
      } catch (e) {}
    } else {
      console.warn("Autocorrect failed: API key not configured");
    }

    try {
      const searchRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: finalQuery, 
          page: requestedPage,
          type: activeTab,
          clickedUrls,
          imageQuery: currentVisualQuery,
          vector 
        })
      });
      
      let data: any;
      const contentType = searchRes.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await searchRes.json();
      } else {
        const text = await searchRes.text();
        if (text.includes("application starts") || text.includes("Starting Server")) {
          throw new Error("Neural Engines Warming Up: Scout is currently loading its local AI models. Please wait about 30 seconds and try again.");
        }
        console.error("Non-JSON Server Response:", text);
        throw new Error(`Server Error (${searchRes.status}): ${text.slice(0, 100)}...`);
      }
      
      if (!searchRes.ok) {
        if (!currentVisualQuery) setSearchStage('idle');
        // Handle specific warming error from our backend
        if (searchRes.status === 503 && data.error === "Neural Engines Warming Up") {
           throw new Error(data.message || "Scout's AI engine is warming up. Please try again in 30 seconds.");
        }
        throw new Error(data.error || 'Unknown search error');
      }

      setVisualMathProblem(data.visualMathProblem || null);
      if (data.visualMathProblem) {
        // AI/Google-grade artificial delay to show the analysis stages vividly
        setSearchStage('vectorizing');
        await new Promise(r => setTimeout(r, 600));
        setSearchStage('ranking');
      } else {
        setSearchStage('ranking');
      }

      setCorrection(data.correction || null);
      setOriginalQuery(data.originalQuery || null);
      if (data.correction) {
        setQuery(data.correction);
      }

      const pineconeResults = data.results || [];
      setScoutKnowledge(data.scoutKnowledge || null);
      if (data.scoutKnowledge) {
        console.log(`🧠 Knowledge Panel: Sourced from ${data.scoutKnowledge.source}`);
      }

      setTotalPages(data.totalPages || 1);
      setDictionary(data.dictionary || null);
      setIsEnglishHelp(data.isEnglishHelp || false);
      
      // Trigger Direct Answer if factual intent detected
      if (data.factualType && data.detectedEntity) {
        generateDirectAnswer(finalQuery, data.factualType, data.detectedEntity.name);
      }

      const rawResults: SearchResult[] = pineconeResults.map((r: any) => ({
        id: r.id,
        title: r.title || 'Untitled Page',
        url: r.url || '#',
        displayUrl: r.displayUrl || 'unknown',
        snippet: r.snippet || 'No description available.',
        sourceIcon: r.sourceIcon || '🌐',
        image: r.image || null
      }));

      // IMMEDIATE UPDATE FOR SPEED
      setResults(rawResults);
      setLoading(false);

      // Persist to Firebase history
      if (user?.sub && requestedPage === 1 && finalQuery.trim() && finalQuery !== 'Visual Search (Scout Vision)') {
        setDoc(doc(db, "users", user.sub), {
          queries: arrayUnion(finalQuery.trim()),
          updatedAt: new Date().toISOString()
        }, { merge: true }).catch(console.error);
        setUserHistory(prev => [...new Set([...prev, finalQuery.trim()])]);
      }

      // Add Clickstream Logging (Triggers collection creation)
      if (requestedPage === 1 && finalQuery.trim() && finalQuery !== 'Visual Search (Scout Vision)') {
        axios.post('/api/admin/clickstream', {
          type: 'search',
          query: finalQuery,
          url: '',
          position: null,
          sessionId: sessionId,
          uid: user?.sub || 'guest'
        }).catch(() => {}); // Silent fail for analytics
      }

      // PARALLEL EXECUTION FOR AI FEATURES
      if (requestedPage === 1) {
        generateAIOverview(finalQuery, rawResults, data.isEnglishHelp || false);
        generateFAQ(finalQuery, rawResults);
        
        // Intelligent triggering for Knowledge Panel (Entity card)
        const topResultIsEntity = rawResults[0]?.displayUrl.includes('wikipedia.org') || 
                                 rawResults[0]?.displayUrl.includes('britannica.com');
        
        if (data.suggestKnowledgePanel && data.detectedEntity) {
          generateKnowledgePanel(data.detectedEntity.name, data.detectedEntity.type);
        } else if (topResultIsEntity && !data.isEnglishHelp && !data.dictionary) {
          // Trigger KP for top authoritative entities even if intent didn't catch it
          generateKnowledgePanel(rawResults[0].title);
        }
      }
    } catch (error: any) {
      console.error("Search failed:", error);
      setError(error.message || "Something went wrong.");
      setLoading(false);
    }
  };

  const generateDirectAnswer = async (queryText: string, type: string, subject: string) => {
    if (!API_KEY || API_KEY === 'AI-NOT-SET') return;
    try {
      const prompt = `Provide a concise, authoritative "Knowledge Card" answer for: "${queryText}". 
      Type: "${type}", Subject: "${subject}". 
      Return ONLY a JSON object: 
      { 
        "answer": "Main factual answer (e.g. North America)", 
        "label": "Context hierarchy (e.g. Canada > Continent)", 
        "description": "One sentence explanation", 
        "details": [{"label": "Factual Key", "value": "Factual Value"}],
        "image_hint": "A single word for a relevant high-res photo"
      }`;

      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" }
      });
      
      const data = JSON.parse(result.text || 'null');
      if (data) setDirectAnswer(data);
    } catch (e) { console.error("Direct Answer failed", e); }
  };

  const generateAIOverview = async (queryText: string, contextResults: SearchResult[], linguisticHelp = false) => {
    if (!API_KEY || API_KEY === 'AI-NOT-SET') return;
    setAiLoading(true);
    setIsOverviewExpanded(false);
    setAiRateLimited(false);
    try {
      // Include image URLs in the context for the LLM to use
      const context = contextResults.slice(0, 5).map(r => 
        `Title: ${r.title}\nSnippet: ${r.snippet}\nSource: ${r.url}${r.image ? `\nImage_URL: ${r.image}` : ''}`
      ).join("\n---\n");
      
      const prompt = linguisticHelp
        ? `Act as an expert linguist. Provide a concise grammar, spelling, and usage guide for: "${queryText}". Respond in Markdown with clear examples.`
        : `Act as a master synthesis engine for the search engine "Scout". 
           Provide a comprehensive, authoritative AI Overview for the search query: "${queryText}". 
           Use the following search results as context:
           ${context}
           
           Instructions:
           1. Start with a direct answer.
           2. Use bullet points for key facts.
           3. INTEGRATE IMAGES: If a search result has an "Image_URL", you MAY include it using standard Markdown !title if it is highly relevant to a section of your answer. Place images naturally between paragraphs or near relevant facts. Use at most 2-3 images.
           4. Be objective and professional.
           5. Use Markdown formatting.`;

      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      
      setAiOverview({
        summary: result.text || "No summary available.",
        sources: contextResults.slice(0, 3).map(r => ({ title: r.title, url: r.url }))
      });
    } catch (e: any) {
      console.error("AI Overview failed:", e);
      if (e.message?.includes('429') || e.status === 429) {
        setAiRateLimited(true);
      }
    } finally {
      setAiLoading(false);
    }
  };

  const generateFAQ = async (queryText: string, contextResults: SearchResult[]) => {
    if (!API_KEY || API_KEY === 'AI-NOT-SET') return;
    try {
      const context = contextResults.slice(0, 8).map(r => r.snippet).join("\n");
      const prompt = `Query: "${queryText}"\nContext: ${context}\nGenerate 5 relevant frequently asked questions as a JSON array: [{"question": "...", "answer": "..."}]`;
      
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                answer: { type: Type.STRING }
              },
              required: ["question", "answer"]
            }
          }
        }
      });
      
      const data = JSON.parse(response.text || '[]');
      setFaq(data);
    } catch (e) {
      console.error("FAQ generation failed:", e);
    }
  };

  const generateKnowledgePanel = async (entityName: string, entityType?: string) => {
    if (!API_KEY || API_KEY === 'AI-NOT-SET') return;
    try {
      const prompt = `Entity: "${entityName}" (${entityType || 'General'})
      Generate a high-quality "Knowledge Panel" for this entity. 
      Return as a JSON object with: 
      title, subtitle, description, image (a placeholder like "https://images.unsplash.com/photo..."), 
      details (array of {label, value}), and sections (array of {title, content}).`;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              subtitle: { type: Type.STRING },
              description: { type: Type.STRING },
              image: { type: Type.STRING },
              details: { 
                type: Type.ARRAY, 
                items: { 
                  type: Type.OBJECT, 
                  properties: { label: { type: Type.STRING }, value: { type: Type.STRING } },
                  required: ["label", "value"] 
                } 
              },
              sections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { title: { type: Type.STRING }, content: { type: Type.STRING } },
                  required: ["title", "content"]
                }
              }
            },
            required: ["title", "subtitle", "description", "details", "sections"]
          }
        }
      });
      
      const data = JSON.parse(response.text || 'null');
      if (data) setKnowledgePanel(data);
    } catch (e) {
      console.error("Knowledge Panel failed:", e);
    }
  };

  const handleResultClick = (id: string, url: string, position: number) => {
    // Record for behavioral signals (Pogo-sticking detection)
    lastClickRef.current = { id, url, time: Date.now(), query: lastQueryRef.current };

    // Immediate NavBoost "Interest" signal
    axios.post('/api/feedback', { id, type: 'click', queryText: lastQueryRef.current }).catch(() => {});

    // AI Training Log: capture position for Learning to Rank
    axios.post('/api/admin/clickstream', {
      type: 'click',
      query: lastQueryRef.current,
      url: url,
      position: position,
      sessionId: sessionId,
      uid: user?.sub || 'guest'
    }).catch(() => {});

    if (!user?.sub) return;
    setClickedUrls(prev => [...new Set([...prev, url])]);
    setDoc(doc(db, "users", user.sub), {
      clickedUrls: arrayUnion(url),
      updatedAt: new Date().toISOString()
    }, { merge: true }).catch(console.error);
  };

  const goHome = () => {
    setIsSearching(false);
    setQuery('');
    setResults([]);
    setAiOverview(null);
    setDictionary(null);
    setIsOverviewExpanded(false);
    setFaq([]);
    setKnowledgePanel(null);
  };

  useEffect(() => {
    if (!isSearching) searchInputRef.current?.focus();
  }, [isSearching]);

  const onImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setImageQuery(base64);
        setQuery('Visual Search (Scout Vision)');
        handleSearch(undefined, 1, base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImageQuery = () => {
    setImageQuery(null);
    setQuery('');
  };

  return (
    <div className="min-h-screen bg-white font-sans selection:bg-blue-100 selection:text-blue-900">
      <AnimatePresence>
        {micError && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[110] bg-red-600 text-white px-6 py-3 rounded-full shadow-xl font-bold flex items-center gap-3"
          >
            <div className="w-2 h-2 bg-white rounded-full animate-ping" />
            {micError}
          </motion.div>
        )}
        {isListening && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/95 backdrop-blur-3xl text-white"
          >
            <div className="relative mb-12">
               <motion.div 
                  animate={{ scale: [1, 1.4, 1], opacity: [0.2, 0.5, 0.2] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute inset-[-60px] rounded-full bg-linear-to-tr from-blue-600 via-purple-600 to-pink-600 blur-3xl"
               />
               <div className="relative w-28 h-28 bg-white rounded-full flex items-center justify-center shadow-2xl">
                 <Mic size={48} className="text-blue-600 animate-pulse" />
               </div>
            </div>
            <h2 className="text-4xl font-display font-bold tracking-tight mb-4">Listening...</h2>
            <p className="text-white/60 text-xl max-w-lg text-center px-6 italic">"{query || 'Speak now'}"</p>
            <button onClick={() => setIsListening(false)} className="mt-16 px-10 py-4 bg-white/10 hover:bg-white/20 rounded-full border border-white/20 transition-all font-bold">Cancel</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!isSearching ? (
          <HomeView 
            key="home" 
            query={query} 
            setQuery={setQuery} 
            onSearch={handleSearch} 
            suggestions={suggestions} 
            showSuggestions={showSuggestions} 
            setShowSuggestions={setShowSuggestions} 
            inputRef={searchInputRef} 
            searchContainerRef={searchContainerRef} 
            user={user} 
            onLogin={handleLogin} 
            onLogout={handleLogout} 
            onMicClick={toggleListening} 
            bg={homeBg} 
            isSignoutOpen={isSignoutOpen} 
            setIsSignoutOpen={setIsSignoutOpen} 
            appsRef={appsRef} 
            isAppsOpen={isAppsOpen} 
            setIsAppsOpen={setIsAppsOpen} 
            imageQuery={imageQuery} 
            onImageUpload={onImageUpload} 
            removeImageQuery={removeImageQuery} 
            fileInputRef={fileInputRef} 
            userHistory={userHistory}
            onOpenAnalytics={() => { setIsAnalyticsOpen(true); fetchAnalytics(); }}
          />
        ) : (
          <ResultsView 
            key="results"
            query={query}
            setQuery={setQuery}
            onSearch={handleSearch}
            loading={loading}
            results={results}
            error={error}
            aiOverview={aiOverview}
            dictionary={dictionary}
            knowledgePanel={knowledgePanel}
            isEnglishHelp={isEnglishHelp}
            isOverviewExpanded={isOverviewExpanded}
            setIsOverviewExpanded={setIsOverviewExpanded}
            faq={faq}
            openFaqIndex={openFaqIndex}
            setOpenFaqIndex={setOpenFaqIndex}
            aiLoading={aiLoading}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            page={page}
            totalPages={totalPages}
            goHome={goHome}
            user={user}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onMicClick={toggleListening}
            suggestions={suggestions}
            showSuggestions={showSuggestions}
            setShowSuggestions={setShowSuggestions}
            searchContainerRef={searchContainerRef}
            onResultClick={handleResultClick}
            clickedUrls={clickedUrls}
            isSignoutOpen={isSignoutOpen}
            setIsSignoutOpen={setIsSignoutOpen}
            appsRef={appsRef}
            isAppsOpen={isAppsOpen}
            setIsAppsOpen={setIsAppsOpen}
            correction={correction}
            originalQuery={originalQuery}
            imageQuery={imageQuery}
            onImageUpload={onImageUpload}
            removeImageQuery={removeImageQuery}
            fileInputRef={fileInputRef}
            visualMathProblem={visualMathProblem}
            searchStage={searchStage}
            visualAnalysis={visualAnalysis}
            setImageQuery={setImageQuery}
            selectedImage={selectedImage}
            selectedVideo={selectedVideo} // Pass to ResultsView
            setSelectedImage={setSelectedImage}
            setSelectedVideo={setSelectedVideo}
            aiRateLimited={aiRateLimited}
            scoutKnowledge={scoutKnowledge}
            directAnswer={directAnswer}
            onOpenAnalytics={() => { setIsAnalyticsOpen(true); fetchAnalytics(); }}
          />
        )}
        {isAnalyticsOpen && (
          <AnalyticsDashboard 
            events={analyticsEvents} 
            onClose={() => setIsAnalyticsOpen(false)} 
            loading={analyticsLoading}
            refresh={fetchAnalytics}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {selectedImage && (
          <ImageDetailView 
            image={selectedImage} 
            // Pass all results to ImageDetailView to find related images
            // This avoids re-fetching and keeps the data consistent
            allResults={results} 
            onClose={() => setSelectedImage(null)} 
            onSelect={(img: any) => setSelectedImage(img)}
            onResultClick={handleResultClick}
          />
        )}
        {selectedVideo && ( // New: Video Detail View
          <VideoDetailView
            video={selectedVideo}
            onClose={() => setSelectedVideo(null)}
            onResultClick={handleResultClick}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function HomeView({ query, setQuery, onSearch, suggestions, showSuggestions, setShowSuggestions, inputRef, searchContainerRef, user, onLogin, onLogout, onMicClick, bg, isSignoutOpen, setIsSignoutOpen, appsRef, isAppsOpen, setIsAppsOpen, imageQuery, onImageUpload, removeImageQuery, fileInputRef, userHistory, onOpenAnalytics }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}
      className="relative min-h-screen flex flex-col items-center justify-center p-4 md:p-6 bg-slate-900"
    >
      <input type="file" ref={fileInputRef} onChange={onImageUpload} className="hidden" accept="image/*" />
      <div className="absolute inset-0 z-0 opacity-60">
        <img src={bg || "https://picsum.photos/seed/scout-vibe/1920/1080?blur=1"} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        <div className="absolute inset-0 bg-linear-to-b from-black/20 via-transparent to-black/80" />
      </div>

      <header className="absolute top-0 left-0 right-0 p-6 md:p-10 flex items-center justify-between z-50">
        <div className="flex items-center gap-4">
           <span className="font-display font-black text-2xl tracking-tighter bg-clip-text text-transparent bg-linear-to-t from-[#9333ea] to-white drop-shadow-lg">Scout</span>
        </div>
        <div className="flex items-center gap-4">
          <UserProfile user={user} onLogin={onLogin} onLogout={onLogout} isSignoutOpen={isSignoutOpen} setIsSignoutOpen={setIsSignoutOpen} isHome={true} onOpenAnalytics={onOpenAnalytics} />
          <div ref={appsRef}>
            <AppsLauncher isOpen={isAppsOpen} setIsOpen={setIsAppsOpen} isWhite={true} />
          </div>
        </div>
      </header>

      <div className="w-full max-w-2xl space-y-6 md:space-y-10 z-10 text-center">
        <motion.h1 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-4xl md:text-6xl font-display font-black text-white drop-shadow-2xl tracking-tighter"
        >
          Ask Anything.
        </motion.h1>

        <motion.div 
          ref={searchContainerRef}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="relative px-4 w-full max-w-2xl mx-auto"
        >
          <form 
            onSubmit={onSearch}
            className={`flex items-center gap-3 px-5 h-12 md:h-14 transition-all duration-300 bg-white shadow-2xl ${showSuggestions && suggestions.length > 0 ? 'rounded-t-[1.75rem]' : 'rounded-full'}`}
          >
            <Search className="text-slate-400 group-focus-within:text-blue-500 transition-colors" size={22} />
            {imageQuery && (
              <div className="relative group/img ml-4 h-8 w-8 shrink-0 rounded overflow-hidden shadow-sm border border-slate-200">
                <img src={imageQuery} className="w-full h-full object-cover blur-[2px]" />
                <div className="absolute inset-0 bg-[#00000022] backdrop-blur-[1px] grid grid-cols-4 grid-rows-4 opacity-70">
                  {[...Array(16)].map((_, i) => <div key={i} className="border-[0.5px] border-white/20" />)}
                </div>
                <button 
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeImageQuery(); }}
                  className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 flex items-center justify-center transition-opacity"
                >
                  <X size={12} className="text-white" />
                </button>
              </div>
            )}
            <input 
              ref={inputRef} 
              value={query} 
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }} 
              placeholder={imageQuery ? "Visual Search Active" : "Ask Scout anything..."} 
              className="flex-1 bg-transparent border-none outline-none text-slate-900 text-base md:text-lg placeholder:text-slate-400" 
            />
            <div className="flex items-center gap-3">
              {(query || imageQuery) && (
                <X 
                  size={18} 
                  className="text-slate-400 cursor-pointer hover:text-slate-600 transition-colors" 
                  onClick={() => { setQuery(''); removeImageQuery(); }} 
                />
              )}
              <div className="w-px h-5 bg-slate-200 hidden sm:block" />
              <button 
                onClick={() => fileInputRef.current?.click()}
                type="button"
                className={`p-2.5 bg-slate-50 hover:bg-white hover:shadow-md rounded-full transition-all active:scale-95 ${imageQuery ? 'text-blue-600 bg-blue-50' : 'text-blue-500'}`}
                title="Visual Search (Scout Vision)"
              >
                <Camera size={20} />
              </button>
              <button 
                onClick={onMicClick} 
                type="button" 
                className="p-2.5 bg-slate-50 hover:bg-white hover:shadow-md rounded-full text-purple-600 transition-all active:scale-95"
              >
                <Mic size={20} />
              </button>
            </div>
          </form>
          
          <AnimatePresence>
            {showSuggestions && suggestions.length > 0 && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="absolute top-[3.5rem] left-4 right-4 rounded-b-[1.75rem] shadow-2xl border-t border-slate-100 py-4 z-50 text-left overflow-hidden glass"
              >
                {suggestions.map((s: string, i: number) => (
                  <button key={i} onClick={() => { setQuery(s); onSearch(s); setShowSuggestions(false); }} className="w-full px-8 py-3 flex items-center gap-4 text-slate-700 hover:bg-slate-50 transition-colors">
                    <Search size={18} className="text-slate-300" /> <span className="font-medium truncate">{s}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Recently Searched Shelf */}
        {user && userHistory.length > 0 && !showSuggestions && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-4 pt-4"
          >
            <div className="flex items-center gap-2 text-white/50 text-[11px] font-bold uppercase tracking-widest">
              <Sparkles size={12} />
              <span>Recently Searched</span>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {userHistory.slice(-5).reverse().map((h: string, i: number) => (
                <button 
                  key={i} 
                  onClick={() => onSearch(h)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white text-[13px] font-medium transition-all active:scale-95 border border-white/5 whitespace-nowrap"
                >
                  {h}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function VisualMathDisplay({ problem, stage, image, analysis }: any) {
  const stages = [
    { id: 'extracting', label: 'Extracting Text', icon: Camera },
    { id: 'vectorizing', label: 'Neural Mapping', icon: Zap },
    { id: 'ranking', label: 'Solving Problem', icon: Target },
  ];

  const currentStageIndex = stages.findIndex(s => s.id === stage);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-900 rounded-[32px] overflow-hidden mb-8 border border-slate-800 shadow-2xl"
    >
      <div className="flex flex-col md:flex-row">
        <div className="w-full md:w-1/3 aspect-square bg-black relative">
          <img src={image} className="w-full h-full object-contain opacity-60" />
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <div className="flex gap-2 mb-4">
              {stages.map((s, i) => (
                <div 
                  key={s.id} 
                  className={`h-1 w-8 rounded-full transition-colors duration-500 ${i <= currentStageIndex ? 'bg-blue-500' : 'bg-slate-700'}`} 
                />
              ))}
            </div>
            <p className="text-blue-400 text-[10px] font-black uppercase tracking-[0.2em] mb-2">{stages[currentStageIndex]?.label || 'Processing'}</p>
            {stage !== 'idle' && <Loader2 className="animate-spin text-white/20" size={24} />}
          </div>
        </div>
        
        <div className="flex-1 p-8 md:p-10">
          {problem ? (
            <div className="space-y-6">
              <div>
                <h3 className="text-blue-400 text-[10px] font-black uppercase tracking-[0.2em] mb-3">Detected Problem</h3>
                <div className="text-2xl font-display font-bold text-white mb-2">{problem.expression}</div>
                <p className="text-slate-400 text-sm">{problem.description}</p>
              </div>
              
              <div className="p-6 bg-white/5 rounded-2xl border border-white/10">
                <h4 className="text-emerald-400 text-[10px] font-black uppercase tracking-[0.2em] mb-4">Step-by-Step Solution</h4>
                <div className="space-y-4">
                  {problem.steps?.map((step: string, i: number) => (
                    <div key={i} className="flex gap-4 text-slate-300 text-sm leading-relaxed">
                      <span className="text-slate-500 font-bold">{i + 1}.</span>
                      <p>{step}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 pt-6 border-t border-white/10 flex items-center justify-between">
                  <span className="text-white font-bold">Final Result:</span>
                  <span className="text-2xl font-black text-emerald-400">{problem.answer}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 italic py-12">
              <Sparkles className="mb-4 opacity-20" size={40} />
              <p>Scout Vision is analyzing your image...</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
function ResultsView({ query, setQuery, onSearch, loading, results, error, aiOverview, dictionary, knowledgePanel, isEnglishHelp, isOverviewExpanded, setIsOverviewExpanded, faq, openFaqIndex, setOpenFaqIndex, aiLoading, activeTab, setActiveTab, page, totalPages, goHome, user, onLogin, onLogout, onMicClick, suggestions, showSuggestions, setShowSuggestions, searchContainerRef, onResultClick, clickedUrls, isSignoutOpen, setIsSignoutOpen, appsRef, isAppsOpen, setIsAppsOpen, correction, originalQuery, imageQuery, onImageUpload, removeImageQuery, fileInputRef, visualMathProblem, searchStage, visualAnalysis, setImageQuery, selectedImage, setSelectedImage, selectedVideo, setSelectedVideo, aiRateLimited, onOpenAnalytics, directAnswer, scoutKnowledge }: any) {
  // Helper to check if a URL is an image
  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url.split('?')[0]);
  const isVideoUrl = (url: string) => url.includes('youtube.com/watch?v=') || url.includes('youtu.be/');
  // Group images by domain for the carousel
  const carouselImages = results.filter((res: any) => isImageUrl(res.url));

  const filteredResults = activeTab === 'images' 
    ? results.filter((res: any) => isImageUrl(res.url) || res.image)
    : results.filter((res: any) => !isImageUrl(res.url)); // Keep 'all' list focused on webpages, but results still contains images

  const videoResults = results.filter((res: any) => res.is_video);


  // Group results by domain (simple grouping)
  const groupedResults: any[] = [];
  const processedDomains = new Set();
  const maxNested = 3; // Nesting limit
  
  if (activeTab === 'all') {
    results.filter((res: any) => !isImageUrl(res.url)).forEach((res: any) => {
      // Normalize domain for reliable grouping (remove www. and lowercase)
      const groupKey = res.displayUrl.toLowerCase().replace(/^www\./, '');
      
      if (processedDomains.has(groupKey)) return;

      // Find all results for this domain in the full results set
      const domainMatches = results.filter((r: SearchResult) => 
        !isImageUrl(r.url) &&
        r.displayUrl.toLowerCase().replace(/^www\./, '') === groupKey
      );
      
      if (domainMatches.length > 1) {
        // Create a group with a primary and secondary results
        groupedResults.push({
          type: 'group',
          primary: domainMatches[0],
          secondaries: domainMatches.slice(1).slice(0, maxNested)
        });
      } else {
        groupedResults.push({ type: 'single', result: res });
      }
      processedDomains.add(groupKey);
    });
  } else if (activeTab === 'videos') {
    videoResults.forEach((res: SearchResult) => groupedResults.push({ type: 'single', result: res }));
  } else {
    // For images and news tabs, don't group or use simple list
    // Note: news tab results are already filtered by the backend
    filteredResults.forEach((res: SearchResult) => groupedResults.push({ type: 'single', result: res }));
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-screen bg-white">
      <input type="file" ref={fileInputRef} onChange={onImageUpload} className="hidden" accept="image/*" />
      <header className="bg-white border-b border-slate-50 sticky top-0 z-50">
        <div className="flex flex-col sm:flex-row items-center gap-4 md:gap-12 py-6 sm:py-8 px-4 md:px-12 max-w-[1700px] mx-auto transition-all">
          <div className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-4">
            <div onClick={goHome} className="flex items-center gap-2 cursor-pointer shrink-0">
               <span className="font-display font-black text-2xl tracking-tighter bg-clip-text text-transparent bg-linear-to-t from-[#9333ea] to-[#3b0764]">Scout</span>
            </div>
            
            <div className="flex sm:hidden items-center gap-4">
              <div ref={appsRef}>
                <AppsLauncher isOpen={isAppsOpen} setIsOpen={setIsAppsOpen} />
              </div>
              <div className="flex-shrink-0">
                <UserProfile user={user} onLogin={onLogin} onLogout={onLogout} isSignoutOpen={isSignoutOpen} setIsSignoutOpen={setIsSignoutOpen} />
              </div>
            </div>
          </div>
          
          <div className="flex-1 w-full max-w-2xl relative" ref={searchContainerRef}>
            <form onSubmit={onSearch} className={`flex items-center gap-2 px-6 h-12 soft-ui transition-all ${showSuggestions && suggestions.length > 0 ? 'rounded-t-2xl' : 'rounded-full'}`}>
              {imageQuery && (
                <div className="relative group/resimg mr-2 h-6 w-6 shrink-0 rounded overflow-hidden shadow-xs border border-slate-100">
                  <img src={imageQuery} className="w-full h-full object-cover blur-[1.5px]" />
                  <div className="absolute inset-0 bg-[#00000011] backdrop-blur-[0.5px] grid grid-cols-4 grid-rows-4 opacity-60">
                    {[...Array(16)].map((_, i) => <div key={i} className="border-[0.25px] border-white/20" />)}
                  </div>
                </div>
              )}
              <input 
                value={query} 
                onFocus={() => setShowSuggestions(true)} 
                onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }} 
                placeholder={imageQuery ? "Image search active" : "Search Scout..."}
                className="flex-1 bg-transparent border-none outline-none text-slate-800 font-medium text-sm md:text-base min-w-0" 
              />
              <div className="flex items-center gap-3">
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`p-2 hover:bg-slate-50 rounded-full transition-all ${imageQuery ? 'text-blue-500 bg-blue-50' : 'text-slate-400'}`}
                >
                  <Camera size={16} />
                </button>
                <button 
                  type="button" 
                  onClick={onMicClick}
                  className="p-2 hover:bg-white hover:shadow-sm rounded-full text-purple-600 transition-all active:scale-95"
                >
                  <Mic size={18} />
                </button>
                <div className="w-px h-4 bg-slate-200 mx-1" />
                <Search size={18} className="text-purple-600 cursor-pointer hover:scale-110 transition-transform" onClick={(ev) => onSearch(ev)} />
              </div>
            </form>
            <AnimatePresence>
              {showSuggestions && suggestions.length > 0 && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="absolute top-11 left-0 right-0 border border-slate-200 border-t-0 rounded-b-2xl shadow-xl z-[2100] overflow-hidden glass"
                >
                  {suggestions.map && suggestions.map((s: string, i: number) => (
                    <button 
                      key={i} 
                      onClick={() => { setQuery(s); onSearch(s); setShowSuggestions(false); }}
                      className="w-full px-5 py-3 flex items-center gap-3 text-slate-700 hover:bg-slate-50 transition-colors text-left"
                    >
                      <Search size={14} className="text-slate-400" />
                      <span className="font-medium text-sm">{s}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <div ref={appsRef}>
              <AppsLauncher isOpen={isAppsOpen} setIsOpen={setIsAppsOpen} />
            </div>
            <div className="flex-shrink-0">
              <UserProfile user={user} onLogin={onLogin} onLogout={onLogout} isSignoutOpen={isSignoutOpen} setIsSignoutOpen={setIsSignoutOpen} />
            </div>
          </div>
        </div>
        <div className="px-4 md:px-8 lg:px-24 xl:px-[170px] max-w-[1700px] border-t border-slate-50 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-8 pt-4">
            {['All', 'Images', 'Videos', 'News'].map(tab => (
              <button key={tab} className={`pb-3 text-sm font-bold border-b-2 transition-all ${activeTab === tab.toLowerCase() ? 'text-blue-600 border-blue-600' : 'text-slate-400 border-transparent hover:text-slate-700'}`} onClick={() => setActiveTab(tab.toLowerCase())}>{tab}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className={`flex flex-col lg:flex-row gap-12 p-4 md:p-8 lg:px-24 xl:px-[170px] max-w-[1700px]`}>
          {activeTab === 'all' && knowledgePanel && (
            <aside className="order-1 lg:order-2 space-y-8 w-full lg:w-[400px]">
               <motion.div 
                 initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                 className="bg-white border border-slate-100 rounded-3xl overflow-hidden sticky top-36"
               >
                 <div className="p-6 md:p-8">
                   <h2 className="text-3xl font-display font-medium text-slate-900 mb-1">{knowledgePanel.title}</h2>
                   <p className="text-slate-500 mb-6">{knowledgePanel.subtitle}</p>
                   
                   {knowledgePanel.image && (
                     <div className="aspect-video w-full rounded-2xl overflow-hidden mb-6 -mx-2">
                       <img src={knowledgePanel.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                     </div>
                   )}

                   <div className="space-y-6">
                     <div className="pb-6 border-b border-slate-50">
                        <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">About</h4>
                        <p className="text-slate-600 leading-relaxed text-[15px]">{knowledgePanel.description}</p>
                     </div>
                     
                     <div className="space-y-4">
                       {knowledgePanel.details && knowledgePanel.details.map && knowledgePanel.details.map((detail: any, i: number) => (
                         <div key={i} className="flex gap-4">
                           <span className="font-bold text-slate-400 min-w-[80px]">{detail.label}:</span>
                           <span className="text-slate-900">{detail.value}</span>
                         </div>
                       ))}
                     </div>
                   </div>
                 </div>
               </motion.div>
            </aside>
          )}

          <div className="w-full max-w-3xl space-y-6 order-2 lg:order-1">
            {/* Autocorrect / Did you mean */}
            {correction && (
              <div className="mb-10 animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="flex flex-col gap-1.5">
                  <p className="text-[19px] text-slate-900 leading-none">
                    <span className="font-normal text-slate-700">Showing results for </span>
                    <button 
                      onClick={() => { setQuery(correction); onSearch(correction); }}
                      className="text-[#1a0dab] hover:underline font-bold italic decoration-2 underline-offset-4"
                    >
                      {correction}
                    </button>
                  </p>
                  {originalQuery && (
                    <p className="text-[14px] text-slate-600 font-medium">
                      Search instead for <button onClick={() => { setQuery(originalQuery); onSearch(originalQuery); }} className="text-[#1a0dab] hover:underline italic">{originalQuery}</button>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Visual Math Analysis Display */}
            {imageQuery && (
              <VisualMathDisplay problem={visualMathProblem} stage={searchStage} image={imageQuery} analysis={visualAnalysis} />
            )}

            {/* Scout Knowledge Graph Card (Redis) */}
            {activeTab === 'all' && scoutKnowledge && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="backdrop-blur-xl bg-blue-600/5 rounded-[32px] p-8 mb-6 relative overflow-hidden group"
              >
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Category: {scoutKnowledge.category}</span>
                    </div>
                    {scoutKnowledge.image && (
                      <img src={scoutKnowledge.image} className="w-16 h-16 rounded-2xl object-cover border border-white/40 shadow-xl" referrerPolicy="no-referrer" />
                    )}
                  </div>
                  <h2 className="text-3xl font-display font-bold text-slate-900 mb-4">{scoutKnowledge.title}</h2>
                  <p className="text-slate-600 text-lg leading-relaxed mb-6 line-clamp-4">{scoutKnowledge.description}</p>
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-widest pt-6 border-t border-slate-100">
                    <div className="flex gap-4">
                      <span>Source: {scoutKnowledge.source}</span>
                      {scoutKnowledge.url && (
                        <a href={scoutKnowledge.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                          Wikipedia <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                    <span>Learned: {new Date(scoutKnowledge.learnedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </motion.div>
            )}

            {/* AI Overview */}
            {activeTab === 'all' && (aiLoading || aiOverview) && (
              <div className={`glass rounded-[32px] p-6 md:p-8 mb-6 overflow-hidden shadow-none ${isEnglishHelp ? 'border-none' : 'border border-white/40'}`}>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2 opacity-70">
                    <Sparkles size={14} className="text-blue-500 fill-blue-500" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {isEnglishHelp ? 'English Help' : 'AI Overview'}
                    </span>
                  </div>
                </div>
                
                {aiLoading ? (
                  <div className="space-y-4 animate-pulse">
                    <div className="h-4 bg-slate-200/50 rounded w-full"/>
                    <div className="h-4 bg-slate-200/50 rounded w-5/6"/>
                    <div className="h-4 bg-slate-200/50 rounded w-4/6"/>
                  </div>
                ) : aiOverview && (
                  <div className="relative">
                    <div className={`text-slate-800 text-[16px] md:text-[17px] font-normal leading-relaxed prose prose-slate prose-p:my-5 prose-headings:font-black prose-headings:text-slate-900 prose-li:my-2 prose-table:border prose-table:border-slate-200 prose-th:bg-slate-100 prose-th:p-3 prose-td:p-3 prose-td:border prose-td:border-slate-100 prose-img:rounded-3xl prose-img:shadow-lg prose-img:my-8 prose-img:mx-auto prose-img:max-h-[400px] transition-all duration-500 overflow-hidden ${!isOverviewExpanded ? 'max-h-[300px]' : 'max-h-none'}`} 
                         style={{ maskImage: !isOverviewExpanded ? 'linear-gradient(to bottom, black 80%, transparent 100%)' : 'none', WebkitMaskImage: !isOverviewExpanded ? 'linear-gradient(to bottom, black 80%, transparent 100%)' : 'none' }}>
                      <Markdown 
                        remarkPlugins={[remarkGfm]} 
                        components={{
                          img: ({ ...props }) => (
                            <img 
                              {...props} 
                              className="w-full max-w-lg aspect-video object-cover rounded-3xl border border-slate-100 shadow-sm transition-transform hover:scale-[1.02] cursor-zoom-in" 
                              referrerPolicy="no-referrer"
                            />
                          )
                        }}
                      >
                        {aiOverview.summary}
                      </Markdown>
                    </div>
                    
                    <div className={`relative flex items-center justify-center ${!isOverviewExpanded ? 'mt-[-15px]' : 'mt-8'} mb-8`}>
                      <div className="absolute inset-x-0 h-px bg-slate-100 z-0" />
                      <button 
                        onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
                        className="relative z-10 text-[13px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-2 px-6 py-2 bg-[#e8edff] rounded-full hover:bg-[#dee5ff] transition-all active:scale-95 shadow-sm"
                      >
                        {isOverviewExpanded ? 'Read less' : 'Read more'}
                        <ChevronRight size={14} className={isOverviewExpanded ? '-rotate-90' : 'rotate-90'} />
                      </button>
                    </div>

                    {/* Source Attribution Cards (Imitating Google Search style cards) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {aiOverview.sources?.map && aiOverview.sources.slice(0, 3).map((source: any, i: number) => (
                        <a 
                          key={i} 
                          href={source.url} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="flex flex-col gap-3 p-4 bg-slate-50/80 rounded-2xl hover:bg-slate-100/80 border border-transparent hover:border-slate-200 transition-all group"
                        >
                          <div className="flex items-center gap-2">
                             <img src={`https://www.google.com/s2/favicons?domain=${new URL(source.url).hostname}&sz=32`} className="w-4 h-4 rounded-full" />
                             <span className="text-[12px] text-slate-500 font-medium truncate">{new URL(source.url).hostname.replace('www.', '')}</span>
                          </div>
                          <h4 className="text-[14px] font-bold text-slate-800 line-clamp-2 leading-snug group-hover:text-blue-700 transition-colors">{source.title}</h4>
                        </a>
                      ))}
                      {aiOverview.sources && aiOverview.sources.length > 3 && (
                        <button className="flex flex-col items-center justify-center gap-2 p-4 bg-slate-50/80 rounded-2xl border border-transparent hover:border-slate-200 hover:bg-slate-100/80 transition-all font-bold text-[13px] text-blue-600">
                           <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-blue-600 shadow-sm border border-slate-100">
                             <ChevronRight size={16} />
                           </div>
                           View all
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Oxford Dictionary Integration */}
            {activeTab === 'all' && dictionary && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white border-2 border-slate-100 rounded-3xl p-6 transition-all mb-4"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-2xl font-display font-bold text-slate-900">{dictionary.word}</h2>
                      <span className="text-slate-400 font-medium italic text-base">{dictionary.phonetic}</span>
                      {dictionary.audio && (
                        <button 
                          onClick={() => {
                            const audio = new Audio(dictionary.audio);
                            audio.play().catch(console.error);
                          }}
                          className="p-1.5 hover:bg-slate-100 rounded-full text-blue-600 transition-colors active:scale-90"
                          title="Listen"
                        >
                          <Mic size={16} />
                        </button>
                      )}
                    </div>
                    <span className="inline-block px-3 py-1 bg-slate-100 rounded-full text-slate-500 text-[10px] font-bold uppercase tracking-wider">{dictionary.class}</span>
                  </div>
                  <div className="text-slate-200 font-display font-bold text-lg italic">Oxford</div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-slate-800 text-[15px] leading-relaxed mb-3 font-normal">
                      {dictionary.definition}
                    </p>
                    {dictionary.example && (
                      <p className="text-slate-500 italic pl-4 border-l-2 border-slate-200">"{dictionary.example}"</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Synonyms</h4>
                      <div className="flex flex-wrap gap-2">
                        {dictionary.synonyms?.map((s: string, i: number) => (
                           <span key={i} className="text-blue-600 hover:underline cursor-pointer text-sm font-medium">{s}{i < dictionary.synonyms.length - 1 ? ',' : ''}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Antonyms</h4>
                      <div className="flex flex-wrap gap-2">
                        {dictionary.antonyms?.map((s: string, i: number) => (
                           <span key={i} className="text-slate-600 text-sm font-medium">{s}{i < dictionary.antonyms.length - 1 ? ',' : ''}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {aiRateLimited && (
              <div className="p-6 bg-amber-50 border border-amber-100 rounded-3xl flex items-start gap-4">
                <div className="p-2 bg-amber-100 rounded-xl text-amber-600">
                  <Zap size={20} />
                </div>
                <div>
                  <h4 className="text-[15px] font-bold text-amber-900 mb-1">AI Overview hitting limits</h4>
                  <p className="text-[13px] text-amber-800 leading-relaxed font-medium">Scout's neural generators are processing a high volume of requests. AI Overviews and FAQs are temporarily limited to preserve search speed. Please try again in 60 seconds.</p>
                </div>
              </div>
            )}
            
            {/* Video Results Display */}
            {activeTab === 'videos' && videoResults.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
                {videoResults.map((res: any, idx: number) => (
                  <div 
                    key={res.id} 
                    onClick={() => {
                      setSelectedVideo(res);
                      onResultClick(res.id, res.url, idx + 1);
                    }} 
                    className="group relative aspect-video bg-slate-100 rounded-2xl overflow-hidden hover:shadow-xl transition-all border border-slate-200 cursor-pointer"
                  >
                    <img src={res.thumbnail_url || res.image} className="w-full h-full object-cover transition-transform group-hover:scale-105" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                      <span className="text-white text-sm font-medium truncate">{res.title}</span>
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><PlayCircle size={48} className="text-white/80" /></div>
                  </div>
                ))}
              </div>
            ) : null}

            {loading ? (
              <div className="space-y-6">
                {[1,2,3].map(i => <div key={i} className="animate-pulse space-y-3 p-6 bg-white rounded-3xl border border-slate-100"><div className="h-4 bg-slate-100 rounded w-1/4" /><div className="h-6 bg-slate-100 rounded w-3/4" /><div className="h-20 bg-slate-100 rounded w-full" /></div>)}
              </div>
            ) : filteredResults.length > 0 ? (
              activeTab === 'images' ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-6 duration-700">
                  {filteredResults.map((res: any, idx: number) => (
                    <div 
                      key={res.id} 
                      onClick={() => {
                        setSelectedImage(res);
                        onResultClick(res.id, res.url, idx + 1);
                      }} 
                      className="group relative aspect-square bg-slate-100 rounded-2xl overflow-hidden hover:shadow-xl transition-all border border-slate-200 cursor-pointer"
                    >
                      <img src={isImageUrl(res.url) ? res.url : res.image} className="w-full h-full object-cover transition-transform group-hover:scale-105" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                        <span className="text-white text-xs font-medium truncate">{res.title}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-8 md:space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
                  {groupedResults.map((item: any, idx: number) => (
                    <React.Fragment key={item.type === 'single' ? item.result.id : item.primary.id}>
                      {/* Image Strip after 1st result */}
                      {idx === 1 && (
                        <ImageStrip 
                          results={results.filter((res: any) => res.image && !res.is_video)} 
                          onMore={() => setActiveTab('images')} 
                          onImageClick={(img: any, pos: number) => { setSelectedImage(img); onResultClick?.(img.id, img.url, pos); }} 
                        />
                      )}

                      {/* First FAQ after 3 results */}
                      {idx === 3 && faq.length > 0 && (
                        <FAQBlock faq={faq.slice(0, 3)} openFaqIndex={openFaqIndex} setOpenFaqIndex={setOpenFaqIndex} />
                      )}
                      {/* Second FAQ after 7 results */}
                      {idx === 7 && faq.length > 3 && (
                        <FAQBlock faq={faq.slice(3)} openFaqIndex={openFaqIndex} setOpenFaqIndex={setOpenFaqIndex} />
                      )}
                      
                      {item.type === 'single' ? (
                        <ResultCard res={item.result} position={idx + 1} carouselImages={carouselImages} isImageUrl={isImageUrl} onResultClick={onResultClick} clickedUrls={clickedUrls} onVisualSearch={(img: string) => { setImageQuery(img); onSearch('Visual Search', 1, img); }} onImageClick={(img: any) => setSelectedImage(img)} />
                      ) : (
                        <div className="space-y-4 py-4 mb-8">
                          <ResultCard res={item.primary} position={idx + 1} carouselImages={carouselImages} isImageUrl={isImageUrl} onResultClick={onResultClick} clickedUrls={clickedUrls} onVisualSearch={(img: string) => { setImageQuery(img); onSearch('Visual Search', 1, img); }} onImageClick={(img: any) => setSelectedImage(img)} />
                          <div className="ml-4 sm:ml-12 flex flex-col -mt-4">
                            <div className="border-t border-slate-100 mt-2 mb-4" />
                            <div className="space-y-0">
                              {item.secondaries.map((s: any, sIdx: number) => (
                                <div key={s.id} className="group/sub">
                                  <a 
                                    onClick={() => onResultClick?.(s.id, s.url, idx + 1)} 
                                    href={s.url} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    className="flex items-center justify-between py-4 group-hover/sub:bg-slate-50 transition-all px-4 -mx-4 rounded-xl"
                                  >
                                    <div className="flex-1 min-w-0 pr-8">
                                      <h4 className="text-[17px] font-display font-medium text-[#1a0dab] group-hover/sub:underline line-clamp-1">{s.title}</h4>
                                      <p className="text-slate-600 text-[14px] line-clamp-2 mt-1 leading-relaxed">{s.snippet}</p>
                                    </div>
                                    <ChevronRight size={18} className="text-slate-400 shrink-0 opacity-0 group-hover/sub:opacity-100 group-hover/sub:translate-x-1 transition-all" />
                                  </a>
                                  {sIdx < item.secondaries.length - 1 && (
                                    <div className="border-t border-slate-100 ml-4 h-px" />
                                  )}
                                </div>
                              ))}
                            </div>
                            <div className="border-t border-slate-100 mt-4 mb-2" />
                            <button 
                              onClick={() => { setQuery(`site:${item.primary.displayUrl}`); onSearch(`site:${item.primary.displayUrl}`); }}
                              className="text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center gap-2 mt-4 px-3 py-1.5 hover:bg-slate-50 w-fit rounded-lg transition-all border border-transparent hover:border-slate-100"
                            >
                              More results from {item.primary.displayUrl.replace('www.', '')} <ArrowRight size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )
            ) : <div className="py-20 text-center text-slate-400 font-medium italic">No results found for your query.</div>}

            {totalPages > 1 && !loading && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-6 py-12 border-t border-slate-100 mt-8 mb-10 overflow-hidden">
                <div className="flex items-center gap-1.5 order-2 sm:order-1">
                  <button 
                    onClick={() => onSearch(undefined, Math.max(1, page - 1))} 
                    disabled={page === 1} 
                    className="h-10 px-4 rounded-xl hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-all font-bold text-xs uppercase tracking-widest text-slate-500 border border-transparent hover:border-slate-200"
                  >
                    Prev
                  </button>
                  
                  <div className="flex gap-1">
                    {(() => {
                      const pages = [];
                      const startPage = Math.max(1, page - 2);
                      const endPage = Math.min(totalPages, startPage + 4);
                      const actualStart = Math.max(1, endPage - 4);
                      
                      for (let i = actualStart; i <= endPage; i++) {
                        pages.push(
                          <button 
                            key={i} 
                            onClick={() => onSearch(undefined, i)} 
                            className={`w-10 h-10 rounded-xl font-black text-sm transition-all ${page === i ? 'bg-[#1a73e8] text-white shadow-lg shadow-blue-200' : 'hover:bg-slate-50 text-slate-600'}`}
                          >
                            {i}
                          </button>
                        );
                      }
                      return pages;
                    })()}
                  </div>

                  <button 
                    onClick={() => onSearch(undefined, Math.min(totalPages, page + 1))} 
                    disabled={page === totalPages} 
                    className="h-10 px-4 rounded-xl hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-all font-bold text-xs uppercase tracking-widest text-slate-500 border border-transparent hover:border-slate-200"
                  >
                    Next
                  </button>
                </div>
                
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest order-1 sm:order-2">
                  Page <span className="text-slate-900">{page}</span> of {totalPages}
                </div>
              </div>
            )}
          </div>


        </div>
      </main>
    </motion.div>
  );
}

function QuickSummary({ text }: { text: string }) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      if (!API_KEY || API_KEY === 'AI-NOT-SET') {
        if (isMounted) { setSummary(text); setLoading(false); }
        return;
      }
      try {
        const prompt = `Summarize precisely in one short sentence (max 15 words): "${text}"`;
        const res = await genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });
        if (isMounted) setSummary(res.text || text);
      } catch {
        if (isMounted) setSummary(text); // Fallback to snippet
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, [text]);

  return (
    <div className="mt-4 p-5 bg-[#f8fbff] rounded-2xl border border-blue-50/50 hover:bg-blue-50 transition-colors max-w-sm shrink-0 shadow-xs min-h-[100px] flex flex-col">
      <div className="flex items-center justify-between mb-3 leading-none">
        <div className="flex items-center gap-2 text-[10px] font-bold text-blue-400 uppercase tracking-[0.2em]">
          Quick Summary
        </div>
        {loading && <div className="w-4 h-4 rounded-full border-2 border-blue-400/20 border-t-blue-500 animate-spin" />}
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-4 bg-blue-100/50 rounded w-full animate-pulse" />
          <div className="h-4 bg-blue-100/50 rounded w-5/6 animate-pulse" />
        </div>
      ) : (
        <p className="text-[13px] text-slate-700 leading-relaxed line-clamp-3 italic">
          {summary || text}
        </p>
      )}
    </div>
  );
}

function ImageStrip({ results, onMore, onImageClick }: { results: SearchResult[], onMore: () => void, onImageClick?: (img: any, pos: number) => void }) {
  const imagesWithMeta = results.filter(r => r.image).slice(0, 8);
  if (imagesWithMeta.length < 3) return null;

  return (
    <div className="py-8 border-b border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between mb-5 px-1">
        <h2 className="text-xl md:text-2xl font-display font-medium text-slate-900">Images for {results[0]?.title.split(' ')[0] || 'your search'}</h2>
        <button 
          onClick={onMore} 
          className="text-white bg-[#1a73e8] hover:bg-blue-700 px-5 py-2 rounded-full text-[12px] font-bold flex items-center gap-1 shadow-md shadow-blue-100"
        >
          View all <ChevronRight size={14} />
        </button>
      </div>
      <div className="flex gap-3 md:gap-4 overflow-x-auto pb-6 scrollbar-hide -mx-4 px-4 snap-x">
        {imagesWithMeta.map((img, idx) => (
          <div key={img.id} onClick={(e) => { e.preventDefault(); onImageClick?.(img, idx + 1); }} className="shrink-0 w-40 sm:w-52 h-full group snap-start cursor-pointer">
            <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 border border-slate-100 transition-all group-hover:shadow-xl group-hover:-translate-y-1">
              <img src={img.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt={img.title} />
            </div>
            <div className="mt-2 text-[12px] font-medium text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors">{img.title}</div>
            <div className="mt-1 text-[10px] text-slate-400 line-clamp-1 flex items-center gap-1.5 font-bold uppercase tracking-wider">
               {img.displayUrl.replace('www.', '')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// New VideoStrip component
function VideoStrip({ results, onMore, onVideoClick }: { results: SearchResult[], onMore: () => void, onVideoClick?: (vid: any, pos: number) => void }) {
  const videosWithMeta = results.filter(r => r.is_video).slice(0, 8);
  if (videosWithMeta.length < 3) return null;

  return (
    <div className="py-8 border-b border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between mb-5 px-1">
        <h2 className="text-xl md:text-2xl font-display font-medium text-slate-900">Videos for {results[0]?.title.split(' ')[0] || 'your search'}</h2>
        <button 
          onClick={onMore} 
          className="text-white bg-[#1a73e8] hover:bg-blue-700 px-5 py-2 rounded-full text-[12px] font-bold flex items-center gap-1 shadow-md shadow-blue-100"
        >
          View all <ChevronRight size={14} />
        </button>
      </div>
      <div className="flex gap-3 md:gap-4 overflow-x-auto pb-6 scrollbar-hide -mx-4 px-4 snap-x">
        {videosWithMeta.map((vid, idx) => (
          <div key={vid.id} onClick={(e) => { e.preventDefault(); onVideoClick?.(vid, idx + 1); }} className="shrink-0 w-40 sm:w-52 h-full group snap-start cursor-pointer">
            <div className="aspect-[16/9] rounded-2xl overflow-hidden bg-slate-100 border border-slate-100 transition-all group-hover:shadow-xl group-hover:-translate-y-1 relative">
              <img src={vid.thumbnail_url || vid.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt={vid.title} />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                <PlayCircle size={36} className="text-white/90" />
              </div>
            </div>
            <div className="mt-2 text-[12px] font-medium text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors">{vid.title}</div>
            <div className="mt-1 text-[10px] text-slate-400 line-clamp-1 flex items-center gap-1.5 font-bold uppercase tracking-wider">
               {vid.source || vid.displayUrl.replace('www.', '')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}




function AppsLauncher({ isOpen, setIsOpen, isWhite }: { isOpen: boolean, setIsOpen: (v: boolean) => void, isWhite?: boolean }) {
  const apps = [
    { name: 'Search', url: 'https://komu-search.streamlit.app/', icon: 'https://komuhost.vercel.app/favicon.ico' },
    { name: 'Dashboard', url: 'https://komuthemedashboard.vercel.app/', icon: 'https://komuhost.vercel.app/favicon.ico' },
    { name: 'Calendar', url: 'https://komucalendar.vercel.app/', icon: 'https://komuhost.vercel.app/calendarlogo.png' },
    { name: 'Notes', url: 'https://komunotes.vercel.app/', icon: 'https://komuhost.vercel.app/favicon.ico' },
    { name: 'Forum', url: 'https://forum-bykomu.vercel.app/', icon: 'https://komuhost.vercel.app/favicon.ico' },
  ];

  return (
    <div className="apps-wrapper">
      <button className={`apps-btn ${isWhite ? 'text-white hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setIsOpen(!isOpen)} title="Komu Apps">
        <LayoutGrid size={24} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="apps-menu"
          >
            <div className="apps-grid">
              {apps.map((app, i) => (
                <a key={i} href={app.url} target="_blank" rel="noreferrer" className="app-item">
                  <img src={app.icon} alt={app.name} referrerPolicy="no-referrer" />
                  <span>{app.name}</span>
                </a>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserProfile({ user, onLogin, onLogout, isSignoutOpen, setIsSignoutOpen, isHome, onOpenAnalytics }: any) {
  const isAdmin = user && ['komumech@gmail.com'].includes(user.email);

  return (
    <div className="relative">
      {user ? (
        <div className="relative">
          <img 
            src={user.picture} 
            className={`w-9 h-9 md:w-10 md:h-10 rounded-full cursor-pointer transition-all ${isHome ? 'ring-2 ring-white/20 hover:ring-white/40' : 'border border-slate-100 shadow-sm hover:ring-2 hover:ring-blue-100 font-bold'}`} 
            onClick={() => setIsSignoutOpen(!isSignoutOpen)}
          />
          <AnimatePresence>
            {isSignoutOpen && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className={`absolute top-12 right-0 w-64 bg-white rounded-2xl shadow-2xl p-4 z-[100] text-slate-800 border ${isHome ? 'border-transparent' : 'border-slate-100'}`}
              >
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                  <img src={user.picture} className="w-10 h-10 rounded-full" />
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{user.name}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                </div>
                
                {isAdmin && (
                  <button 
                    onClick={() => { setIsSignoutOpen(false); onOpenAnalytics(); }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors font-medium text-sm mb-1"
                  >
                    <BarChart3 size={16} /> Admin Analytics
                  </button>
                )}

                <button 
                  onClick={onLogout}
                  className="w-full flex items-center gap-3 px-3 py-2 text-red-600 hover:bg-red-50 rounded-xl transition-colors font-medium text-sm"
                >
                  <LogOut size={16} /> Sign out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <button 
          onClick={onLogin} 
          className={isHome 
            ? "bg-white/10 hover:bg-white/20 px-5 py-2 rounded-full text-white text-sm font-bold border border-white/20 transition-all whitespace-nowrap" 
            : "text-sm md:text-base font-bold text-blue-600 hover:underline px-2 whitespace-nowrap"
          }
        >
          Sign in
        </button>
      )}
    </div>
  );
}

function FAQBlock({ faq, openFaqIndex, setOpenFaqIndex }: any) {
  return (
    <div className="py-6 border-y border-slate-100 animate-in fade-in duration-500">
      <h4 className="font-display font-bold text-slate-800 text-xl mb-4">People also ask</h4>
      <div className="divide-y divide-slate-100">
        {faq.map((item: any, i: number) => (
          <div key={i} className="py-4">
            <button 
              onClick={() => openFaqIndex === item.question ? setOpenFaqIndex(null) : setOpenFaqIndex(item.question)}
              className="w-full flex items-center justify-between text-left group"
            >
              <span className="text-base md:text-lg font-normal text-slate-800 group-hover:text-blue-600 transition-colors">
                {item.question}
              </span>
              <ChevronRight 
                size={18} 
                className={`text-slate-400 transition-transform duration-300 ${openFaqIndex === item.question ? 'rotate-90' : ''}`} 
              />
            </button>
            <AnimatePresence>
              {openFaqIndex === item.question && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-3 pb-2 text-[15px] text-slate-600 leading-relaxed mt-2 p-2">
                    {item.answer}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ res, position, carouselImages, isImageUrl, onResultClick, clickedUrls, onVisualSearch, onImageClick, onVideoClick }: any) {
  // Check if previously clicked
  const isPreviouslyClicked = clickedUrls?.includes(res.url);

  // Normalize domain for comparison
  const normalizeDomain = (d: string) => d.toLowerCase().replace(/^www\./, '');
  const resDomain = normalizeDomain(res.displayUrl);
  
  const domainImages = carouselImages.filter((img: any) => normalizeDomain(img.displayUrl) === resDomain);
  const [currentImgIndex, setCurrentImgIndex] = React.useState(0);

  // Auto-slide carousel if multiple images exist
  useEffect(() => {
    if (domainImages.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentImgIndex((prev) => (prev + 1) % domainImages.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [domainImages.length]);

  // Better site name extraction
  const parts = res.displayUrl.toLowerCase().split('.');
  const siteName = parts[0] === 'www' ? parts[1] || parts[0] : parts[0];
  const displaySiteName = siteName.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

  const activeImage = domainImages.length > 0 ? (domainImages[currentImgIndex].url || domainImages[currentImgIndex].image) : res.image;

  return (
    <article className="group py-5 transition-all border-b border-slate-100 last:border-0 pl-0 overflow-hidden">
      {isPreviouslyClicked && (
        <div className="flex items-center gap-2 text-xs font-bold text-blue-600 mb-3 px-1">
          <Sparkles size={12} strokeWidth={3} />
          <span>You visited this previously</span>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-slate-100 bg-slate-50 flex items-center justify-center p-1.5 shadow-sm">
                <img 
                  src={res.sourceIcon} 
                  className="w-full h-full object-contain" 
                  referrerPolicy="no-referrer" 
                  onError={(e:any) => { e.target.src=`https://www.google.com/s2/favicons?domain=${res.displayUrl}&sz=64`; }} 
                />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] text-slate-800 font-medium leading-tight truncate">{displaySiteName}</span>
                <div className="flex items-center gap-1 text-[12px] text-slate-500 leading-tight max-w-full overflow-hidden">
                  <span className="truncate">
                    {res.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} {/* Display full URL without protocol */}
                  </span>
                  <ChevronRight size={12} className="shrink-0" />
                </div>
              </div>
            </div>
          </div>

          <div className="relative group/title inline-block">
            <a onClick={() => onResultClick?.(res.id, res.url, position)} href={res.url} target="_blank" rel="noreferrer" className="block mb-2">
              <h3 className="text-xl md:text-2xl font-display font-medium text-[#1a0dab] group-hover:underline leading-tight line-clamp-2">
                {res.title}
              </h3>
            </a>
          </div>

          <p className="text-slate-600 text-[15px] leading-relaxed line-clamp-3 mb-4">
            {res.snippet}
          </p>

          <div className="flex items-center gap-4 flex-wrap">
            {/* Find Similar Button */}
            {activeImage && (
              <button 
                onClick={() => onVisualSearch?.(activeImage)}
                className="flex items-center gap-1.5 text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-all active:scale-95 border border-blue-100"
              >
                <Camera size={12} />
                Find similar
              </button>
            )}

            {/* Site Summary for specific sources */}
            {(res.displayUrl.includes('wikipedia.org') || res.isNews || res.displayUrl.includes('medium.com') || res.displayUrl.includes('nytimes.com') || res.displayUrl.includes('bbc.com') || res.displayUrl.includes('theguardian.com')) && (
               <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                  <Sparkles size={11} className="text-blue-400" />
                  AI Summary Available
               </div>
            )}
          </div>

          {/* Play Video Button if it's a video result */}
          {res.is_video && res.embed_url && (
            <button 
              onClick={() => onVideoClick?.(res)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-purple-600 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-full transition-all active:scale-95 border border-purple-100 mt-4"
            >
              <PlayCircle size={12} />
              Watch Video
            </button>
          )}

          {/* Inline miniature strip */}
          {domainImages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide py-3 mt-2">
              {domainImages.slice(0, 8).map((img: any, i: number) => (
                <button 
                  key={img.id} 
                  onClick={() => {
                    setCurrentImgIndex(i);
                    // Optionally, if you want to open the image detail view on click of a thumbnail:
                    // onImageClick?.(img);
                  }}
                  className={`shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-all ${currentImgIndex === i ? 'border-blue-500 scale-105 shadow-md z-10' : 'border-transparent opacity-60 hover:opacity-100'}`}
                >
                  <img src={img.url || img.image} title={img.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Main Side Image / Carousel */}
        {activeImage && (
          <div 
            onClick={() => {
              if (res.is_video) {
                onVideoClick?.(res);
              } else {
                const imgData = domainImages[currentImgIndex] || { id: res.id, image: res.image, title: res.title, displayUrl: res.displayUrl, url: res.url, snippet: res.snippet };
                onImageClick?.(imgData);
              }
            }}
            className="shrink-0 w-36 h-36 md:w-48 md:h-48 rounded-2xl overflow-hidden border border-slate-100 shadow-sm relative group/carousel mt-4 sm:mt-0 bg-slate-50 cursor-pointer"
          >
            <AnimatePresence mode="wait">
              <motion.img 
                key={activeImage}
                src={activeImage} 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }} // Smooth transition for image change
                className="w-full h-full object-cover transition-transform hover:scale-105" 
                referrerPolicy="no-referrer" 
              />
            </AnimatePresence>
            
            {/* Play button overlay if it's a video result */}
            {res.is_video && (
               <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/carousel:bg-black/40 transition-colors">
                  <PlayCircle size={44} className="text-white drop-shadow-2xl" />
               </div>
            )}

            <button 
              onClick={() => onVisualSearch?.(activeImage)}
              className="absolute top-2 right-2 p-2 bg-black/40 backdrop-blur-md text-white rounded-full opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-black/60 shadow-lg"
              title="Visual Search"
            >
              <Camera size={14} />
            </button>

            {domainImages.length > 1 && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 px-2 py-1 bg-black/20 backdrop-blur-sm rounded-full">
                {domainImages.slice(0, 5).map((_: any, i: number) => (
                  <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${currentImgIndex === i ? 'bg-white scale-125' : 'bg-white/40'}`} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function ImageDetailView({ image, allResults, onClose, onSelect, onResultClick }: any) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  
  const relatedImages = allResults.filter((res: any) => {
    if (!res.image || res.id === image.id) return false;
    const imgTitle = (image.title || '').toLowerCase();
    const resTitle = (res.title || '').toLowerCase();
    const imgTerms = imgTitle.split(/\s+/).filter((t: string) => t.length > 3);
    // Intersection based on keywords or same domain
    return imgTerms.some((term: string) => resTitle.includes(term)) || res.displayUrl === image.displayUrl;
  }).slice(0, 12);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[2200] flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div 
        initial={isMobile ? { y: '100%' } : { x: '100%' }}
        animate={isMobile ? { y: 0 } : { x: 0 }}
        exit={isMobile ? { y: '100%' } : { x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className={`relative w-full md:w-[600px] lg:w-[800px] h-full bg-white shadow-2xl overflow-y-auto flex flex-col p-0`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between p-4 md:p-6">
          <div className="flex items-center gap-3 overflow-hidden">
            <img 
               src={`https://www.google.com/s2/favicons?domain=${image.displayUrl}&sz=64`} 
               className="w-6 h-6 rounded-full shrink-0" 
            />
            <span className="text-sm font-bold text-slate-500 truncate">{image.displayUrl.replace('www.', '')}</span>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-900 transition-all active:scale-95"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 p-4 md:p-10">
          {/* Main Image Container */}
          <div className="aspect-auto bg-slate-50 rounded-3xl overflow-hidden border border-slate-100 mb-8 max-h-[60vh] flex items-center justify-center">
            <img 
              src={image.image || image.url} 
              className="max-w-full max-h-full object-contain" 
              referrerPolicy="no-referrer"
              alt={image.title}
            />
          </div>

          <div className="mb-10">
            <h2 className="text-2xl md:text-3xl font-display font-medium text-slate-900 mb-4">{image.title}</h2>
            <p className="text-slate-600 text-lg leading-relaxed mb-6">{image.snippet}</p>
            <a 
              onClick={() => onResultClick?.(image.id, image.url, 0)}
              href={image.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-full font-bold hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-100"
            >
              Visit Website <ExternalLink size={16} />
            </a>
          </div>

          {/* Related Images Table/Grid */}
          {relatedImages.length > 0 && (
            <div className="border-t border-slate-100 pt-10">
              <h3 className="text-xl font-display font-bold text-slate-900 mb-6">Related Images</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {relatedImages.map((rel: any) => (
                  <button 
                    key={rel.id}
                    onClick={() => onSelect(rel)}
                    className="group relative aspect-square rounded-2xl overflow-hidden bg-slate-50 border border-slate-100 hover:shadow-xl transition-all"
                  >
                    <img src={rel.image} className="w-full h-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-end p-3 transition-opacity">
                       <span className="text-white text-[10px] font-bold truncate uppercase tracking-widest">{rel.displayUrl.replace('www.', '')}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
 }

// New VideoDetailView component
function VideoDetailView({ video, onClose, onResultClick }: any) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/90 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="relative w-full max-w-5xl aspect-video bg-black shadow-2xl flex flex-col overflow-hidden rounded-3xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-20 bg-linear-to-b from-black/80 to-transparent flex items-center justify-between p-4 md:p-6 opacity-0 hover:opacity-100 transition-opacity duration-300">
          <div className="flex items-center gap-3">
            <img 
               src={`https://www.google.com/s2/favicons?domain=${new URL(video.url).hostname}&sz=64`} 
               className="w-6 h-6 rounded-full bg-white p-0.5" 
            />
            <span className="text-sm font-bold text-white truncate drop-shadow-md">{video.title}</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition-all"><X size={24} /></button>
        </div>

        {/* Embedded Video Player */}
        {video.embed_url && (
          <iframe
            width="100%"
            height="100%"
            src={`${video.embed_url}?autoplay=1&modestbranding=1&rel=0`} 
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={video.title}
            className="flex-1"
          ></iframe>
        )}

        {/* Integrated Footer Link */}
        <div className="absolute bottom-0 left-0 right-0 z-20 bg-linear-to-t from-black/80 to-transparent p-6 opacity-0 hover:opacity-100 transition-opacity duration-300 flex items-center justify-between">
           <div className="text-white">
              <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-1">{video.source}</p>
              <h3 className="font-bold text-lg line-clamp-1">{video.title}</h3>
           </div>
           <a href={video.url} target="_blank" rel="noreferrer" onClick={() => onResultClick?.(video.id, video.url, 0)} className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-red-700 transition-all shadow-xl shadow-red-900/20">YouTube <ExternalLink size={14} /></a>
        </div>
      </motion.div>
    </motion.div>
  );
}

 function AnalyticsDashboard({ events, onClose, loading, refresh }: { events: any[], onClose: () => void, loading: boolean, refresh: () => void }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'queries' | 'performance'>('overview');

  // Process data for charts
  const queryCounts = events.reduce((acc: any, curr: any) => {
    if (!curr.query) return acc;
    acc[curr.query] = (acc[curr.query] || 0) + 1;
    return acc;
  }, {});

  const queryData = Object.entries(queryCounts)
    .sort(([, a]: any, [, b]: any) => b - a)
    .slice(0, 10)
    .map(([name, value]) => ({ name, value }));

  const interactionMix = events.reduce((acc: any, curr: any) => {
    acc[curr.type] = (acc[curr.type] || 0) + 1;
    return acc;
  }, {});

  const pieData = Object.entries(interactionMix).map(([name, value]) => ({ name, value }));
  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  const timeGroups: Record<string, number> = {};
  events.forEach(e => {
    if (!e.timestamp) return;
    const date = new Date(e.timestamp).toLocaleDateString();
    timeGroups[date] = (timeGroups[date] || 0) + 1;
  });

  const trendData = Object.entries(timeGroups).map(([date, count]) => ({ date, count })).reverse();

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[3000] bg-slate-900/60 backdrop-blur-xl flex items-center justify-center p-4 md:p-10"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }}
        className="w-full max-w-6xl h-[85vh] bg-white rounded-[40px] shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between shrink-0" >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
              < BarChart3 size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-display font-bold text-slate-900">Search Analytics</h2>
              <p className="text-sm text-slate-500">Monitoring Scout's Collective Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button onClick={refresh} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-900 transition-all">
                <Clock size={20} className={loading ? 'animate-spin' : ''} />
             </button>
             <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-900 transition-all">
                <X size={24} />
             </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-8 py-2 bg-slate-50/50 border-b border-slate-100 flex gap-4 shrink-0">
           {['Overview', 'Queries', 'Performance'].map(tab => (
             <button 
               key={tab} 
               onClick={() => setActiveTab(tab.toLowerCase() as any)}
               className={`px-4 py-2 text-sm font-bold rounded-xl transition-all ${activeTab === tab.toLowerCase() ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
             >
               {tab}
             </button>
           ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
           {loading && events.length === 0 ? (
             <div className="h-full flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-600" size={48} />
             </div>
           ) : (
             <div className="space-y-10">
                {activeTab === 'overview' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                       {[
                         { label: 'Total Events', val: events.length, icon: MousePointer2, color: 'text-blue-600', bg: 'bg-blue-50' },
                         { label: 'Unique Queries', val: Object.keys(queryCounts).length, icon: Search, color: 'text-purple-600', bg: 'bg-purple-50' },
                         { label: 'Success Rate', val: `${Math.round((interactionMix['success'] || 0) / (events.length || 1) * 100)}%`, icon: Target, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                         { label: 'Pogo Rate', val: `${Math.round((interactionMix['pogo'] || 0) / (events.length || 1) * 100)}%`, icon: TrendingUp, color: 'text-amber-600', bg: 'bg-amber-50' },
                       ].map((stat, i) => (
                         <div key={i} className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm">
                            <div className={`p-3 w-fit ${stat.bg} ${stat.color} rounded-2xl mb-4`}>
                               <stat.icon size={20} />
                            </div>
                            <div className="text-3xl font-black text-slate-900 mb-1">{stat.val}</div>
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{stat.label}</div>
                         </div>
                       ))}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[400px]">
                       <div className="bg-white border border-slate-100 rounded-[32px] p-6 shadow-sm flex flex-col">
                          <h4 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                             <TrendingUp size={18} className="text-blue-500" /> Interaction Volume
                          </h4>
                          <div className="flex-1 h-[350px]">
                            <ResponsiveContainer width="100%" height="100%">
                               <AreaChart data={trendData}>
                                  <defs>
                                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                    </linearGradient>
                                  </defs>
                                  <Tooltip />
                                  <Area type="monotone" dataKey="count" stroke="#3b82f6" fillOpacity={1} fill="url(#colorCount)" strokeWidth={3} />
                               </AreaChart>
                            </ResponsiveContainer>
                          </div>
                       </div>
                       
                       <div className="bg-white border border-slate-100 rounded-[32px] p-6 shadow-sm flex flex-col">
                          <h4 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                             <Target size={18} className="text-purple-500" /> Event Distribution
                          </h4>
                          <div className="flex-1 h-[350px]">
                             <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                   <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                      {pieData.map((_entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                      ))}
                                   </Pie>
                                   <Tooltip />
                                </PieChart>
                             </ResponsiveContainer>
                          </div>
                          <div className="flex justify-center gap-4 pt-4 flex-wrap">
                            {pieData.map((d: any, i: number) => (
                               <div key={i} className="flex items-center gap-2">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                  <span className="text-xs font-bold text-slate-500 lowercase">{d.name}</span>
                               </div>
                             ))}
                          </div>
                       </div>
                    </div>
                  </>
                )}

                {activeTab === 'queries' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                     <div className="bg-white border border-slate-100 rounded-[32px] p-8 shadow-sm h-[500px] flex flex-col">
                        <h4 className="font-bold text-slate-900 mb-8">Top 10 Resonant Queries</h4>
                        <div className="flex-1 h-[350px]">
                           <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={queryData} layout="vertical">
                                 <XAxis type="number" hide />
                                 <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12, fontWeight: 'bold' }} />
                                 <Tooltip />
                                 <Bar dataKey="value" fill="#8b5cf6" radius={[0, 10, 10, 0]} />
                              </BarChart>
                           </ResponsiveContainer>
                        </div>
                     </div>
                     
                     <div className="bg-white border border-slate-100 rounded-[32px] p-8 shadow-sm flex flex-col">
                        <h4 className="font-bold text-slate-900 mb-6">Live Feed</h4>
                        <div className="space-y-4 overflow-y-auto max-h-[440px] pr-2 custom-scrollbar">
                           {events.slice(0, 50).map((e: any, i: number) => (
                             <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-start justify-between gap-4">
                                <div>
                                   <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{new Date(e.timestamp).toLocaleTimeString()}</div>
                                   <div className="text-sm font-bold text-slate-800 line-clamp-1 italic">{`"${e.query}"`}</div>
                                   <div className="text-[11px] text-slate-500 mt-1 line-clamp-1">{e.url}</div>
                                </div>
                                <div className={`shrink-0 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-tighter ${e.type === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                                   {e.type}
                                </div>
                             </div>
                           ))}
                        </div>
                     </div>
                  </div>
                )}

                {activeTab === 'performance' && (
                   <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-6">
                         <Clock size={40} />
                      </div>
                      <h3 className="text-2xl font-display font-medium text-slate-900 mb-2">Technical Vitals</h3>
                      <p className="text-slate-500 max-w-sm">Detailed performance metrics for local embedding vs. vector retrieval currently under development.</p>
                   </div>
                )}
             </div>
           )}
        </div>
      </motion.div>
    </motion.div>
  );
}
