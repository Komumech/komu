/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Mic, Image as ImageIcon, Video, MapPin, Newspaper, X, LayoutGrid, User, Trophy, Menu, ArrowRight, ExternalLink, Sparkles, Loader2, LogOut, ChevronLeft, ChevronRight, Camera, Check, Zap, BarChart3, TrendingUp, Target, MousePointer2, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area } from 'recharts';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, arrayUnion, collection, addDoc, serverTimestamp, query as fsQuery, orderBy, limit, getDocs } from "firebase/firestore";
import firebaseConfig from '../firebase-applet-config.json';
import { GoogleGenAI, Type } from "@google/genai";
import { SearchResult, AIOverview, KnowledgePanel, VisualAnalysis } from './types';
import { 
  shouldShowColorPicker, ColorPickerWidget,
  shouldShowCalculator, CalculatorWidget,
  shouldShowCurrency, CurrencyConverterWidget
} from './components/SearchWidgets';
import { PageIntelligencePanel } from './components/PageIntelligence';

// Initialize Gemini on the Frontend
const API_KEY = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenAI({ apiKey: API_KEY || 'AI-NOT-SET' });
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const WALLPAPERS = [
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1920&auto=format&fit=crop', // cosmic space
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=1920&auto=format&fit=crop', // green forest
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=1920&auto=format&fit=crop', // dramatic mountains
  'https://images.unsplash.com/photo-1509316975850-ff9c5edd0cd9?q=80&w=1920&auto=format&fit=crop', // desert dunes
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=1920&auto=format&fit=crop', // sunny ocean beach
  'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?q=80&w=1920&auto=format&fit=crop', // majestic aurora
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?q=80&w=1920&auto=format&fit=crop', // misty valley lake
  'https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?q=80&w=1920&auto=format&fit=crop', // bright galaxy nebulae
  'https://images.unsplash.com/photo-1486873249359-2731bd6dafc7?q=80&w=1920&auto=format&fit=crop', // frozen winter peak
  'https://images.unsplash.com/photo-1500382017468-9049fed747ef?q=80&w=1920&auto=format&fit=crop', // lavender field hills
  'https://images.unsplash.com/photo-1474511320723-9a56873867b5?q=80&w=1920&auto=format&fit=crop', // canyon rivers
  'https://images.unsplash.com/photo-1511497584788-876760111969?q=80&w=1920&auto=format&fit=crop'  // deep pine trees
];

const getSessionId = () => {
  if (typeof window === 'undefined') return 'sess-unknown';
  let sid = sessionStorage.getItem('scout_session_id') || localStorage.getItem('scout_session_id');
  if (!sid) {
    sid = 'sess-' + Math.random().toString(36).substring(2, 12);
    try {
      sessionStorage.setItem('scout_session_id', sid);
      localStorage.setItem('scout_session_id', sid);
    } catch (e) {}
  }
  return sid;
};

export default function App() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiOverview, setAiOverview] = useState<AIOverview | null>(null);
  const [isOverviewExpanded, setIsOverviewExpanded] = useState(false);
  const [aiRateLimited, setAiRateLimited] = useState(false);
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
  const [bgRotationMode, setBgRotationMode] = useState<'hourly' | 'daily'>(() => {
    return typeof window !== 'undefined' ? (localStorage.getItem('bg_rotation_mode') as 'hourly' | 'daily') || 'hourly' : 'hourly';
  });
  const [dictionary, setDictionary] = useState<any>(null);
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
  const [searchStage, setSearchStage] = useState<'idle' | 'extracting' | 'vectorizing' | 'ranking'>('idle');
  const lastQueryRef = useRef<string>('');
  const lastClickRef = useRef<{ id: string; url: string; time: number; query: string } | null>(null);
  const appsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const handleSearchRef = useRef<any>(null);

  const userRef = useRef<any>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

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
          url: lastClickRef.current.url,
          durationMs,
          sessionId: getSessionId(),
          uid: userRef.current?.sub || userRef.current?.email || 'guest'
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

  // Deterministic hourly / daily backgrounds
  useEffect(() => {
    const updateWallpaper = () => {
      if (WALLPAPERS && WALLPAPERS.length > 0) {
        const timeDivisor = bgRotationMode === 'hourly' ? 3600000 : 86400000;
        const index = Math.floor(Date.now() / timeDivisor) % WALLPAPERS.length;
        setHomeBg(WALLPAPERS[index]);
      }
    };
    updateWallpaper();
    const interval = setInterval(updateWallpaper, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [bgRotationMode]);

  // SPEECH RECOGNITION SETUP - Dynamically initialized on demand to ensure seamless access
  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      setIsListening(false);
    } else {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setMicError("Speech recognition is not supported in this browser. Please try Chrome or Safari.");
        setTimeout(() => setMicError(null), 5000);
        return;
      }

      try {
        setQuery('');
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        
        recognition.onstart = () => {
          setIsListening(true);
        };

        recognition.onresult = (event: any) => {
          let finalTranscript = '';
          let interimTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          
          const currentText = finalTranscript || interimTranscript;
          if (currentText) {
            setQuery(currentText);
          }

          if (finalTranscript) {
            try {
              recognition.stop();
            } catch (e) {}
            setIsListening(false);
            setTimeout(() => {
              handleSearchRef.current(finalTranscript);
            }, 500);
          }
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          if (event.error === 'not-allowed') {
            setMicError("Microphone access is blocked. Please allow microphone permissions in page settings.");
            setTimeout(() => setMicError(null), 5000);
          } else {
            setMicError(`Speech error: ${event.error}`);
            setTimeout(() => setMicError(null), 4000);
          }
          setIsListening(false);
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err: any) {
        console.error('Failed to start recognition:', err);
        setMicError("Unable to open speech recognition interface.");
        setTimeout(() => setMicError(null), 4500);
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
      const redirectUri = `${window.location.origin}/auth/callback`;
      const res = await fetch(`/api/auth/url?redirectUri=${encodeURIComponent(redirectUri)}`);
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
      } else {
        throw new Error("Backend analytics response was not OK");
      }
    } catch (e) {
      console.warn("Express backend clickstream query failed, using direct client-side fallback query:", e);
      try {
        const clickstreamCol = collection(db, "clickstream");
        const q = fsQuery(clickstreamCol, orderBy("timestamp", "desc"), limit(1000));
        const querySnapshot = await getDocs(q);
        const events: any[] = [];
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
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
          events.push({
            id: docSnap.id,
            ...data,
            timestamp: dateObj
          });
        });
        setAnalyticsEvents(events);
      } catch (clientErr) {
        console.error("Failed to load real clickstream database from client SDK too:", clientErr);
      }
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
    
    if (!finalQuery.trim() && !currentVisualQuery) return;

    setLoading(true);
    setIsSearching(true);
    setResults([]); 
    setSearchStage(currentVisualQuery ? 'extracting' : 'ranking');
    setVisualMathProblem(null);
    setVisualAnalysis(null);
    setAiOverview(null);
    setDictionary(null);
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

    // Neural embeddings are now handled server-side using mpnet-base for consistency and precision.

    // AUTOCORRECT ON FRONTEND (Adhering to rules)
    if (!currentVisualQuery && requestedPage === 1 && finalQuery.length > 3 && API_KEY && API_KEY !== 'AI-NOT-SET') {
      try {
        const autocorrectPrompt = `Act as a search engine spell checker. Check if "${finalQuery}" has obvious typos. 
        If it has an obvious typo, return ONLY the corrected string. 
        If it is likely correct or a brand name, return the exact same string.
        Be conservative. Only correct if you are 95% certain.`;
        
        const r = await genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ role: 'user', parts: [{ text: autocorrectPrompt }] }]
        });
        const text = r.text?.trim() || "";
        if (text.toLowerCase() !== finalQuery.toLowerCase() && text.length > 0 && text.length < 100) {
          setCorrection(text);
          setOriginalQuery(finalQuery);
          finalQuery = text;
        }
      } catch (e) {
        console.warn("Autocorrect failed:", e);
      }
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
          vector,
          sessionId: getSessionId(),
          uid: user?.sub || user?.email || 'guest'
        })
      });
      
      let data: any;
      const contentType = searchRes.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await searchRes.json();
      } else {
        const text = await searchRes.text();
        console.error("Non-JSON Server Response:", text);
        if (text.includes("application starts") || text.includes("Starting Server")) {
          throw new Error("Neural Engines Warming Up: Scout is currently loading its local AI models. Please wait about 30 seconds and try again.");
        }
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
      setTotalPages(data.totalPages || 1);
      setDictionary(data.dictionary || null);
      setIsEnglishHelp(data.isEnglishHelp || false);
      
      const rawResults: SearchResult[] = pineconeResults.map((r: any) => ({
        ...r,
        id: r.id,
        title: r.title || r.official_headline || 'Untitled Page',
        url: r.url || '#',
        displayUrl: r.displayUrl || 'unknown',
        snippet: r.snippet || r.text || 'No description available.',
        sourceIcon: r.sourceIcon || '🌐',
        image: r.image || null
      }));

      // IMMEDIATE UPDATE FOR SPEED
      setResults(rawResults);
      setLoading(false);

      // Persist to Firebase history & search clickstream directly
      if (requestedPage === 1 && finalQuery.trim() && finalQuery !== 'Visual Search (Scout Vision)') {
        if (user?.sub) {
          setDoc(doc(db, "users", user.sub), {
            queries: arrayUnion(finalQuery.trim()),
            updatedAt: new Date().toISOString()
          }, { merge: true }).catch(console.error);
          setUserHistory(prev => [...new Set([...prev, finalQuery.trim()])]);
        }
        try {
          addDoc(collection(db, "clickstream"), {
            query: finalQuery.trim(),
            type: 'search',
            url: '',
            timestamp: serverTimestamp(),
            sessionId: getSessionId(),
            uid: user?.sub || user?.email || 'guest',
            duration: null,
            position: null
          }).catch(e => console.error("Client clickstream search logging error:", e));
        } catch (e) {
          console.error("Client clickstream search logging initialization error:", e);
        }
      }

      // PARALLEL EXECUTION FOR AI FEATURES
      if (requestedPage === 1) {
        generateAIOverview(finalQuery, rawResults, data.isEnglishHelp || false);
        generateFAQ(finalQuery, rawResults);
        
        // Intelligent triggering for Knowledge Panel (Entity card)
        const topResultIsEntity = rawResults[0]?.displayUrl.includes('wikipedia.org') || 
                                 rawResults[0]?.displayUrl.includes('britannica.com');
        
        // Check if there is a Wikipedia details page anywhere in the top 8 results
        const wikiResult = rawResults.slice(0, 8).find(r => 
          r.url.toLowerCase().includes('wikipedia.org/wiki/') && 
          !r.url.toLowerCase().includes('/wiki/special:') && 
          !r.url.toLowerCase().includes('/wiki/category:') &&
          !r.url.toLowerCase().includes('/wiki/help:') &&
          !r.url.toLowerCase().includes('/wiki/talk:')
        );
        
        if (data.suggestKnowledgePanel && data.detectedEntity) {
          generateKnowledgePanel(data.detectedEntity.name, data.detectedEntity.type);
        } else if (topResultIsEntity && !data.isEnglishHelp && !data.dictionary) {
          // Trigger KP for top authoritative entities even if intent didn't catch it
          generateKnowledgePanel(rawResults[0].title);
        } else if (wikiResult && !data.isEnglishHelp && !data.dictionary) {
          try {
            const urlParts = wikiResult.url.split('/wiki/');
            if (urlParts.length > 1) {
              const entityFromUrl = decodeURIComponent(urlParts[1].split('#')[0]).replace(/_/g, ' ');
              if (entityFromUrl) {
                generateKnowledgePanel(entityFromUrl);
              } else {
                generateKnowledgePanel(wikiResult.title.replace(/\s*-\s*Wikipedia/i, ''));
              }
            } else {
              generateKnowledgePanel(wikiResult.title.replace(/\s*-\s*Wikipedia/i, ''));
            }
          } catch (e) {
            generateKnowledgePanel(wikiResult.title.replace(/\s*-\s*Wikipedia/i, ''));
          }
        }
      }
    } catch (error: any) {
      console.error("Search failed:", error);
      setError(error.message || "Something went wrong.");
      setLoading(false);
    }
  };

  // Coupling handleSearch to handleSearchRef cleanly after lexical declaration
  useEffect(() => {
    if (handleSearchRef) {
      handleSearchRef.current = handleSearch;
    }
  }, [handleSearch]);

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
           3. INTEGRATE IMAGES: If a search result has an "Image_URL", you MAY include it using standard Markdown ![title](Image_URL) if it is highly relevant to a section of your answer. Place images naturally between paragraphs or near relevant facts. Use at most 2-3 images.
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
      const prompt = `Query: "${queryText}"\nContext: ${context}\nGenerate 3 relevant frequently asked questions as a JSON array: [{"question": "...", "answer": "..."}]`;
      
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
      setFaq(data.slice(0, 3));
    } catch (e) {
      console.error("FAQ generation failed:", e);
    }
  };

  const generateKnowledgePanel = async (entityName: string, entityType?: string) => {
    if (!API_KEY || API_KEY === 'AI-NOT-SET') return;
    try {
      let wikiContent = "";
      let wikiImage: string | null = null;
      let wikiTitle = entityName;
      let wikiDesc = entityType || "";
      let wikiUrl = "";
      let matchedTitle = entityName;
      let extraImages: string[] = [];

      // Step 1: Direct Fetch from Wikipedia REST summary API
      try {
        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entityName)}`;
        const summaryRes = await axios.get(summaryUrl);
        const sData = summaryRes.data;
        if (sData && sData.extract) {
          wikiTitle = sData.title || wikiTitle;
          wikiDesc = sData.description || wikiDesc;
          wikiContent = sData.extract || "";
          wikiUrl = sData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(entityName)}`;
          matchedTitle = sData.title || entityName;
          if (sData.originalimage?.source) {
            wikiImage = sData.originalimage.source;
          } else if (sData.thumbnail?.source) {
            wikiImage = sData.thumbnail.source;
          }
        }
      } catch (err: any) {
        // Fallback to opensearch if direct title failed
        try {
          const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(entityName)}&limit=1&namespace=0&format=json&origin=*`;
          const searchRes = await axios.get(searchUrl);
          const titles = searchRes.data?.[1] || [];
          if (titles.length > 0) {
            matchedTitle = titles[0];
            const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(matchedTitle)}`;
            const summaryRes = await axios.get(summaryUrl);
            const sData = summaryRes.data;
            if (sData) {
              wikiTitle = sData.title || wikiTitle;
              wikiDesc = sData.description || wikiDesc;
              wikiContent = sData.extract || "";
              wikiUrl = sData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(matchedTitle)}`;
              if (sData.originalimage?.source) {
                wikiImage = sData.originalimage.source;
              } else if (sData.thumbnail?.source) {
                wikiImage = sData.thumbnail.source;
              }
            }
          }
        } catch (err2: any) {
          console.warn("Wikipedia fallback search failed:", err2.message);
        }
      }

      // Step 2: Fetch any extra images from Wikipedia page media-list for beautiful collage
      if (wikiContent) {
        try {
          const mediaUrl = `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(matchedTitle)}`;
          const mediaRes = await axios.get(mediaUrl);
          const items = mediaRes.data?.items || [];
          const imagesFound = items
            .filter((item: any) => item.type === 'image' && item.srcset && item.srcset.length > 0)
            .map((item: any) => {
              const bestSrc = item.srcset[item.srcset.length - 1]?.src || item.srcset[0]?.src;
              if (bestSrc) {
                return bestSrc.startsWith('http') ? bestSrc : `https:${bestSrc}`;
              }
              return null;
            })
            .filter(Boolean) as string[];

          extraImages = imagesFound.slice(0, 3);
        } catch (mediaErr: any) {
          console.warn("Wikipedia media fetch failed:", mediaErr.message);
        }

        const defaultImage = wikiImage || `https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=600`;
        const directData = {
          title: wikiTitle,
          subtitle: wikiDesc || (entityType || "Entity Information"),
          description: wikiContent,
          image: defaultImage,
          images: extraImages.length > 0 ? extraImages : (wikiImage ? [wikiImage] : [defaultImage]),
          details: [
            ...(wikiDesc ? [{ label: "Type", value: wikiDesc }] : []),
            { label: "Source", value: "Wikipedia" }
          ],
          sections: [],
          peopleAlsoSearchFor: [],
          wikipediaUrl: wikiUrl
        };
        setKnowledgePanel(directData);
        return;
      }

      const prompt = `Entity: "${entityName}"
      Factual Grounding Information from Wikipedia:
      - Canonical Title: "${wikiTitle}"
      - Category Description: "${wikiDesc}"
      - Summary Extract: "${wikiContent}"
      - Wikipedia Page URL: "${wikiUrl}"
      - Wikipedia Image URL: "${wikiImage || ''}"

      Generate a high-quality "Knowledge Panel" matching this query.
      If Wikipedia data was successfully fetched (meaning Summary Extract is not empty), you MUST respect and use the Wikipedia-provided Canonical Title for the "title" field, Wikipedia-provided Category Description for "subtitle", and use or closely summarize the Summary Extract for the "description" field. If the Wikipedia data was empty, construct highly accurate display details for the entity.

      In the details grid, put key factual specs (e.g. for companies, add "Founders", "CEO", "Headquarters", "Founded", "Parent organization" etc. and for products/systems add "Initial release", "Platform", "Developer" or key specs). Use key details that are correct and standard for this entity.
      
      Return as a JSON object with:
      1. title: The clean entity name
      2. subtitle: The category or type classification (e.g., "Technology company", "Computer application")
      3. description: A clear 2-3 sentence overview of what this entity is and what its primary purpose is.
      4. image: A main representative high-quality Unsplash image URL (or use the Wikipedia template image "${wikiImage || ''}" if it looks highly professional).
      5. images: An array of exactly 3 relevant Unsplash image URLs that visually represent the entity (e.g. logos, tech gear, office landscapes, branding).
      6. details: An array of key attributes such as {label: "Founded", value: "4 April 1975"}. Keep labels clean, concise, and professional.
      7. sections: An array of {title, content} sections for additional entity sub-topics.
      8. peopleAlsoSearchFor: An array of exactly 6-8 related services, alternatives, products, or adjacent entities. For example, for "Microsoft Azure", this would be ["Amazon Web Services", "Microsoft 365", "Google Cloud Platform", "GitHub"]. For each, specify:
         - "name": The short name of the related entity
         - "category": The category or classification
         - "image": A high-quality Unsplash image URL relevant to that related item
         - "query": The exact search query to search for this item on Scout
      
      Make sure to return valid JSON following the schema perfectly.`;

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
              images: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
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
              },
              peopleAlsoSearchFor: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    category: { type: Type.STRING },
                    image: { type: Type.STRING },
                    query: { type: Type.STRING }
                  },
                  required: ["name", "query", "image"]
                }
              }
            },
            required: ["title", "subtitle", "description", "details", "sections"]
          }
        }
      });
      
      const data = JSON.parse(response.text || 'null');
      if (data) {
        if (wikiUrl) {
          data.wikipediaUrl = wikiUrl;
        }
        setKnowledgePanel(data);
      }
    } catch (e) {
      console.error("Knowledge Panel failed:", e);
    }
  };

  const handleResultClick = (id: string, url: string, position: number | null = null) => {
    // Record for behavioral signals (Pogo-sticking detection)
    lastClickRef.current = { id, url, time: Date.now(), query: lastQueryRef.current };

    // Immediate NavBoost "Interest" signal
    axios.post('/api/feedback', { 
      id, 
      type: 'click', 
      queryText: lastQueryRef.current, 
      url,
      position,
      sessionId: getSessionId(),
      uid: user?.sub || user?.email || 'guest'
    }).catch(() => {});

    // Direct client-side clickstream logging to Firebase clickstream
    try {
      addDoc(collection(db, "clickstream"), {
        query: lastQueryRef.current || '',
        type: 'click',
        url: url,
        timestamp: serverTimestamp(),
        sessionId: getSessionId(),
        uid: user?.sub || user?.email || 'guest',
        duration: null,
        position: position
      }).catch(e => console.error("Client clickstream click logging error:", e));
    } catch (e) {
      console.error("Client clickstream click init error:", e);
    }

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
            bgRotationMode={bgRotationMode}
            setBgRotationMode={setBgRotationMode}
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
            setSelectedImage={setSelectedImage}
            aiRateLimited={aiRateLimited}
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
            allResults={results} 
            onClose={() => setSelectedImage(null)} 
            onSelect={(img: any) => setSelectedImage(img)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function HomeView({ query, setQuery, onSearch, suggestions, showSuggestions, setShowSuggestions, inputRef, searchContainerRef, user, onLogin, onLogout, onMicClick, bg, isSignoutOpen, setIsSignoutOpen, appsRef, isAppsOpen, setIsAppsOpen, imageQuery, onImageUpload, removeImageQuery, fileInputRef, userHistory, onOpenAnalytics, bgRotationMode, setBgRotationMode }: any) {
  const [glowVisible, setGlowVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setGlowVisible(false), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const textarea = inputRef?.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [query, inputRef]);

  // Find first suggestion that matches query
  const getGhostSuggestion = () => {
    if (!query || query.trim().length === 0) return '';
    const match = suggestions && suggestions.find ? suggestions.find((s: string) => s.toLowerCase().startsWith(query.toLowerCase())) : '';
    if (match && match.toLowerCase() !== query.toLowerCase()) {
      return match;
    }
    return '';
  };

  const ghostSuggestion = getGhostSuggestion();
  const ghostText = ghostSuggestion ? ghostSuggestion.slice(query.length) : '';

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
            onSubmit={(e) => { e.preventDefault(); onSearch(); }}
            className={`relative flex items-center gap-3 px-5 py-3 transition-all duration-300 bg-white shadow-2xl ${showSuggestions && suggestions.length > 0 ? 'rounded-t-[1.75rem]' : 'rounded-full'}`}
          >
            {/* Spinning colorful gradient border (3-sec load effect) */}
            <div className={`absolute -inset-[2px] pointer-events-none z-0 overflow-hidden transition-opacity duration-1000 ${showSuggestions && suggestions.length > 0 ? 'rounded-t-[1.75rem] rounded-b-none border-b-0' : 'rounded-full'} ${glowVisible ? 'opacity-100' : 'opacity-0'}`}>
              <div 
                className="absolute inset-[-150%] bg-[conic-gradient(from_0deg,#3b82f6,#a855f7,#ec4899,#22c55e,#3b82f6)] animate-spin"
                style={{ animationDuration: '1.5s', animationTimingFunction: 'linear' }}
              />
            </div>
            {/* Mask to lock border width */}
            <div className={`absolute inset-[1.5px] bg-white pointer-events-none z-0 ${showSuggestions && suggestions.length > 0 ? 'rounded-t-[1.75rem]' : 'rounded-full'}`} />

            <Search className="text-slate-400 group-focus-within:text-blue-500 transition-colors shrink-0 relative z-10" size={22} />
            
            {imageQuery && (
              <div className="relative group/img ml-2 h-8 w-8 shrink-0 rounded overflow-hidden shadow-sm border border-slate-200 z-10">
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

            {/* Dynamic Growing Search Input / Caret Animate / Ghost suggestions */}
            <div className="relative flex-1 flex items-stretch min-w-0 min-h-[1.5rem] md:min-h-[1.75rem] z-10 text-base md:text-lg font-normal leading-relaxed text-slate-900">
              {/* Ghost Suggestion Layer */}
              {ghostText && (
                <div 
                  className="absolute inset-0 pointer-events-none select-none text-slate-400/50 text-left break-words whitespace-pre-wrap overflow-hidden"
                  style={{
                    fontSize: 'inherit',
                    fontFamily: 'inherit',
                    lineHeight: 'inherit',
                    fontWeight: 'inherit',
                    padding: '0px 24px 0px 0px'
                  }}
                >
                  <span className="text-transparent border-none p-0 m-0 break-words whitespace-pre-wrap">{query}</span>
                  <span 
                    className="text-slate-400 pointer-events-auto select-none cursor-pointer hover:text-slate-500 transition-colors border-b border-dotted border-slate-300" 
                    title="Tap/Press Tab or ArrowRight to accept suggestion" 
                    onClick={() => { setQuery(ghostSuggestion); }}
                  >
                    {ghostText}
                  </span>
                </div>
              )}

              <textarea 
                ref={inputRef} 
                value={query} 
                rows={1}
                onFocus={() => setShowSuggestions(true)}
                onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }} 
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSearch();
                    setShowSuggestions(false);
                  } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
                    if (ghostSuggestion) {
                      e.preventDefault();
                      setQuery(ghostSuggestion);
                    }
                  }
                }}
                placeholder={imageQuery ? "Visual Search Active" : "Ask Scout anything..."} 
                style={{
                  resize: 'none',
                  height: 'auto',
                  maxHeight: '160px'
                }}
                className="flex-1 bg-transparent border-none outline-none text-inherit placeholder:text-slate-400 overflow-y-auto animate-caret py-0 pr-6 pl-0 font-normal leading-relaxed" 
              />
            </div>

            <div className="flex items-center gap-2 relative z-10 shrink-0">
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

      {/* Dynamic Wallpaper Rotation Controller (hourly/daily) */}
      {setBgRotationMode && (
        <div className="absolute bottom-6 right-6 z-20 flex items-center gap-2">
          <button
            onClick={() => setBgRotationMode(bgRotationMode === 'hourly' ? 'daily' : 'hourly')}
            className="p-2 md:p-2.5 rounded-full backdrop-blur-md bg-black/30 border border-white/10 hover:bg-black/50 text-white/80 hover:text-white transition-all flex items-center justify-center cursor-pointer shadow-lg"
            title={bgRotationMode === 'hourly' ? "Set Wallpaper rotation to Daily ☼" : "Set Wallpaper rotation to Hourly ↺"}
          >
            <Clock size={14} className="animate-spin" style={{ animationDuration: '6s' }} />
          </button>
        </div>
      )}
    </motion.div>
  );
}

function ResultsView({ query, setQuery, onSearch, loading, results, error, aiOverview, dictionary, knowledgePanel, isEnglishHelp, isOverviewExpanded, setIsOverviewExpanded, faq, openFaqIndex, setOpenFaqIndex, aiLoading, activeTab, setActiveTab, page, totalPages, goHome, user, onLogin, onLogout, onMicClick, suggestions, showSuggestions, setShowSuggestions, searchContainerRef, onResultClick, clickedUrls, isSignoutOpen, setIsSignoutOpen, appsRef, isAppsOpen, setIsAppsOpen, correction, originalQuery, imageQuery, onImageUpload, removeImageQuery, fileInputRef, visualMathProblem, searchStage, visualAnalysis, setImageQuery, selectedImage, setSelectedImage, aiRateLimited, onOpenAnalytics }: any) {
  // Helper to check if a URL is an image
  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url.split('?')[0]);

  // Group images by domain for the carousel
  const carouselImages = results.filter((res: any) => isImageUrl(res.url));

  const filteredResults = activeTab === 'images' 
    ? results.filter((res: any) => isImageUrl(res.url) || res.image)
    : results.filter((res: any) => !isImageUrl(res.url)); // Keep 'all' list focused on webpages, but results still contains images

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
      const domainMatches = results.filter(r => 
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
  } else {
    // For other tabs, don't group or use simple list
    filteredResults.forEach(res => groupedResults.push({ type: 'single', result: res }));
  }

  const [glowVisible, setGlowVisible] = useState(true);
  const [isPasfExpanded, setIsPasfExpanded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const resInputRef = useRef<HTMLTextAreaElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const mainElement = mainRef.current;
    if (!mainElement) return;

    const handleScroll = () => {
      if (mainElement.scrollTop > 30) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    mainElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => mainElement.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setGlowVisible(false), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const textarea = resInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [query]);

  // Find first suggestion that matches query
  const getGhostSuggestion = () => {
    if (!query || query.trim().length === 0) return '';
    const match = suggestions && suggestions.find ? suggestions.find((s: string) => s.toLowerCase().startsWith(query.toLowerCase())) : '';
    if (match && match.toLowerCase() !== query.toLowerCase()) {
      return match;
    }
    return '';
  };

  const ghostSuggestion = getGhostSuggestion();
  const ghostText = ghostSuggestion ? ghostSuggestion.slice(query.length) : '';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-screen bg-white">
      <input type="file" ref={fileInputRef} onChange={onImageUpload} className="hidden" accept="image/*" />
      <header className="bg-white border-b border-slate-50 sticky top-0 z-50">
        <div className={`flex flex-col sm:flex-row items-center justify-between transition-all duration-300 ease-in-out px-4 md:px-12 max-w-[1700px] mx-auto ${scrolled ? 'py-3 gap-2 md:gap-6' : 'py-6 sm:py-8 gap-4 md:gap-12'}`}>
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
            <form 
              onSubmit={(e) => { e.preventDefault(); onSearch(); }}
              className={`relative flex items-center gap-2 px-6 py-2.5 transition-all duration-300 soft-ui ${showSuggestions && suggestions.length > 0 ? 'rounded-t-2xl' : 'rounded-full'}`}
            >
              {/* Spinning colorful gradient border (3-sec load effect) */}
              <div className={`absolute -inset-[2px] pointer-events-none z-0 overflow-hidden transition-opacity duration-1000 ${showSuggestions && suggestions.length > 0 ? 'rounded-t-2xl rounded-b-none border-b-0' : 'rounded-full'} ${glowVisible ? 'opacity-100' : 'opacity-0'}`}>
                <div 
                  className="absolute inset-[-150%] bg-[conic-gradient(from_0deg,#3b82f6,#a855f7,#ec4899,#22c55e,#3b82f6)] animate-spin"
                  style={{ animationDuration: '1.5s', animationTimingFunction: 'linear' }}
                />
              </div>
              {/* Inner blocking mask */}
              <div className={`absolute inset-[1.5px] bg-slate-50 pointer-events-none z-0 ${showSuggestions && suggestions.length > 0 ? 'rounded-t-2xl' : 'rounded-full'}`} />

              {imageQuery && (
                <div className="relative group/resimg mr-2 h-6 w-6 shrink-0 rounded overflow-hidden shadow-xs border border-slate-100 relative z-10">
                  <img src={imageQuery} className="w-full h-full object-cover blur-[1.5px]" />
                  <div className="absolute inset-0 bg-[#00000011] backdrop-blur-[0.5px] grid grid-cols-4 grid-rows-4 opacity-60">
                    {[...Array(16)].map((_, i) => <div key={i} className="border-[0.25px] border-white/20" />)}
                  </div>
                </div>
              )}

              {/* Dynamic Resizable Input with suggestions */}
              <div className="relative flex-1 flex items-stretch min-w-0 min-h-[1.25rem] md:min-h-[1.5rem] relative z-10 text-sm md:text-base font-medium leading-relaxed text-slate-800">
                {ghostText && (
                  <div 
                    className="absolute inset-x-0 inset-y-0 pointer-events-none select-none text-slate-400/40 text-left break-words whitespace-pre-wrap overflow-hidden"
                    style={{
                      fontSize: 'inherit',
                      fontFamily: 'inherit',
                      lineHeight: 'inherit',
                      fontWeight: 'inherit',
                      padding: '0px 24px 0px 0px'
                    }}
                  >
                    <span className="text-transparent border-none p-0 m-0 break-words whitespace-pre-wrap">{query}</span>
                    <span 
                      className="text-slate-400 pointer-events-auto select-none cursor-pointer hover:text-slate-500 transition-colors border-b border-dotted border-slate-300" 
                      title="Tap/Press Tab or ArrowRight to accept suggestion" 
                      onClick={() => { setQuery(ghostSuggestion); }}
                    >
                      {ghostText}
                    </span>
                  </div>
                )}

                <textarea 
                  ref={resInputRef}
                  value={query} 
                  rows={1}
                  onFocus={() => setShowSuggestions(true)} 
                  onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }} 
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onSearch();
                      setShowSuggestions(false);
                    } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
                      if (ghostSuggestion) {
                        e.preventDefault();
                        setQuery(ghostSuggestion);
                      }
                    }
                  }}
                  placeholder={imageQuery ? "Image search active" : "Search Scout..."}
                  style={{
                    resize: 'none',
                    height: 'auto',
                    maxHeight: '120px'
                  }}
                  className="flex-1 bg-transparent border-none outline-none text-inherit font-medium overflow-y-auto animate-caret py-0 pr-6 pl-0" 
                />
              </div>

              <div className="flex items-center gap-3 relative z-10 shrink-0">
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
                <Search size={18} className="text-purple-600 cursor-pointer hover:scale-110 transition-transform" onClick={() => onSearch()} />
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
              <UserProfile user={user} onLogin={onLogin} onLogout={onLogout} isSignoutOpen={isSignoutOpen} setIsSignoutOpen={setIsSignoutOpen} onOpenAnalytics={onOpenAnalytics} />
            </div>
          </div>
        </div>
        <div className={`transition-all duration-300 ease-in-out overflow-hidden px-4 md:px-8 lg:pl-8 xl:pl-12 lg:pr-6 xl:pr-8 max-w-[1700px] mx-auto border-t border-slate-50 overflow-x-auto scrollbar-hide ${scrolled ? 'max-h-0 opacity-0 pointer-events-none pt-0' : 'max-h-16 opacity-100 pt-4'}`}>
          <div className="flex items-center gap-8">
            {['All', 'Images', 'News'].map(tab => (
              <button key={tab} className={`pb-3 text-sm font-bold border-b-2 transition-all ${activeTab === tab.toLowerCase() ? 'text-blue-600 border-blue-600' : 'text-slate-400 border-transparent hover:text-slate-700'}`} onClick={() => setActiveTab(tab.toLowerCase())}>{tab}</button>
            ))}
          </div>
        </div>
      </header>

      <main ref={mainRef} className="flex-1 overflow-y-auto">
        <div className={`flex flex-col lg:flex-row gap-8 lg:gap-10 xl:gap-12 p-4 md:p-8 lg:pl-8 xl:pl-12 lg:pr-6 xl:pr-8 max-w-[1700px] mx-auto`}>
          {activeTab === 'all' && knowledgePanel && (
            <aside className="order-1 lg:order-2 space-y-8 w-full lg:w-[368px] shrink-0">
               <motion.div 
                 initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                 className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
               >
                 {(() => {
                   const panelImages = (knowledgePanel.images && knowledgePanel.images.length > 0) 
                     ? knowledgePanel.images 
                     : (knowledgePanel.image ? [knowledgePanel.image] : []);

                   return (
                     <div className="p-4 md:p-5">
                       {/* Header: Title, Subtitle, and Three Dots Menu */}
                       <div className="flex justify-between items-start mb-6">
                         <div>
                           <h2 className="text-2xl font-display font-medium text-slate-900 tracking-tight leading-tight">{knowledgePanel.title}</h2>
                           <p className="text-sm text-slate-500 mt-1 font-normal">{knowledgePanel.subtitle}</p>
                         </div>
                         <div className="flex flex-col gap-1 items-center justify-center w-8 h-8 rounded-full hover:bg-slate-100 cursor-pointer text-slate-450 hover:text-slate-600 shrink-0 select-none">
                           <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                           <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                           <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                         </div>
                       </div>

                       {/* Image Collage / Mosaic */}
                       {panelImages.length > 0 && (
                         <div className="-mx-2 mb-6">
                           {panelImages.length === 1 ? (
                             <div className="aspect-[16/10] w-full rounded-2xl overflow-hidden hover:opacity-95 transition-opacity">
                               <img src={panelImages[0]} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt={knowledgePanel.title} />
                             </div>
                           ) : panelImages.length === 2 ? (
                             <div className="grid grid-cols-2 gap-1.5 rounded-xl overflow-hidden h-[140px]">
                               <img src={panelImages[0]} className="w-full h-full object-cover hover:opacity-95 transition-opacity" referrerPolicy="no-referrer" alt={knowledgePanel.title} />
                               <img src={panelImages[1]} className="w-full h-full object-cover hover:opacity-95 transition-opacity" referrerPolicy="no-referrer" alt={knowledgePanel.title} />
                             </div>
                           ) : (
                             <div className="grid grid-cols-3 gap-1.5 rounded-xl overflow-hidden h-[140px]">
                               <div className="col-span-2 h-full">
                                 <img src={panelImages[0]} className="w-full h-full object-cover hover:opacity-95 transition-opacity" referrerPolicy="no-referrer" alt={knowledgePanel.title} />
                               </div>
                               <div className="grid grid-rows-2 gap-1.5 h-full">
                                 <img src={panelImages[1]} className="w-full h-full object-cover hover:opacity-95 transition-opacity" referrerPolicy="no-referrer" alt={knowledgePanel.title} />
                                 <img src={panelImages[2]} className="w-full h-full object-cover hover:opacity-95 transition-opacity" referrerPolicy="no-referrer" alt={knowledgePanel.title} />
                               </div>
                             </div>
                           )}
                         </div>
                       )}

                       {/* About description and Wikipedia source link */}
                       <div className="space-y-6">
                         <div className="pb-5 border-b border-slate-100 text-left">
                           <p className="text-slate-600 leading-relaxed text-[15px]">{knowledgePanel.description}</p>
                           <span className="text-slate-450 text-[13px] mt-2 block font-normal">
                             Source: <a href={knowledgePanel.wikipediaUrl || `https://en.wikipedia.org/wiki/${encodeURIComponent(knowledgePanel.title)}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Wikipedia</a>
                           </span>
                         </div>

                         {/* Details Grid container */}
                         {knowledgePanel.details && knowledgePanel.details.length > 0 && (
                           <div className="space-y-3 pt-4 border-t border-slate-100 text-[13px]">
                             {knowledgePanel.details.map((detail: any, i: number) => (
                               <div key={i} className="text-[13.5px] leading-relaxed text-left py-1">
                                 <span className="font-semibold text-slate-800">{detail.label}: </span>
                                 <span className="text-slate-600 font-normal">{detail.value}</span>
                               </div>
                             ))}
                           </div>
                         )}

                         {/* Sections display inside the knowledge card */}
                         {knowledgePanel.sections && knowledgePanel.sections.length > 0 && (
                           <div className="space-y-4 pt-1">
                             {knowledgePanel.sections.map((sec: any, i: number) => (
                               <div key={i} className="text-[13px] text-left">
                                 <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] mb-1">{sec.title}</h4>
                                 <p className="text-slate-600 leading-relaxed">{sec.content}</p>
                               </div>
                             ))}
                           </div>
                         )}

                         {/* People Also Search For section */}
                         {knowledgePanel.peopleAlsoSearchFor && knowledgePanel.peopleAlsoSearchFor.length > 0 && (
                           <div className="pt-6 border-t border-slate-100">
                             <h3 className="font-display font-bold text-slate-900 text-lg mb-4 text-left">People also search for</h3>
                             
                             <div className="grid grid-cols-4 gap-3">
                               {(() => {
                                 const visibleItems = isPasfExpanded 
                                   ? knowledgePanel.peopleAlsoSearchFor 
                                   : knowledgePanel.peopleAlsoSearchFor.slice(0, 4);

                                 return visibleItems.map((item: any, i: number) => (
                                   <button 
                                     key={i} 
                                     onClick={() => { setQuery(item.query || item.name); onSearch(item.query || item.name); }}
                                     className="flex flex-col items-center group/pasf w-full focus:outline-none transition-transform active:scale-95 text-center"
                                     title={`Search for ${item.name}`}
                                   >
                                     <div className="aspect-square w-full rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-100 p-1 flex items-center justify-center overflow-hidden transition-all duration-300">
                                       <img 
                                         src={item.image || "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?q=80&w=150"} 
                                         className="w-full h-full object-cover rounded-xl group-hover/pasf:scale-105 transition-transform duration-305" 
                                         referrerPolicy="no-referrer"
                                         alt={item.name}
                                       />
                                     </div>
                                     <span className="text-[11px] font-normal leading-tight mt-2 text-slate-800 group-hover/pasf:text-blue-600 transition-colors line-clamp-2 w-full break-words">
                                       {item.name}
                                     </span>
                                   </button>
                                 ));
                               })()}
                             </div>

                             {knowledgePanel.peopleAlsoSearchFor.length > 4 && (
                               <button
                                 onClick={() => { setIsPasfExpanded(!isPasfExpanded); }}
                                 className="mt-5 w-full bg-[#f1f3f4] hover:bg-slate-200 text-slate-800 text-[13px] font-bold py-2.5 px-5 rounded-full transition-all duration-200 border-none outline-none focus:outline-none flex items-center justify-center gap-1 text-center cursor-pointer"
                               >
                                 <span>{isPasfExpanded ? 'See less' : 'See more'}</span>
                                 <ChevronRight size={14} className={`text-slate-500 transition-transform duration-300 ${isPasfExpanded ? '-rotate-90' : ''}`} />
                               </button>
                             )}
                           </div>
                         )}

                       </div>
                     </div>
                   );
                 })()}
               </motion.div>
            </aside>
          )}

          <div className="w-full max-w-3xl space-y-6 order-2 lg:order-1">
            {/* Interactive Search Tool Widgets */}
            {activeTab === 'all' && shouldShowColorPicker(query) && (
              <ColorPickerWidget query={query} />
            )}
            {activeTab === 'all' && shouldShowCalculator(query) && (
              <CalculatorWidget query={query} />
            )}
            {activeTab === 'all' && shouldShowCurrency(query) && (
              <CurrencyConverterWidget query={query} />
            )}

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
                ) : aiRateLimited ? (
                  <div className="p-6 bg-amber-50 border border-amber-100 rounded-3xl flex items-start gap-4">
                    <div className="p-2 bg-amber-100 rounded-xl text-amber-600">
                      <Zap size={20} />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-bold text-amber-900 mb-1">AI Overview hitting limits</h4>
                      <p className="text-[13px] text-amber-800 leading-relaxed font-medium">Scout's neural generators are processing a high volume of requests. AI Overviews and FAQs are temporarily limited to preserve search speed. Please try again in 60 seconds.</p>
                    </div>
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

            {loading ? (
              <div className="space-y-6">
                {[1,2,3].map(i => <div key={i} className="animate-pulse space-y-3 p-6 bg-white rounded-3xl border border-slate-100"><div className="h-4 bg-slate-100 rounded w-1/4" /><div className="h-6 bg-slate-100 rounded w-3/4" /><div className="h-20 bg-slate-100 rounded w-full" /></div>)}
              </div>
            ) : filteredResults.length > 0 ? (
              activeTab === 'images' ? (
                <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4 animate-in fade-in slide-in-from-bottom-6 duration-700">
                  {filteredResults.map((res: any) => {
                    const imgUrl = isImageUrl(res.url) ? res.url : res.image;
                    return (
                      <div 
                        key={res.id} 
                        onClick={() => setSelectedImage(res)} 
                        className="break-inside-avoid bg-white rounded-2xl overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all border border-slate-100 cursor-pointer p-2 mb-4 group inline-block w-full"
                      >
                        <div className="rounded-xl overflow-hidden bg-slate-50 relative flex items-center justify-center">
                          <img 
                            src={imgUrl} 
                            className="w-full h-auto object-contain transition-transform group-hover:scale-[1.01]" 
                            style={{ maxHeight: '280px' }} 
                            referrerPolicy="no-referrer" 
                            alt={res.title} 
                          />
                        </div>
                        <div className="pt-2 px-1 pb-1">
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">
                            <span className="w-3.5 h-3.5 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200/50 shrink-0">
                              <img 
                                src={`https://www.google.com/s2/favicons?sz=64&domain=${res.displayUrl || 'wikipedia.org'}`} 
                                className="w-2.5 h-2.5" 
                                referrerPolicy="no-referrer" 
                                onError={(e) => { (e.target as any).src = 'https://wikipedia.org/favicon.ico'; }}
                              />
                            </span>
                            <span className="truncate">{res.displayUrl ? res.displayUrl.replace('www.', '') : 'Wikipedia'}</span>
                          </div>
                          <h3 className="text-xs font-semibold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1 leading-snug">
                            {res.title}
                          </h3>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-8 md:space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
                  {groupedResults.map((item: any, idx: number) => (
                    <React.Fragment key={item.type === 'single' ? item.result.id : item.primary.id}>
                      {/* Image Strip after 1st result */}
                      {idx === 1 && (
                        <ImageStrip results={results} onMore={() => setActiveTab('images')} onResultClick={onResultClick} onImageClick={(img: any) => setSelectedImage(img)} />
                      )}

                      {/* First FAQ after 3 results */}
                      {idx === 3 && faq.length > 0 && (
                        <FAQBlock faq={faq.slice(0, 3)} openFaqIndex={openFaqIndex} setOpenFaqIndex={setOpenFaqIndex} />
                      )}
                      
                      {item.type === 'single' ? (
                        <ResultCard res={item.result} carouselImages={carouselImages} isImageUrl={isImageUrl} onResultClick={onResultClick} clickedUrls={clickedUrls} onVisualSearch={(img: string) => { setImageQuery(img); onSearch('Visual Search', 1, img); }} onImageClick={(img: any) => setSelectedImage(img)} allResults={results} />
                      ) : (
                        <div className="space-y-4 py-4 mb-8">
                          <ResultCard res={item.primary} carouselImages={carouselImages} isImageUrl={isImageUrl} onResultClick={onResultClick} clickedUrls={clickedUrls} onVisualSearch={(img: string) => { setImageQuery(img); onSearch('Visual Search', 1, img); }} onImageClick={(img: any) => setSelectedImage(img)} allResults={results} />
                          <div className="ml-4 sm:ml-12 flex flex-col -mt-4">
                            <div className="border-t border-slate-100 mt-2 mb-4" />
                            <div className="space-y-0">
                              {item.secondaries.map((s: any, sIdx: number) => (
                                <div key={s.id} className="group/sub">
                                  <a 
                                    onClick={() => {
                                      const positionIndex = results ? results.findIndex((r: any) => r.id === s.id) : -1;
                                      const position = positionIndex !== -1 ? positionIndex + 1 : null;
                                      onResultClick?.(s.id, s.url, position);
                                    }} 
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
      } catch (err) {
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

function ImageStrip({ results, onMore, onResultClick, onImageClick }: { results: SearchResult[], onMore: () => void, onResultClick?: (id: string, url: string) => void, onImageClick?: (img: any) => void }) {
  const imagesWithMeta = results.filter(r => r.image).slice(0, 24);
  if (imagesWithMeta.length < 3) return null;

  return (
    <div className="py-8 border-b border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between mb-5 px-1">
        <h2 className="text-xl md:text-2xl font-display font-medium text-slate-900">Images for {results[0]?.title.split(' ')[0] || 'your search'}</h2>
        <button 
          onClick={onMore} 
          className="text-white bg-[#1a73e8] hover:bg-blue-700 px-5 py-2 rounded-full text-[12px] font-bold flex items-center gap-1 shadow-md shadow-blue-100 cursor-pointer"
        >
          View all <ChevronRight size={14} />
        </button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar -mx-4 px-4 snap-x">
        {imagesWithMeta.map((img) => (
          <div key={img.id} onClick={(e) => { e.preventDefault(); onImageClick?.(img); }} className="shrink-0 w-36 sm:w-48 h-full group snap-start cursor-pointer">
            <div className="h-[120px] sm:h-[130px] rounded-2xl overflow-hidden bg-slate-50 border border-slate-100 flex items-center justify-center p-2.5 transition-all group-hover:bg-slate-100/60 group-hover:shadow-md">
              <img src={img.image} className="h-full w-auto max-w-full object-contain transition-transform group-hover:scale-[1.03]" referrerPolicy="no-referrer" alt={img.title} />
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
              <span className="text-base md:text-lg font-normal text-slate-800 transition-colors">
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

function ResultCard({ res, carouselImages, isImageUrl, onResultClick, clickedUrls, onVisualSearch, onImageClick, allResults }: any) {
  // Check if previously clicked
  const isPreviouslyClicked = clickedUrls?.includes(res.url);

  // Compute 1-based index position of this result in the result set
  const positionIndex = allResults ? allResults.findIndex((item: any) => item.id === res.id) : -1;
  const position = positionIndex !== -1 ? positionIndex + 1 : null;

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
                    {res.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
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

          {/* Inline miniature strip */}
          {domainImages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto custom-scrollbar py-3 mt-2">
              {domainImages.slice(0, 8).map((img: any, i: number) => (
                <button 
                  key={img.id} 
                  onClick={() => setCurrentImgIndex(i)}
                  className={`shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-all ${currentImgIndex === i ? 'border-blue-500 scale-105 shadow-md z-10' : 'border-transparent opacity-60 hover:opacity-100'}`}
                >
                  <img src={img.url || img.image} title={img.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          )}

          {/* Page Intelligence: FAQs, How-To guides, and Database Content Chunks */}
          <PageIntelligencePanel 
            url={res.url} 
            title={res.title} 
            snippet={res.snippet} 
            apiKey={API_KEY} 
            allResults={allResults}
          />
        </div>
        
        {/* Main Side Image / Carousel */}
        {activeImage && (
          <div 
            onClick={() => {
              const imgData = domainImages[currentImgIndex] || { id: res.id, image: res.image, title: res.title, displayUrl: res.displayUrl, url: res.url, snippet: res.snippet };
              onImageClick?.(imgData);
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
                transition={{ duration: 0.5 }}
                className="w-full h-full object-cover transition-transform hover:scale-105" 
                referrerPolicy="no-referrer" 
              />
            </AnimatePresence>
            
            <button 
              onClick={() => onVisualSearch?.(activeImage)}
              className="absolute top-2 right-2 p-2 bg-black/40 backdrop-blur-md text-white rounded-full opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-black/60 shadow-lg"
              title="Visual Search"
            >
              <Camera size={14} />
            </button>

            {domainImages.length > 1 && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 px-2 py-1 bg-black/20 backdrop-blur-sm rounded-full">
                {domainImages.slice(0, 5).map((_, i) => (
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

function ImageDetailView({ image, allResults, onClose, onSelect }: any) {
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

function VisualMathDisplay({ stage, image }: { problem?: any, stage: string, image: string, analysis?: any }) {
  const [complete, setComplete] = useState(false);
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;

  useEffect(() => {
    if (stage === 'ranking') {
      const t = setTimeout(() => setComplete(true), 1200);
      return () => clearTimeout(t);
    }
  }, [stage]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-[24px] overflow-hidden mb-8 shadow-sm border border-slate-100 flex items-center justify-center p-2"
    >
      <div className="relative w-full max-w-lg aspect-video rounded-2xl overflow-hidden bg-slate-50">
        <motion.img 
          src={image} 
          animate={complete ? { filter: 'grayscale(0) brightness(1)', scale: 1 } : { filter: 'grayscale(0) brightness(1.05)', scale: 1.05 }}
          transition={{ duration: 0.8 }}
          className="w-full h-full object-contain" 
        />
        
        {/* Sleek Lens Animation */}
        <AnimatePresence>
          {!complete && (
            <>
              {/* Subtle Scanning Points */}
              <motion.div className="absolute inset-0 z-20 pointer-events-none">
                 {[...Array(8)].map((_, i) => (
                   <motion.div
                     key={i}
                     initial={{ opacity: 0, scale: 0 }}
                     animate={{ 
                       opacity: [0, 1, 0], 
                       scale: [0.2, 1, 0.2],
                       left: `${15 + Math.random() * 70}%`,
                       top: `${15 + Math.random() * 70}%`
                     }}
                     transition={{ 
                       repeat: Infinity, 
                       duration: 1.5 + Math.random(), 
                       delay: i * 0.2 
                     }}
                     className="absolute w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)]"
                   />
                 ))}
              </motion.div>

              {/* Minimal Line */}
              <motion.div 
                initial={{ top: '0%' }}
                animate={{ top: '100%' }}
                transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                className="absolute inset-x-0 h-0.5 bg-blue-500/20 backdrop-blur-[1px] z-30"
              >
                 <div className="h-full w-full bg-linear-to-r from-transparent via-blue-500 to-transparent opacity-40" />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Completion Visual */}
        <AnimatePresence>
          {complete && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none z-40 bg-white/10 backdrop-blur-[2px]"
            >
               <motion.div 
                 initial={{ scale: 0, rotate: -20 }} 
                 animate={{ scale: 1, rotate: 0 }} 
                 className="bg-white/90 backdrop-blur-md p-3 rounded-full shadow-lg border border-white"
               >
                 <Check className="text-blue-600" size={24} strokeWidth={3} />
               </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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
        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between shrink-0">
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
                          <div className="flex-1 min-h-[250px] h-[250px]">
                            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
                          <div className="flex-1 min-h-[250px] h-[250px]">
                             <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                <PieChart>
                                   <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                      {pieData.map((_entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                      ))}
                                   </Pie>
                                   <Tooltip />
                                </PieChart>
                             </ResponsiveContainer>
                          </div>
                          <div className="flex justify-center gap-4 pt-4 flex-wrap">
                             {pieData.map((d, i) => (
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
                        <div className="flex-1 min-h-[360px] h-[360px]">
                           <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
                           {events.slice(0, 50).map((e, i) => (
                             <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-start justify-between gap-4">
                                <div>
                                   <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{new Date(e.timestamp).toLocaleTimeString()}</div>
                                   <div className="text-sm font-bold text-slate-800 line-clamp-1 italic">"{e.query}"</div>
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

