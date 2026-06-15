/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Mic, Image as ImageIcon, Video, MapPin, Newspaper, X, LayoutGrid, User, Trophy, Menu, ArrowRight, ArrowLeft, ExternalLink, Sparkles, Loader2, LogOut, ChevronLeft, ChevronRight, Camera, Check, Zap, BarChart3, TrendingUp, Target, MousePointer2, Clock, Play, ShoppingBag, BookOpen, Cpu, Shield, FlaskConical, CheckSquare, Copy, HelpCircle, ThumbsUp, ThumbsDown, Navigation, ArrowUpLeft, ArrowUp, History, Bookmark, Settings, ChevronDown, ChevronUp, MoreVertical, Plus, Share2, Printer, Glasses } from 'lucide-react';
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
import IntentDecoder from './components/IntentDecoder';
import MovieSection, { MovieSidebar } from './components/MovieSection';
import SportsSection from './components/SportsSection';
import NavigationMap from './components/NavigationMap';
import PeopleSection from './components/PeopleSection';

// Initialize Gemini on the Frontend (Proxied safely through server to prevent client-side Permission Denied in developer iframe)
const API_KEY: string = 'server_proxied';
const genAI = new GoogleGenAI({ apiKey: 'server_proxied' });

async function generateContentViaProxy({ model, contents, config }: { model: string, contents: any, config?: any }) {
  const response = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, contents, config })
  });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Gemini proxy failed with status ${response.status}`);
  }
  const data = await response.json();
  return { text: data.text };
}

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

// Client-side static caching structures to optimize Gemini API usage and protect against quota/rate limit fatigue (429s)
const clientAiOverviewCache: Record<string, any> = {};
const clientFaqCache: Record<string, any[]> = {};
const clientKnowledgePanelCache: Record<string, any> = {};

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
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [homeBg, setHomeBg] = useState<string>('');
  const [bgRotationMode, setBgRotationMode] = useState<'hourly' | 'daily'>(() => {
    return typeof window !== 'undefined' ? (localStorage.getItem('bg_rotation_mode') as 'hourly' | 'daily') || 'hourly' : 'hourly';
  });
  const [dictionary, setDictionary] = useState<any>(null);
  const [lyrics, setLyrics] = useState<any>(null);
  const [holidays, setHolidays] = useState<any>(null);
  const [movie, setMovie] = useState<any>(null);
  const [sports, setSports] = useState<any>(null);
  const [person, setPerson] = useState<any>(null);
  const [youtubeVideos, setYoutubeVideos] = useState<any[] | null>(null);
  const [videosLoading, setVideosLoading] = useState<boolean>(false);
  const [appsData, setAppsData] = useState<any[] | null>(null);
  const [businessProfileState, setBusinessProfileState] = useState<any | null>(null);
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
  const [howTo, setHowTo] = useState<any>(null);
  const [organicFaqs, setOrganicFaqs] = useState<any[]>([]);
  const [isSemanticLoading, setIsSemanticLoading] = useState<boolean>(false);
  const [detectedIntent, setDetectedIntent] = useState<string>('general');
  const [aiOverviewCopied, setAiOverviewCopied] = useState(false);
  const [aiOverviewRating, setAiOverviewRating] = useState<'up' | 'down' | null>(null);
  const [searchStage, setSearchStage] = useState<'idle' | 'extracting' | 'vectorizing' | 'ranking'>('idle');
  const [safeSearch, setSafeSearch] = useState<'strict' | 'moderate' | 'off'>(() => {
    return typeof window !== 'undefined' ? (localStorage.getItem('safe_search') as 'strict' | 'moderate' | 'off') || 'strict' : 'strict';
  });
  const [isSafeSearchIntercepted, setIsSafeSearchIntercepted] = useState(false);
  const [isSearchEngineModalOpen, setIsSearchEngineModalOpen] = useState(false);
  const [showDefaultToast, setShowDefaultToast] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('scout_default_prompt_dismissed') !== 'true';
    }
    return true;
  });
  const [isPrivacyMode, setIsPrivacyMode] = useState<boolean>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('privacy_mode') === 'true' : false;
  });

  const lastQueryRef = useRef<string>('');

  // Synchronize dynamic Axios headers for unified client tracking privacy
  useEffect(() => {
    axios.defaults.headers.common['X-Privacy-Mode'] = isPrivacyMode ? 'true' : 'false';
  }, [isPrivacyMode]);

  // Dynamic Google Analytics 4 (GA4) tracker auto-injector
  useEffect(() => {
    const gaId = (import.meta as any).env.VITE_GA_ID || 'G-SCOUTTEST99';
    if (typeof window !== 'undefined' && gaId) {
      const script1 = document.createElement('script');
      script1.async = true;
      script1.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
      document.head.appendChild(script1);

      const script2 = document.createElement('script');
      script2.innerHTML = `
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${gaId}', {
          page_path: window.location.pathname + window.location.search,
          send_page_view: true
        });
      `;
      document.head.appendChild(script2);
      console.log(`📊 [GA4 Integration] Initialized tracker with ID: ${gaId}`);
    }
  }, []);
  const lastClickRef = useRef<{ id: string; url: string; time: number; query: string } | null>(null);
  const appsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const handleSearchRef = useRef<any>(null);
  const [clientCoords, setClientCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setClientCoords({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => {
          console.warn("Initial client geolocation background watch failed:", error);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, []);

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
        // Before the user types, show search history and popular/trending queries
        const initial = [...new Set([...(userHistory || []), "internet speed test", "lyrics finder", "recipe for classic pasta", "weather forecast", "world news"])];
        setSuggestions(initial.slice(0, 6));
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
      const res = await fetch('/api/admin/clickstream', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        console.log("📊 Analytics loaded from backend:", data.length, "events");
        setAnalyticsEvents(data);
      } else {
        throw new Error(`Backend Error ${res.status}: Admin session might be expired or blocked.`);
      }
    } catch (e) {
      console.warn("Express backend analytics failed, attempting client SDK fallback:", e);
      try {
        const clickstreamCol = collection(db, "clickstream");
        let querySnapshot;
        try {
          // Try to get ordered data (requires index)
          const q = fsQuery(clickstreamCol, orderBy("timestamp", "desc"), limit(1000));
          querySnapshot = await getDocs(q);
        } catch (indexErr) {
          console.warn("⚠️ Ordered query failed (likely missing index). Falling back to unordered fetch.");
          // Fallback to unordered fetch (does NOT require index)
          const fallbackQ = fsQuery(clickstreamCol, limit(1000));
          querySnapshot = await getDocs(fallbackQ);
        }
        
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
        
        // Sort in-memory to guarantee descending/ascending order correctly
        events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        console.log("📊 Analytics loaded from client SDK:", events.length, "events");
        setAnalyticsEvents(events);
      } catch (clientErr) {
        console.error("❌ Analytics Dashboard failed completely:", clientErr);
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
    setIsSafeSearchIntercepted(false);
    setResults([]); 
    setSearchStage(currentVisualQuery ? 'extracting' : 'ranking');
    setVisualMathProblem(null);
    setVisualAnalysis(null);
    setAiOverview(null);
    setDictionary(null);
    setHolidays(null);
    setHowTo(null);
    setOrganicFaqs([]);
    setIsSemanticLoading(requestedPage === 1 && activeTab === 'all');
    setDetectedIntent('general');
    setYoutubeVideos(null);
    setVideosLoading(false);
    setAppsData(null);
    setBusinessProfileState(null);
    setKnowledgePanel(null);
    setMovie(null);
    setSports(null);
    setPerson(null);
    setLyrics(null);
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

    // NON-BLOCKING BACKGROUND AUTOCORRECT SPELLCHECK (Adhering to rules)
    if (!currentVisualQuery && requestedPage === 1 && finalQuery.length > 3 && API_KEY && API_KEY !== 'AI-NOT-SET') {
      const queryToCheck = finalQuery;
      const autocorrectPrompt = `Act as a search engine spell checker. Check if "${queryToCheck}" has obvious typos. 
      If it has an obvious typo, return ONLY the corrected string. 
      If it is likely correct or a brand name, return the exact same string.
      Be conservative. Only correct if you are 95% certain.`;
      
      generateContentViaProxy({
        model: "gemini-3.5-flash",
        contents: [{ role: 'user', parts: [{ text: autocorrectPrompt }] }]
      }).then((r: any) => {
        let text = r.text?.trim() || "";
        // Strip leading/trailing quotes that may be returned by LLM
        text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
        
        const normA = text.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normB = queryToCheck.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        if (text && normA !== normB && text.length < 100) {
          setCorrection(text);
          setOriginalQuery(queryToCheck);
        }
      }).catch((e: any) => {
        console.warn("Autocorrect failed in background:", e);
        if (e.message?.includes('429') || e.status === 429) {
          setAiRateLimited(true);
        }
      });
    }

    // Launch background search of real YouTube video results for this query in parallel
    if (requestedPage === 1 && finalQuery.trim()) {
      setVideosLoading(true);
      fetch(`/api/youtube-search?q=${encodeURIComponent(finalQuery)}`)
        .then(res => res.json())
        .then(data => {
          setYoutubeVideos(data.videos || []);
          setVideosLoading(false);
        })
        .catch(err => {
          console.error("⚠️ YouTube video fetch failed:", err);
          setYoutubeVideos([]);
          setVideosLoading(false);
        });
    }

    // Asynchronously obtain client geolocation for precise directions and local places bias
    let userLatitude: number | undefined = clientCoords?.latitude;
    let userLongitude: number | undefined = clientCoords?.longitude;
    if (!userLatitude && typeof window !== 'undefined' && navigator.geolocation) {
      try {
        const geoPromise = new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { 
            enableHighAccuracy: true, 
            timeout: 1000 
          });
        });
        const geoPos = await Promise.race([
          geoPromise,
          new Promise<null>((r) => setTimeout(() => r(null), 1200)) // Safety timeout so search never blocks
        ]) as GeolocationPosition | null;

        if (geoPos) {
          userLatitude = geoPos.coords.latitude;
          userLongitude = geoPos.coords.longitude;
          setClientCoords({ latitude: userLatitude, longitude: userLongitude });
        }
      } catch (err) {
        console.warn("Could not retrieve client geolocation prior to search call:", err);
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
          uid: user?.sub || user?.email || 'guest',
          safeSearch,
          userLatitude,
          userLongitude
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
      setIsSafeSearchIntercepted(!!data.isSafeSearchIntercepted);
      setTotalPages(data.totalPages || 1);
      setDictionary(data.dictionary || null);
      setLyrics(data.lyrics || null);
      setHolidays(data.holidays || null);
      setMovie(data.movie || null);
      setSports(data.sports || null);
      setPerson(data.person || null);
      setHowTo(data.howTo || null);
      setOrganicFaqs(data.organicFaqs || []);
      setDetectedIntent(data.detectedIntent || 'general');

      if (requestedPage === 1 && activeTab === 'all' && pineconeResults.length > 0) {
        setIsSemanticLoading(true);
        fetch('/api/search/semantic-details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: finalQuery,
            results: pineconeResults.slice(0, 5)
          })
        })
        .then(res => res.json())
        .then(semanticData => {
          setHowTo(semanticData.howTo || null);
          setOrganicFaqs(semanticData.organicFaqs || []);
          if (semanticData.detectedIntent && semanticData.detectedIntent !== 'general') {
            setDetectedIntent(semanticData.detectedIntent);
          }
          setIsSemanticLoading(false);
        })
        .catch(err => {
          console.error("⚠️ Background semantic fetch failed:", err);
          setIsSemanticLoading(false);
        });
      } else {
        setIsSemanticLoading(false);
      }

      setAppsData(data.apps || null);
      setBusinessProfileState(data.businessProfile || null);
      setIsEnglishHelp(data.isEnglishHelp || false);

      // --- LOG INTENT ENGINE RESULTS TO EXECUTOR / BROWSER TERMINAL ---
      console.log(`
======================================================
  🧠 SCOUT INTENT DISCOVERY ENGINE (DIAGNOSTICS)
======================================================
  Query:            "${finalQuery}"
  Total Web:        ${pineconeResults.length} records
  Lyrics:           ${data.lyrics ? `Found: ${data.lyrics.songTitle} - ${data.lyrics.artist}` : 'None'}
  Entity Found:     ${data.detectedEntity ? JSON.stringify(data.detectedEntity) : 'None'}
  Apps Triggered:   ${data.apps ? `${data.apps.length} apps` : 'None'}
  Business Profile: ${data.businessProfile ? 'Yes' : 'No'}
  Dictionary Card:  ${data.dictionary ? `Yes (${data.dictionary.word})` : 'No'}
  English Tutor:    ${data.isEnglishHelp ? 'Yes' : 'No'}
  SafeSearch status: ${safeSearch} (Intercepted: ${!!data.isSafeSearchIntercepted})
======================================================
`);

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

      // Sync Browser URL query parameter (like Google's ?q=...)
      if (requestedPage === 1 && finalQuery.trim() && finalQuery !== 'Visual Search (Scout Vision)') {
        const url = new URL(window.location.href);
        const currentParamQ = url.searchParams.get('q');
        const currentParamTab = url.searchParams.get('tab') || 'all';
        if (currentParamQ !== finalQuery.trim() || currentParamTab !== activeTab) {
          url.searchParams.set('q', finalQuery.trim());
          url.searchParams.set('tab', activeTab);
          window.history.pushState({ path: url.toString() }, '', url.toString());
        }
      }

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
      if (requestedPage === 1 && !aiRateLimited) {
        generateAIOverview(finalQuery, rawResults, data.isEnglishHelp || false);
        
        // Save token quota: do not request or generate AI FAQ if we have a step guide context
        const isHowToQuery = data.detectedIntent === 'how_to' || 
                             finalQuery.toLowerCase().includes('how to') || 
                             finalQuery.toLowerCase().includes('steps to') || 
                             finalQuery.toLowerCase().includes('guide to') || 
                             !!data.howTo;
        if (!isHowToQuery) {
          generateFAQ(finalQuery, rawResults);
        }
        
        // Strict, Google-compliant triggering for Knowledge Panel (Entity Card)
        // Identify if the query is a long-tail phrase, calculation, pricing question, conversational, or educational query.
        // Google NEVER displays a sidebar entity card for complex questions (such as roofing bungalow estimation) even if Wikipedia links are in the organic results.
        const cleanQ = finalQuery.toLowerCase().trim();
        const isQuestionOrLongPhrase = 
          /^(how|why|what|where|when|who|which|is|can|do|does|did|show|find|cost|price|roof|buying|sell|hire|build|calculate|compute|steps|recipe)\b/i.test(cleanQ) || 
          cleanQ.split(/\s+/).length > 3 ||
          cleanQ.includes('?') || 
          cleanQ.includes(' vs ') || 
          cleanQ.includes(' or ');

        if (data.suggestKnowledgePanel && data.detectedEntity) {
          // Trusted AI classification detects a real entity in the query
          generateKnowledgePanel(data.detectedEntity.name, data.detectedEntity.type);
        } else if (!isQuestionOrLongPhrase && !data.isEnglishHelp && !data.dictionary) {
          // For short, specific noun terms, trigger elegant fallbacks if there's high confidence:
          const topResultIsEntity = rawResults[0]?.displayUrl.includes('wikipedia.org') || 
                                   rawResults[0]?.displayUrl.includes('britannica.com');
          
          const wikiResult = rawResults.slice(0, 3).find(r => 
            r.url.toLowerCase().includes('wikipedia.org/wiki/') && 
            !r.url.toLowerCase().includes('/wiki/special:') && 
            !r.url.toLowerCase().includes('/wiki/category:') &&
            !r.url.toLowerCase().includes('/wiki/help:') &&
            !r.url.toLowerCase().includes('/wiki/talk:')
          );

          if (topResultIsEntity) {
            generateKnowledgePanel(rawResults[0].title);
          } else if (wikiResult) {
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

  // INITIAL LOAD WITH q IN URL PARAMETERS (AND POPSTATE HANDLING)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    const tab = params.get('tab') || 'all';
    if (q && q.trim()) {
      setQuery(q);
      setActiveTab(tab);
      setIsSearching(true);
      // Give state a brief moment to settle, then search
      setTimeout(() => {
        handleSearch(q, 1);
      }, 50);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('q');
      const tab = params.get('tab') || 'all';
      if (q && q.trim()) {
        setQuery(q);
        setActiveTab(tab);
        setIsSearching(true);
        handleSearch(q, 1);
      } else {
        // Clear search to restore home screen cleanly
        setIsSearching(false);
        setIsSafeSearchIntercepted(false);
        setQuery('');
        setResults([]);
        setAiOverview(null);
        setDictionary(null);
        setLyrics(null);
        setHolidays(null);
        setMovie(null);
        setSports(null);
        setPerson(null);
        setHowTo(null);
        setOrganicFaqs([]);
        setDetectedIntent('general');
        setYoutubeVideos(null);
        setAppsData(null);
        setBusinessProfileState(null);
        setIsOverviewExpanded(false);
        setFaq([]);
        setKnowledgePanel(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [handleSearch]);

  const generateAIOverview = async (queryText: string, contextResults: SearchResult[], linguisticHelp = false) => {
    if (!API_KEY || API_KEY === 'AI-NOT-SET' || aiRateLimited) return;
    
    const cacheKey = (queryText || '').toLowerCase().trim();
    if (clientAiOverviewCache[cacheKey]) {
      setAiOverview(clientAiOverviewCache[cacheKey]);
      setAiLoading(false);
      setIsOverviewExpanded(false);
      return;
    }
    
    setAiLoading(true);
    setIsOverviewExpanded(false);
    try {
      // Include image URLs and snippet detail in the context for the LLM to use
      const context = contextResults.slice(0, 5).map((r, i) => 
        `Index: ${i + 1}\nTitle: ${r.title}\nSnippet: ${r.snippet}\nSource: ${r.url}${r.image ? `\nImage_URL: ${r.image}` : ''}`
      ).join("\n---\n");
      
      const prompt = linguisticHelp
        ? `Act as an expert linguist. Provide a concise grammar, spelling, and usage guide for: "${queryText}". Respond in Markdown with clear examples.`
        : `Act as a master synthesis engine for the search engine "Scout". 
           Provide a comprehensive, authoritative AI Overview for the search query: "${queryText}". 
           Use the following search results as context:
           ${context}
           
           Instructions:
           1. Start directly with the factual search summary answer. If the query asks for a cost, price, how much, budget, or other financial estimation, provide a direct answer or average estimate range immediately in your first sentence or paragraph, then format any cost breakdown using a clean, professional, high-contrast Markdown table with columns (Item/Slab, Estimated Cost, Details) if applicable. Do NOT start your response with headers or titles like "AI Overview", "AI Overview: [Topic/Query]", "Topic: [Topic]", etc. Jump straight into the content.
           2. Use bullet points for key facts.
           3. INTEGRATE REFERENCE CITATIONS: At the end of key statements or facts, search to see which of the 5 sources context results the fact came from. Add standard Markdown link citations in the format "[1](URL)", "[2](URL)", "[3](URL)" citing the source URL of that corresponding source index. Always use numbers (1, 2, 3...) corresponding to the context index.
           4. INTEGRATE IMAGES: If a search result has an "Image_URL", you MAY include it using standard Markdown ![title](Image_URL) if it is highly relevant. Use at most 2-3 images.
           5. Be objective and professional. Use Markdown formatting.`;

      const result = await generateContentViaProxy({
        model: "gemini-3.5-flash",
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      
      let cleanText = result.text || "No summary available.";
      let beforeClean = "";
      while (cleanText !== beforeClean) {
        beforeClean = cleanText;
        cleanText = cleanText
          .replace(/^(?:#+\s*|\**)(?:AI\s+Overview|Topic)(?:\s*:\s*[^\n]*)?(?:\**)?\n+/i, '')
          .replace(/^(?:#+\s*|\**)[Dd]irect\s+[Aa]nswer(?:\s*:\s*[^\n]*)?(?:\**)?\n+/i, '')
          .replace(/^(?:#+\s*)?Summary(?:\s*:\s*[^\n]*)?\n+/i, '')
          .replace(new RegExp(`^(?:#+\\s*|\\**)${queryText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\**)?\\n+`, 'i'), '')
          .trim();
      }
      
      const resData = {
        summary: cleanText,
        sources: contextResults.slice(0, 5).map(r => ({ 
          title: r.title, 
          url: r.url,
          snippet: r.snippet,
          image: r.image
        }))
      };
      clientAiOverviewCache[cacheKey] = resData;
      setAiOverview(resData);
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
    if (!API_KEY || API_KEY === 'AI-NOT-SET' || aiRateLimited) return;

    const cacheKey = (queryText || '').toLowerCase().trim();
    if (clientFaqCache[cacheKey]) {
      setFaq(clientFaqCache[cacheKey]);
      return;
    }

    try {
      const context = contextResults.slice(0, 8).map(r => r.snippet).join("\n");
      const prompt = `Query: "${queryText}"\nContext: ${context}\nGenerate 3 relevant frequently asked questions as a JSON array: [{"question": "...", "answer": "..."}]`;
      
      const response = await generateContentViaProxy({
        model: "gemini-3.5-flash",
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
      const cleanFaq = data.slice(0, 3);
      clientFaqCache[cacheKey] = cleanFaq;
      setFaq(cleanFaq);
    } catch (e: any) {
      console.error("FAQ generation failed:", e);
      if (e.message?.includes('429') || e.status === 429) {
        setAiRateLimited(true);
      }
    }
  };

  const generateKnowledgePanel = async (entityName: string, entityType?: string) => {
    if (!API_KEY || API_KEY === 'AI-NOT-SET') return;
    
    const cacheKey = (entityName || '').toLowerCase().trim();
    if (clientKnowledgePanelCache[cacheKey]) {
      setKnowledgePanel(clientKnowledgePanelCache[cacheKey]);
      return;
    }
    
    const isUnsuitedImage = (url: string, query: string): boolean => {
      if (!url) return true;
      const lurl = url.toLowerCase();
      const qStr = query.toLowerCase();
      
      const badKeywords = [
        'disambig', 'wikisource', 'wiktionary', 'commons-logo', 'symbol', 'icon', 'stub', 'alert', 'padlock',
        'lock', 'magnifying', 'p_vip', 'question', 'check', 'edit', 'folder', 'question_mark', 'warning',
        'ambox', 'crystal_clear', 'unhappy', 'frustrated', 'stressed', 'stress', 'exhausted', 'sad', 'angry',
        'confused', 'depressed', 'screaming', 'headache', 'pain', 'frustration', 'laptop_stress', 'troubled',
        'dissatisfied', 'concerned', 'meta', 'user_feedback', 'editing', 'en-wiki', 'wikipedia-logo'
      ];
      
      for (const kw of badKeywords) {
        if (lurl.includes(kw) && !qStr.includes(kw)) {
          return true;
        }
      }
      
      const isNatureOrTopic = /agriculture|wetland|rice|farm|crop|plant|forest|river|mountain|biology|chemistry|science|food|seed/i.test(qStr);
      const isHumanTerm = /woman|man|human|lady|guy|girl|boy|laptop|office|computer/i.test(lurl);
      if (isNatureOrTopic && isHumanTerm && !/human|woman|man|lady/i.test(qStr)) {
        return true;
      }
      
      return false;
    };

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
          if (sData.originalimage?.source && !isUnsuitedImage(sData.originalimage.source, matchedTitle)) {
            wikiImage = sData.originalimage.source;
          } else if (sData.thumbnail?.source && !isUnsuitedImage(sData.thumbnail.source, matchedTitle)) {
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
              if (sData.originalimage?.source && !isUnsuitedImage(sData.originalimage.source, matchedTitle)) {
                wikiImage = sData.originalimage.source;
              } else if (sData.thumbnail?.source && !isUnsuitedImage(sData.thumbnail.source, matchedTitle)) {
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
        const defaultImage = wikiImage || `https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=600`;
        const initialImages = wikiImage ? [wikiImage] : [defaultImage];
        
        const directData = {
          title: wikiTitle,
          subtitle: wikiDesc || (entityType || "Entity Information"),
          description: wikiContent,
          image: defaultImage,
          images: initialImages,
          details: [
            ...(wikiDesc ? [{ label: "Type", value: wikiDesc }] : []),
            { label: "Source", value: "Wikipedia" }
          ],
          sections: [],
          peopleAlsoSearchFor: [],
          wikipediaUrl: wikiUrl
        };
        
        // Instantly write to cache & update UI so the Wikipedia card renders at lightspeed!
        clientKnowledgePanelCache[cacheKey] = directData;
        setKnowledgePanel(directData);

        // Fetch extra images in the background asynchronously without blocking primary card rendering (highly optimized)
        axios.get(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(matchedTitle)}`)
          .then(mediaRes => {
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
              .filter(Boolean)
              .filter((img: string) => !isUnsuitedImage(img, matchedTitle)) as string[];

            if (imagesFound.length > 0) {
              const updatedImages = imagesFound.slice(0, 3);
              const updatedData = {
                ...directData,
                images: updatedImages
              };
              clientKnowledgePanelCache[cacheKey] = updatedData;
              setKnowledgePanel(prev => {
                if (prev && prev.title === wikiTitle) {
                  return {
                    ...prev,
                    images: updatedImages
                  };
                }
                return prev;
              });
            }
          })
          .catch(mediaErr => {
            console.warn("Wikipedia background media fetch failed:", mediaErr.message);
          });

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

      const response = await generateContentViaProxy({
        model: "gemini-3.5-flash",
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
        clientKnowledgePanelCache[cacheKey] = data;
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
    setIsSafeSearchIntercepted(false);
    setQuery('');
    setResults([]);
    setAiOverview(null);
    setDictionary(null);
    setLyrics(null);
    setHolidays(null);
    setMovie(null);
    setSports(null);
    setPerson(null);
    setHowTo(null);
    setOrganicFaqs([]);
    setDetectedIntent('general');
    setYoutubeVideos(null);
    setAppsData(null);
    setBusinessProfileState(null);
    setIsOverviewExpanded(false);
    setFaq([]);
    setKnowledgePanel(null);

    // Clear URL query parameters
    const url = new URL(window.location.href);
    url.search = '';
    window.history.pushState({}, '', url.toString());
  };

  const removeHistoryItem = async (item: string) => {
    const updated = userHistory.filter((h: string) => h !== item);
    setUserHistory(updated);
    if (user?.sub) {
      try {
        await setDoc(doc(db, "users", user.sub), {
          queries: updated,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (e) {
        console.error("Error removing search history:", e);
      }
    }
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
                  className="absolute inset-[-60px] rounded-full bg-linear-to-tr from-blue-600 via-sky-400 to-[#e1f2fa] blur-3xl"
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
            setIsMobileSearchOpen={setIsMobileSearchOpen}
            isPrivacyMode={isPrivacyMode}
            setIsPrivacyMode={setIsPrivacyMode}
            setIsSearchEngineModalOpen={setIsSearchEngineModalOpen}
            setActiveTab={setActiveTab}
            setIsSearching={setIsSearching}
            activeTab={activeTab}
          />
        ) : (
          <ResultsView 
            key="results"
            isPrivacyMode={isPrivacyMode}
            setIsPrivacyMode={setIsPrivacyMode}
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
            safeSearch={safeSearch}
            setSafeSearch={setSafeSearch}
            isSafeSearchIntercepted={isSafeSearchIntercepted}
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
            appsData={appsData}
            businessProfile={businessProfileState}
            lyrics={lyrics}
            holidays={holidays}
            movie={movie}
            sports={sports}
            person={person}
            youtubeVideos={youtubeVideos}
            videosLoading={videosLoading}
            setIsMobileSearchOpen={setIsMobileSearchOpen}
             howTo={howTo}
            organicFaqs={organicFaqs}
            isSemanticLoading={isSemanticLoading}
            detectedIntent={detectedIntent}
            setIsSearchEngineModalOpen={setIsSearchEngineModalOpen}
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
      <AnimatePresence>
        {isMobileSearchOpen && (
          <MobileSearchOverlay 
            query={query}
            setQuery={setQuery}
            userHistory={userHistory}
            removeHistoryItem={removeHistoryItem}
            suggestions={suggestions}
            onSearch={(q: string) => {
              setQuery(q);
              handleSearch(q, 1);
            }}
            onClose={() => setIsMobileSearchOpen(false)}
            onMicClick={toggleListening}
            fileInputRef={fileInputRef}
            imageQuery={imageQuery}
            isPrivacyMode={isPrivacyMode}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isSearchEngineModalOpen && (
          <SearchEngineGuideModal 
            isOpen={isSearchEngineModalOpen} 
            onClose={() => setIsSearchEngineModalOpen(false)} 
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDefaultToast && isSearching && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ delay: 1.0, duration: 0.4 }}
            className="fixed bottom-6 right-6 z-[999] max-w-sm bg-white border-none rounded-[24px] shadow-2xl p-4 sm:p-5 flex flex-col gap-3.5 select-none"
          >
            <div className="flex items-start justify-between gap-3 text-left">
              <div className="flex gap-2.5">
                <span className="p-1.5 bg-blue-50 text-blue-600 rounded-lg shrink-0 h-8 w-8 flex items-center justify-center">
                  <Navigation size={15} className="rotate-45" />
                </span>
                <div>
                  <h5 className="font-bold text-[13px] text-slate-800 leading-tight">Search faster with Scout</h5>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    Set Scout as your default search engine to ask questions directly from Chrome or Firefox's address bar.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDefaultToast(false);
                  localStorage.setItem('scout_default_prompt_dismissed', 'true');
                }}
                className="p-1 bg-slate-50 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors shrink-0 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center justify-end gap-2 text-[11px]">
              <button
                onClick={() => {
                  setShowDefaultToast(false);
                  localStorage.setItem('scout_default_prompt_dismissed', 'true');
                }}
                className="px-3.5 py-1.5 hover:bg-slate-50 text-slate-500 font-bold rounded-full transition-colors cursor-pointer"
              >
                No thanks
              </button>
              <button
                onClick={() => {
                  setIsSearchEngineModalOpen(true);
                  setShowDefaultToast(false);
                  localStorage.setItem('scout_default_prompt_dismissed', 'true');
                }}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full transition-colors cursor-pointer shadow-3xs"
              >
                Set Default
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MobileSearchOverlay({ query, setQuery, userHistory, removeHistoryItem, suggestions, onSearch, onClose, onMicClick, fileInputRef, imageQuery, isPrivacyMode }: any) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus the input when the overlay opens
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  const defaultChromeSuggestions = [
    "komumech",
    "google maps",
    "color picker",
    "internet speed test",
    "how to talk to gemini",
    "Modern API Integration: Built with the official @vis.gl/react-google-maps"
  ];

  const handleInsert = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    setQuery(text);
    inputRef.current?.focus();
  };

  const getFilteredSuggestions = () => {
    if (!query) {
      return defaultChromeSuggestions;
    }
    // Filter by query
    const results = defaultChromeSuggestions.filter(s => 
      s.toLowerCase().includes(query.toLowerCase())
    );
    // If suggestions are provided from props, add them
    if (suggestions && suggestions.length > 0) {
      suggestions.forEach((s: string) => {
        if (!results.includes(s)) {
          results.push(s);
        }
      });
    }
    return results;
  };

  const visibleSuggestions = getFilteredSuggestions();

  // Helper inside search overlay to highlight words
  const renderHighlightedText = (sText: string, currentQuery: string) => {
    if (!currentQuery) {
      return <span className="text-[15.5px] font-normal text-slate-800">{sText}</span>;
    }
    const queryLower = currentQuery.toLowerCase().trim();
    const queryWords = queryLower.split(/\s+/).filter(Boolean);
    const tokens = sText.split(/(\s+)/);

    return (
      <span className="text-[15.5px] text-slate-800 font-sans tracking-tight">
        {tokens.map((token, idx) => {
          const normToken = token.toLowerCase().trim();
          if (!normToken) return <React.Fragment key={idx}>{token}</React.Fragment>;

          // If the word token exists in query words as a substring or equal, keep regular font-normal. Otherwise bold it!
          const isWordInQuery = queryWords.some(qw => normToken.includes(qw) || qw.includes(normToken));
          if (isWordInQuery) {
            return (
              <span key={idx} className="font-normal text-slate-500">
                {token}
              </span>
            );
          } else {
            return (
              <span key={idx} className="font-black text-slate-900">
                {token}
              </span>
            );
          }
        })}
      </span>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-white z-[9999] flex flex-col font-sans md:hidden text-slate-800"
    >
      {/* Top Search Bar area styled EXACTLY like the user's screenshot */}
      <div className="bg-white px-4 py-3 border-b border-slate-150 flex items-center gap-4 shrink-0 select-none">
        <button 
          onClick={onClose} 
          type="button"
          className="p-1 text-slate-800 transition-all shrink-0 border-none bg-transparent cursor-pointer active:scale-95"
        >
          <Plus size={24} className="text-slate-800 stroke-[2.5]" />
        </button>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSearch(query);
              onClose();
            }
          }}
          className="flex-1 bg-transparent border-none outline-none text-[15.5px] sm:text-[16.5px] text-slate-900 placeholder:text-slate-400 font-sans font-neutral p-0 focus:ring-0 focus:outline-none min-w-0"
          placeholder={isPrivacyMode ? "Search incognito..." : "Search Scout or type URL"}
        />

        <button 
          type="button" 
          onClick={query ? () => { setQuery(''); inputRef.current?.focus(); } : onClose} 
          className="p-1 text-slate-800 transition-colors focus:outline-none shrink-0 border-none bg-transparent cursor-pointer active:scale-95"
        >
          <X size={24} className="stroke-[2.5]" />
        </button>
      </div>

      {/* Content Area - Clean chrome suggestion list */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="flex flex-col">
          {visibleSuggestions.map((s: string, i: number) => (
            <div 
              key={i}
              onClick={() => { onSearch(s); onClose(); }}
              className="flex items-center justify-between px-4.5 py-4 hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer border-b border-slate-100"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <Search size={20} className="text-slate-400 shrink-0" />
                <span className="truncate line-clamp-1 flex-1">{renderHighlightedText(s, query)}</span>
              </div>
              <button 
                type="button"
                onClick={(e) => handleInsert(e, s)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors shrink-0 cursor-pointer ml-2"
                title="Insert suggestion into search box"
              >
                <ArrowUpLeft size={18} className="text-slate-450 stroke-[2.5]" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function HomeView({ query, setQuery, onSearch, suggestions, showSuggestions, setShowSuggestions, inputRef, searchContainerRef, user, onLogin, onLogout, onMicClick, bg, isSignoutOpen, setIsSignoutOpen, appsRef, isAppsOpen, setIsAppsOpen, imageQuery, onImageUpload, removeImageQuery, fileInputRef, userHistory, onOpenAnalytics, bgRotationMode, setBgRotationMode, setIsMobileSearchOpen, isPrivacyMode, setIsPrivacyMode, setIsSearchEngineModalOpen, setActiveTab, setIsSearching, activeTab }: any) {
  const [glowVisible, setGlowVisible] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPurpleTrail, setShowPurpleTrail] = useState(false);
  
  const prevPrivacyRef = useRef(isPrivacyMode);
  useEffect(() => {
    if (isPrivacyMode && !prevPrivacyRef.current) {
      setShowPurpleTrail(true);
      const timer = setTimeout(() => {
        setShowPurpleTrail(false);
      }, 1600);
      return () => clearTimeout(timer);
    }
    prevPrivacyRef.current = isPrivacyMode;
  }, [isPrivacyMode]);

  useEffect(() => {
    const t = setTimeout(() => setGlowVisible(false), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const textarea = inputRef?.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const sH = textarea.scrollHeight;
    textarea.style.height = `${Math.min(sH, 160)}px`;
    // If scroll height is greater than 36px, it means the text wraps and has expanded
    setIsExpanded(sH > 36);
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
           <span className="font-display font-black text-2xl tracking-tighter bg-clip-text text-transparent bg-linear-to-t from-[#9333ea] to-white drop-shadow-lg select-none">Scout</span>
        </div>
        <div className="flex items-center gap-3">
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
          className="relative px-2 xs:px-4 w-full max-w-2xl mx-auto"
        >
          {/* MOBILE SEARCH BAR TRIGGER (Replaces wrapping textarea with a clean, static, non-wrapping Google-like search bar on mobile) */}
          <div 
            onClick={() => setIsMobileSearchOpen(true)}
            className="flex items-center justify-between pl-4.5 pr-4 py-3 bg-white border border-slate-200/90 shadow-2xl rounded-full w-full cursor-pointer select-none md:hidden text-left"
          >
            <div className="flex items-center gap-3.5 flex-1 min-w-0 pr-2">
              <Search size={20} className="text-slate-500 shrink-0" />
              <span className="flex-1 text-[16px] font-normal text-slate-800 placeholder:text-slate-400 truncate">
                {query || (isPrivacyMode ? "Search incognito..." : "Ask Scout anything...")}
              </span>
              {query && (
                <button 
                  type="button" 
                  onClick={(e) => { e.stopPropagation(); setQuery(''); }} 
                  className="p-1 text-slate-500 hover:text-slate-700 focus:outline-none shrink-0"
                >
                  <X size={20} />
                </button>
              )}
            </div>
            
            <div className="flex items-center gap-2.5 shrink-0 pl-1">
              <div className="h-5 w-[1px] bg-slate-200 shrink-0" />
              <button 
                type="button" 
                onClick={(e) => { e.stopPropagation(); onMicClick(); }}
                className="p-1 hover:bg-slate-100 rounded-full text-slate-600 active:scale-95 transition-all select-none focus:outline-none bg-transparent border-none shrink-0"
              >
                <Mic size={20} />
              </button>
            </div>
          </div>

          {/* DESKTOP SEARCH BAR */}
          <form 
            onSubmit={(e) => { e.preventDefault(); onSearch(); }}
            className={`hidden md:flex relative items-center gap-3 px-5 py-3 transition-all duration-300 bg-white shadow-2xl ${
              showSuggestions && suggestions.length > 0 
                ? (isExpanded ? 'rounded-t-2xl' : 'rounded-t-[1.75rem]') 
                : (isExpanded ? 'rounded-2xl' : 'rounded-full')
            }`}
          >
            {/* Spinning colorful gradient border (3-sec load effect, thinner) */}
            <div className={`absolute -inset-[0.6px] pointer-events-none z-0 overflow-hidden transition-opacity duration-1000 ${
              showSuggestions && suggestions.length > 0 
                ? (isExpanded ? 'rounded-t-2xl rounded-b-none border-b-0' : 'rounded-t-[1.75rem] rounded-b-none border-b-0') 
                : (isExpanded ? 'rounded-2xl' : 'rounded-full')
            } ${glowVisible ? 'opacity-100' : 'opacity-0'}`}>
              <div 
                className="absolute inset-[-150%] bg-[conic-gradient(from_0deg,#3b82f6,#60a5fa,#e1f2fa,#93c5fd,#3b82f6)] animate-spin"
                style={{ animationDuration: '1.5s', animationTimingFunction: 'linear' }}
              />
            </div>
            {/* Mask to lock border width */}
            <div className={`absolute inset-[0.4px] bg-white pointer-events-none z-0 ${
              showSuggestions && suggestions.length > 0 
                ? (isExpanded ? 'rounded-t-2xl' : 'rounded-t-[1.75rem]') 
                : (isExpanded ? 'rounded-2xl' : 'rounded-full')
            }`} />

            <Search className="text-slate-900 transition-colors shrink-0 relative z-10" size={20} />
            
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
                onFocus={() => {
                  if (window.innerWidth < 768) {
                    setIsMobileSearchOpen(true);
                    inputRef?.current?.blur();
                  } else {
                    setShowSuggestions(true);
                  }
                }}
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
                placeholder={
                  imageQuery 
                    ? "Visual Search Active" 
                    : isPrivacyMode 
                      ? "Search incognito..." 
                      : activeTab === 'ai' 
                        ? "Ask Scout AI..." 
                        : activeTab === 'images' 
                          ? "Search Scout Images..." 
                          : activeTab === 'videos' 
                            ? "Search Scout Videos..." 
                            : activeTab === 'news' 
                              ? "Search Scout News..." 
                              : activeTab === 'developer' 
                                ? "Search Developer Docs..." 
                                : activeTab === 'docs' 
                                  ? "Search Documentation..." 
                                  : activeTab === 'memes' 
                                    ? "Search Memes..." 
                                    : "Search Scout or type URL"
                } 
                style={{
                  resize: 'none',
                  height: 'auto',
                  maxHeight: '160px'
                }}
                className="w-full flex-1 bg-transparent border-none outline-none text-inherit placeholder:text-slate-400 overflow-y-auto animate-caret py-0 pr-6 pl-0 font-normal leading-relaxed" 
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
                className="p-1 px-1.5 flex items-center justify-center text-slate-900 hover:scale-110 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
                title="Visual Search (Scout Vision)"
              >
                <Camera size={20} className="text-slate-950" />
              </button>
              <button 
                onClick={onMicClick} 
                type="button" 
                className="p-1 px-1.5 flex items-center justify-center text-slate-900 hover:scale-110 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
                title="Search by voice"
              >
                <Mic size={20} className="text-slate-950" />
              </button>

              {/* AI Mode Pillar Pill Button inside search bar */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('ai');
                  if (query.trim()) {
                    onSearch(query);
                  } else {
                    setIsSearching(true);
                  }
                }}
                className="flex items-center gap-1 px-3.5 h-9 text-slate-900 text-xs font-bold hover:scale-105 transition-all border-none bg-transparent cursor-pointer select-none shrink-0"
              >
                <span>AI Mode</span>
              </button>
            </div>

            <AnimatePresence>
              {showSuggestions && suggestions.length > 0 && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="absolute top-full left-0 right-0 rounded-b-[1.75rem] border border-slate-200 border-t-0 bg-white py-3 shadow-2xl z-50 text-left overflow-hidden"
                >
                  {suggestions.map((s: string, i: number) => (
                    <button key={i} onClick={() => { setQuery(s); onSearch(s); setShowSuggestions(false); }} className="w-full px-8 py-3 flex items-center gap-4 text-slate-700 hover:bg-slate-50 transition-colors">
                      <Search size={18} className="text-slate-300" /> <span className="font-medium truncate">{s}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        </motion.div>

        {/* Google-like Sub-Search Buttons (AI Mode & Incognito) */}
        <motion.div
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex items-center justify-center gap-2 sm:gap-4 w-full max-w-[340px] xs:max-w-sm mx-auto px-1.5 xs:px-4"
        >
          {/* AI Mode with solid thick border wrapping layout */}
          <div className="flex-1 relative p-[1.5px] rounded-full overflow-hidden bg-white/20 hover:bg-white/40 transition-all duration-300">
            <button
              type="button"
              onClick={() => {
                setQuery("Explain quantum computing in simple terms");
                if (inputRef && inputRef.current) {
                  inputRef.current.focus();
                }
              }}
              className="w-full py-2.5 px-3 sm:px-5 rounded-full text-[13px] sm:text-[14px] font-semibold bg-slate-950/45 text-slate-200 hover:bg-slate-950/65 flex items-center justify-center gap-1.5 sm:gap-2 select-none shadow-md backdrop-blur-md cursor-pointer duration-200 relative z-10 whitespace-nowrap"
            >
              <span>AI Mode</span>
            </button>
          </div>

          {/* Incognito button with custom orbital purple trail transition */}
          <div
            className={`flex-1 relative p-[1.5px] rounded-full overflow-hidden transition-all duration-300 ${
              isPrivacyMode 
                ? 'bg-white' 
                : 'bg-white/20 hover:bg-white/40'
            }`}
          >
            {/* The rotating purple light trail */}
            <AnimatePresence>
              {showPurpleTrail && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-[0.5px] pointer-events-none rounded-full overflow-hidden z-0"
                >
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ ease: "linear", duration: 1.2, repeat: Infinity }}
                    className="absolute inset-[-150%] bg-[conic-gradient(from_0deg,transparent_55%,#c084fc_80%,#a855f7_100%)]"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Injected mask for the button context */}
            <button
              type="button"
              onClick={() => setIsPrivacyMode(!isPrivacyMode)}
              className={`w-full py-2.5 px-3 sm:px-5 rounded-full text-[13px] sm:text-[14px] font-semibold flex items-center justify-center gap-1.5 sm:gap-2 select-none shadow-md backdrop-blur-md cursor-pointer duration-200 relative z-10 whitespace-nowrap ${
                isPrivacyMode 
                  ? 'bg-slate-900 text-white' 
                  : 'bg-slate-950/45 text-slate-200 hover:bg-slate-950/65'
              }`}
            >
              <Glasses size={16} className={isPrivacyMode ? 'text-white' : 'text-slate-300'} />
              <span>Incognito</span>
            </button>
          </div>
        </motion.div>

        {/* Recently Searched Shelf */}
        {user && userHistory.length > 0 && !showSuggestions && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-4 pt-4"
          >
            <div className="flex items-center gap-2 text-white/50 text-[11px] font-bold uppercase tracking-widest">
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

function GoogleBusinessProfileCard({ profile, query }: { profile: any; query?: string }) {
  const [isHoursExpanded, setIsHoursExpanded] = React.useState(false);
  const [isSaved, setIsSaved] = React.useState(false);

  const isDirectionsQuery = React.useMemo(() => {
    if (!query) return false;
    const q = query.toLowerCase();
    return q.includes('direction') || q.includes('route') || q.includes('navigate') || q.includes('get to') || q.includes('way to') || q.includes('how do i get') || q.includes('drive to') || q.includes('walk to') || q.includes('map to');
  }, [query]);

  const [showNavigationMap, setShowNavigationMap] = React.useState(false);

  React.useEffect(() => {
    if (isDirectionsQuery) {
      setShowNavigationMap(true);
    }
  }, [isDirectionsQuery]);

  if (!profile) return null;

  const destinationCoords = {
    latitude: profile.location?.latitude || profile.location?.lat || 37.4220,
    longitude: profile.location?.longitude || profile.location?.lng || -122.0841,
    name: profile.name,
    address: profile.address
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }} 
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-3xl overflow-hidden shadow-xs text-left mb-6 font-sans w-full"
    >
      {/* Map preview */}
      <div className="relative h-32 w-full overflow-hidden bg-slate-100">
        <img 
          src={profile.mapPreviewImage && profile.mapPreviewImage.startsWith('http') ? `/api/proxy-image?url=${encodeURIComponent(profile.mapPreviewImage)}` : profile.mapPreviewImage} 
          className="w-full h-full object-cover grayscale brightness-90 animate-fade-in" 
          alt="Map location preview"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/15 to-transparent pointer-events-none" />
        {/* Map Pin marker badge */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-rose-600 text-white rounded-full p-2 shadow-md border-2 border-white animate-bounce" style={{ animationDuration: '3s' }}>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
          </svg>
        </div>
      </div>

      <div className="p-5">
        {/* Claimed Badge & Business Info */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-bold border border-emerald-100 uppercase tracking-wider">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 shrink-0">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              Profile Claimed
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Verified listing</span>
          </div>
        </div>

        <h2 className="text-xl font-display font-medium text-slate-900 tracking-tight leading-snug mb-0.5">{profile.name}</h2>
        <p className="text-[12.5px] text-slate-500 font-normal mb-3">{profile.category}</p>

        {/* Rating and Reviews */}
        <div className="flex items-center gap-1.5 mb-4 border-b border-slate-100 pb-4">
          <span className="text-sm font-bold text-slate-800">{profile.rating}</span>
          <div className="flex text-amber-400 text-xs gap-0.5">
            {"★".repeat(Math.floor(profile.rating))}
            {profile.rating % 1 !== 0 ? "★" : ""}
          </div>
          <span className="text-xs text-blue-600 hover:underline cursor-pointer font-medium">
            {profile.reviewsCount} Google reviews
          </span>
        </div>

        {/* Action Buttons: Google-style grey pill bg and black icon/text */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <a 
            href={profile.website} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 py-2.5 px-0.5 rounded-2xl bg-[#f1f3f4] hover:bg-[#e8eaed] text-slate-900 font-medium text-xs transition-colors group/btn cursor-pointer text-center"
          >
            <div className="w-5 h-5 flex items-center justify-center text-slate-900 shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </div>
            <span className="text-[10.5px] tracking-tight font-semibold text-slate-800 group-hover/btn:text-black">Website</span>
          </a>

          <a 
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(profile.name + ' ' + profile.address)}`}
            target="_blank" 
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 py-2.5 px-0.5 rounded-2xl bg-[#f1f3f4] hover:bg-[#e8eaed] text-slate-900 font-medium text-xs transition-colors group/btn cursor-pointer text-center"
          >
            <div className="w-5 h-5 flex items-center justify-center text-slate-900 shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
                <line x1="9" y1="3" x2="9" y2="18" />
                <line x1="15" y1="6" x2="15" y2="21" />
              </svg>
            </div>
            <span className="text-[10.5px] tracking-tight font-semibold text-slate-800 group-hover/btn:text-black">Directions</span>
          </a>

          <button 
            type="button"
            onClick={() => setIsSaved(!isSaved)}
            className="flex flex-col items-center gap-1.5 py-2.5 px-0.5 rounded-2xl bg-[#f1f3f4] hover:bg-[#e8eaed] text-slate-900 font-medium text-xs transition-colors group/btn cursor-pointer text-center border-none"
          >
            <div className="w-5 h-5 flex items-center justify-center text-slate-900 shrink-0">
              <svg 
                viewBox="0 0 24 24" 
                fill={isSaved ? "currentColor" : "none"} 
                stroke="currentColor" 
                strokeWidth="2.5" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                className={`w-4 h-4 ${isSaved ? "text-amber-500" : "text-slate-950"}`}
              >
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <span className="text-[10.5px] tracking-tight font-semibold text-slate-800 group-hover/btn:text-black">
              {isSaved ? "Saved" : "Save"}
            </span>
          </button>

          <a 
            href={`tel:${profile.phone}`}
            className="flex flex-col items-center gap-1.5 py-2.5 px-0.5 rounded-2xl bg-[#f1f3f4] hover:bg-[#e8eaed] text-slate-900 font-medium text-xs transition-colors group/btn cursor-pointer text-center"
          >
            <div className="w-5 h-5 flex items-center justify-center text-slate-900 shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>
            <span className="text-[10.5px] tracking-tight font-semibold text-slate-800 group-hover/btn:text-black">Call</span>
          </a>
        </div>

        {/* Detailed Contacts Lists */}
        <div className="space-y-3.5 pt-4 border-t border-slate-100 text-[13px] text-slate-700 leading-relaxed">
          <div className="flex items-start gap-2.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-slate-400 shrink-0 mt-0.5">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="font-normal text-slate-600">{profile.address}</span>
          </div>

          <div className="flex items-start gap-2.5 relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-slate-400 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <div className="flex-1">
              <button 
                type="button"
                onClick={() => setIsHoursExpanded(!isHoursExpanded)} 
                className="flex items-center gap-1.5 font-semibold text-emerald-600 hover:underline text-[13px] focus:outline-none border-none bg-transparent p-0 cursor-pointer"
              >
                <span>{profile.hours}</span>
                <span className={`text-[9px] text-slate-400 transition-transform duration-200 ${isHoursExpanded ? 'rotate-180' : ''}`}>▼</span>
              </button>
              {isHoursExpanded && (
                <div className="mt-2 p-3 bg-slate-50 rounded-xl text-xs space-y-1.5 text-slate-600">
                  <div className="flex justify-between"><span>Monday</span><span>9:00 AM – 5:00 PM</span></div>
                  <div className="flex justify-between font-semibold text-slate-800"><span>Tuesday</span><span>9:00 AM – 5:00 PM</span></div>
                  <div className="flex justify-between"><span>Wednesday</span><span>9:00 AM – 5:00 PM</span></div>
                  <div className="flex justify-between"><span>Thursday</span><span>9:00 AM – 5:00 PM</span></div>
                  <div className="flex justify-between"><span>Friday</span><span>9:00 AM – 5:00 PM</span></div>
                  <div className="flex justify-between text-slate-400"><span>Saturday</span><span>Closed</span></div>
                  <div className="flex justify-between text-slate-400"><span>Sunday</span><span>Closed</span></div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-slate-400 shrink-0 mt-0.5">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span className="font-normal text-slate-650">{profile.phone}</span>
          </div>

          <div className="flex items-start gap-2.5 pt-3.5 border-t border-slate-50 text-[11px] text-slate-400 font-medium">
             <span>Is this your business? </span>
             <a href={`https://business.google.com`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Claim it now</a>
          </div>

          {/* Real-time Embedded GP Companion Navigation System */}
          <div className="mt-4 pt-1">
            <button
              type="button"
              onClick={() => setShowNavigationMap(!showNavigationMap)}
              className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all duration-200 cursor-pointer border border-slate-200/50 ${
                showNavigationMap 
                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-600' 
                  : 'bg-slate-900 hover:bg-black text-white'
              }`}
            >
              <Navigation size={13.5} className="" />
              {showNavigationMap ? "Hide Directions" : "Show Directions"}
            </button>

            <AnimatePresence>
              {showNavigationMap && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="overflow-hidden mt-3.5 -mx-5 -mb-5 rounded-b-3xl"
                >
                  <NavigationMap destination={destinationCoords} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function AppStoreIcon({ src, title }: { src: string; title: string }) {
  const [hasError, setHasError] = React.useState(false);

  React.useEffect(() => {
    setHasError(false);
  }, [src]);

  const getGradient = (text: string) => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = text.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      "from-indigo-500 to-indigo-600 text-indigo-50",
      "from-blue-500 to-blue-600 text-blue-50",
      "from-emerald-500 to-emerald-600 text-emerald-50",
      "from-rose-500 to-rose-600 text-rose-50",
      "from-amber-500 to-amber-600 text-amber-50",
      "from-violet-500 to-violet-600 text-violet-50",
      "from-sky-500 to-sky-600 text-sky-50",
      "from-fuchsia-500 to-fuchsia-600 text-fuchsia-50",
      "from-teal-500 to-teal-600 text-teal-105",
      "from-pink-500 to-pink-600 text-pink-50"
    ];
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  const initial = title ? title.trim().charAt(0).toUpperCase() : "?";

  if (!src || hasError) {
    return (
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-display font-semibold text-[19px] shadow-xs bg-gradient-to-tr ${getGradient(title)} shrink-0 select-none`}>
        {initial}
      </div>
    );
  }

  const proxiedSrc = src && src.startsWith('http') ? `/api/proxy-image?url=${encodeURIComponent(src)}` : src;

  // Use natural favicon representation as an elegant backup
  return (
    <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0 shadow-xs relative hover:scale-[1.03] transition-transform">
      <img
        src={proxiedSrc}
        className="w-full h-full object-cover rounded-xl"
        referrerPolicy="no-referrer"
        alt={title}
        onError={() => setHasError(true)}
      />
    </div>
  );
}

function AppsBlock({ appsData }: { appsData: any[] | null }) {
  if (!appsData || appsData.length === 0) return null;

  return (
    <div className="bg-white shadow-xs rounded-3xl p-5 mb-6 text-left">
      <div className="flex items-center gap-2 mb-4">
        {/* Apple Store Blue Round Badge Icon */}
        <div className="w-6.5 h-6.5 rounded-lg bg-[#007aff] flex items-center justify-center text-white shrink-0 shadow-sm">
          {/* Apple App Store Custom Vector A Logo */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <line x1="6" y1="18" x2="18" y2="6" stroke="white" />
            <path d="M18 18H6l6-12 6 12z" stroke="white" fill="none" />
          </svg>
        </div>
        <h3 className="text-[19px] font-display font-medium text-slate-900 tracking-tight">Apps</h3>
      </div>
      
      <div className="space-y-3.5 divide-y divide-slate-100">
        {appsData.map((app: any, i: number) => (
          <a
            key={i}
            href={app.link}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-4 group/app w-full text-left transition-all rounded-2xl ${i > 0 ? "pt-3.5" : ""}`}
          >
            {/* App Icon using robust and gorgeous state fallback */}
            <AppStoreIcon src={app.icon} title={app.title} />
            
            {/* App Details */}
            <div className="flex-1 min-w-0">
              <h4 className="text-[15px] font-medium text-[#1a0dab] line-clamp-1 group-hover/app:underline leading-snug">
                {app.title}
              </h4>
              
              <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-600 font-normal">
                <span className="font-semibold text-slate-800">{app.rating}</span>
                <span className="text-amber-500 text-[11px]">★</span>
                <span className="text-slate-400">({app.reviews})</span>
              </div>
              
              <p className="text-[12px] text-slate-400 font-normal mt-0.5 truncate uppercase tracking-tight">
                {app.category}
              </p>
            </div>
          </a>
        ))}
      </div>

      {/* Google-style bottom direct more button centered in and grey bg with black text */}
      <div className="flex justify-center mt-4 pt-3.5 border-t border-slate-100">
        <a
          href="https://apps.apple.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 bg-[#f1f3f4] hover:bg-[#e8eaed] text-slate-900 px-6 py-2 rounded-full font-medium text-[13px] transition-all duration-150 active:scale-95 cursor-pointer decoration-none"
        >
          <span>More apps</span>
          <ChevronRight size={14} className="stroke-[2.5]" />
        </a>
      </div>
    </div>
  );
}

function LyricsSection({ lyrics }: { lyrics: any }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!lyrics || !lyrics.lyrics) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(lyrics.lyrics);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = lyrics.lyrics.split('\n');
  const showMoreButton = lines.length > 12;
  const displayedLines = expanded || !showMoreButton ? lines : lines.slice(0, 12);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-[24px] sm:rounded-3xl p-4 sm:p-6 md:p-8 transition-all mb-6 shadow-xs overflow-hidden"
    >
      <div className="flex items-start justify-between mb-4 pb-4 border-b border-slate-100 gap-4">
        <div>
          <div className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-1 flex items-center gap-1.5 font-mono">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            Song Lyrics
          </div>
          <h2 className="text-2xl font-display font-black text-slate-900 tracking-tight leading-tight">{lyrics.songTitle}</h2>
          <p className="text-slate-600 font-medium text-sm mt-1">
            by <span className="font-bold text-slate-800">{lyrics.artist}</span>
            {lyrics.album && <> • <span className="italic text-slate-500">{lyrics.album}</span></>}
            {lyrics.releaseYear && ` (${lyrics.releaseYear})`}
          </p>
        </div>

        <button 
          onClick={handleCopy}
          className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full font-bold text-xs transition-all active:scale-95 cursor-pointer whitespace-nowrap flex items-center gap-1.5"
        >
          {copied ? (
            <>
              <Check size={13} className="text-emerald-700 stroke-[3]" />
              <span className="text-emerald-700 font-bold">Copied</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <div className="text-slate-700 text-[15px] font-sans leading-relaxed whitespace-pre-line pl-3 border-l-2 border-blue-500 font-medium">
        {displayedLines.join('\n')}
      </div>

      {showMoreButton && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-4 w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-800 rounded-xl font-bold text-xs tracking-wider uppercase transition-all duration-150 active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1"
        >
          {expanded ? 'Show less' : `Show all lyrics (${lines.length} lines)`}
        </button>
      )}
    </motion.div>
  );
}

function HolidaysSection({ holidays, onSearch, setQuery }: { holidays: any; onSearch: any; setQuery: any }) {
  const [filter, setFilter] = useState<'all' | 'upcoming'>('upcoming');
  
  if (!holidays || !holidays.holidays || holidays.holidays.length === 0) return null;

  // May 29, 2026 is the current system date as provided by metadata environment context
  const currentDate = new Date('2026-05-29');

  // Parse and sort holidays by date
  const sortedHolidays = [...holidays.holidays].map((h: any) => {
    const hDate = new Date(h.date);
    const diffTime = hDate.getTime() - currentDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return { ...h, dateObj: hDate, daysRemaining: diffDays };
  }).sort((a: any, b: any) => a.dateObj.getTime() - b.dateObj.getTime());

  // Split into upcoming and past
  const upcomingHolidays = sortedHolidays.filter((h: any) => h.daysRemaining >= 0);
  const displayedHolidays = filter === 'upcoming' ? upcomingHolidays : sortedHolidays;

  // The very next upcoming holiday
  const nextHoliday = upcomingHolidays[0];

  const handleCountrySwitch = (countryName: string) => {
    setQuery(`public holidays in ${countryName}`);
    // Trigger query search execution
    setTimeout(() => {
      onSearch();
    }, 50);
  };

  const countriesList = [
    { name: 'Nigeria', code: 'NG' },
    { name: 'United States', code: 'US' },
    { name: 'United Kingdom', code: 'GB' },
    { name: 'Canada', code: 'CA' },
    { name: 'India', code: 'IN' },
    { name: 'Germany', code: 'DE' },
    { name: 'France', code: 'FR' },
    { name: 'Australia', code: 'AU' }
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-[24px] sm:rounded-3xl p-4 sm:p-6 md:p-8 transition-all mb-6 shadow-xs overflow-hidden"
    >
      {/* Widget Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 mb-5">
        <div>
          <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1 flex items-center gap-1.5 font-mono">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            National Calendar Insight
          </div>
          <h2 className="text-2xl font-display font-black text-slate-800 tracking-tight leading-tight flex items-center gap-2">
            Holidays in {holidays.country}
            <span className="text-sm font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md font-mono">{holidays.year}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Displaying calendar observances and bank holidays. Filters can be updated dynamically.
          </p>
        </div>

        {/* Region / Country Switcher */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold text-slate-400 mr-1 uppercase tracking-tight font-mono">Filter Region:</span>
          {countriesList.map((country) => (
            <button
              key={country.code}
              onClick={() => handleCountrySwitch(country.name)}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all active:scale-95 cursor-pointer border ${
                holidays.country.toLowerCase() === country.name.toLowerCase() || holidays.countryCode?.toUpperCase() === country.code
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100 shadow-3xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-100'
              }`}
            >
              {country.name}
            </button>
          ))}
        </div>
      </div>

      {/* Upcoming Celebration Highlight Hero Banner */}
      {nextHoliday && (
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl p-5 text-white mb-5 relative overflow-hidden shadow-sm">
          <div className="absolute right-0 bottom-0 translate-x-1/10 translate-y-1/10 opacity-10">
            <svg className="w-48 h-48" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 19H5V8h14m-3-7v2H8V1H6v2H5c-1.11 0-2 .89-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2h-1V1m-1 11h-5v5h5v-5z" />
            </svg>
          </div>
          <div className="relative z-10">
            <span className="bg-white/20 text-white font-mono text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full backdrop-blur-md">
              Next Celebration Banner
            </span>
            <h3 className="text-xl md:text-2xl font-black font-display tracking-tight mt-3 leading-tight">
              {nextHoliday.name}
            </h3>
            <p className="text-white/80 text-sm font-medium mt-1">
              On <span className="font-bold underline">{new Date(nextHoliday.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span> • {nextHoliday.type}
            </p>
            <div className="mt-4 flex items-center gap-2 text-xs font-bold">
              <div className="bg-white/10 px-3 py-1.5 rounded-lg flex items-center gap-1.5 backdrop-blur-md border border-white/10">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {nextHoliday.daysRemaining === 0 ? "Celebrating Today!" : `${nextHoliday.daysRemaining} days remaining`}
              </div>
              <button
                onClick={() => {
                  setQuery(`origin of ${nextHoliday.name} holiday in ${holidays.country}`);
                  setTimeout(() => onSearch(), 50);
                }}
                className="bg-white text-emerald-800 hover:bg-slate-50 transition-colors px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 shadow-sm"
              >
                <Search size={12} className="stroke-[2.5]" />
                Explore origin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter / Toggle List Segment */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-150">
          <button
            onClick={() => setFilter('upcoming')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filter === 'upcoming' 
                ? 'bg-white text-slate-800 shadow-2xs' 
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Upcoming ({upcomingHolidays.length})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filter === 'all' 
                ? 'bg-white text-slate-800 shadow-2xs' 
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            All Holidays ({sortedHolidays.length})
          </button>
        </div>
        <span className="text-[10px] font-bold text-slate-400 font-mono">System date: May 29, 2026</span>
      </div>

      {/* Holidays Grid Display */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {displayedHolidays.map((h: any, idx: number) => {
          const isNext = nextHoliday && nextHoliday.name === h.name;
          return (
            <div 
              key={idx}
              className={`p-4 border rounded-2xl flex items-start justify-between gap-4 transition-all ${
                isNext 
                  ? 'bg-emerald-50/40 border-emerald-100 ring-2 ring-emerald-500/5' 
                  : h.daysRemaining < 0 
                    ? 'bg-slate-50/50 border-slate-100 opacity-60'
                    : 'bg-white border-slate-100 hover:border-slate-200 hover:shadow-2xs'
              }`}
            >
              <div className="min-w-0">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider font-mono mb-1.5 ${
                  isNext 
                    ? 'bg-emerald-100 text-emerald-800' 
                    : h.daysRemaining < 0 
                      ? 'bg-slate-200 text-slate-600'
                      : 'bg-slate-100 text-slate-700'
                }`}>
                  {h.type || 'Holiday'}
                </span>
                <h4 className="font-bold text-slate-800 text-[14px] leading-snug truncate" title={h.name}>{h.name}</h4>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  {new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ({h.dayOfWeek})
                </p>
              </div>
              
              <div className="shrink-0 text-right self-stretch flex flex-col justify-between items-end">
                {h.daysRemaining === 0 ? (
                  <span className="text-[10px] font-black text-emerald-600 font-mono uppercase bg-emerald-100 px-2 py-0.5 rounded animate-pulse">TODAY</span>
                ) : h.daysRemaining < 0 ? (
                  <span className="text-[10px] font-bold text-slate-400 font-mono">{Math.abs(h.daysRemaining)}d ago</span>
                ) : (
                  <span className="text-[10px] font-bold text-slate-600 font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-150">in {h.daysRemaining}d</span>
                )}
                <button
                  onClick={() => {
                    setQuery(`history of ${h.name} in ${holidays.country}`);
                    setTimeout(() => onSearch(), 50);
                  }}
                  className="block mt-2 text-[10px] font-bold text-blue-600 hover:underline transition-all cursor-pointer whitespace-nowrap text-right"
                >
                  History
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function VideoStrip({ youtubeVideos, loading, onMore, query = '' }: { youtubeVideos: any[] | null, loading: boolean, onMore: () => void, query?: string }) {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [isSuggestedPlaying, setIsSuggestedPlaying] = useState<boolean>(false);

  if (loading) {
    return (
      <div className="mb-8 animate-pulse">
        <div className="h-6 bg-slate-100 rounded w-1/4 mb-4"></div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-4 sm:gap-6 py-3 border-t border-slate-100">
              <div className="w-[130px] sm:w-[170px] aspect-video bg-slate-100 rounded-xl shrink-0"></div>
              <div className="flex-1 space-y-2 py-1">
                <div className="h-4 bg-slate-105 rounded w-5/6"></div>
                <div className="h-3 bg-slate-105 rounded w-1/3"></div>
                <div className="h-2.5 bg-slate-105 rounded w-1/4"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!youtubeVideos || youtubeVideos.length === 0) return null;

  const displayVideos = youtubeVideos.slice(0, 3);
  const suggestedVideo = youtubeVideos[0];
  const otherVideos = youtubeVideos.slice(1, 3); // Get up to 2 other normal videos

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8 font-sans bg-transparent border-none p-0"
    >
      {/* Header section */}
      <div className="flex items-center gap-1.5 mb-4 text-slate-900 border-none">
        <h3 className="font-sans font-normal text-[20px] leading-snug">Videos</h3>
        <svg className="w-5 h-5 text-slate-400 hover:text-slate-600 cursor-pointer ml-1" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
        </svg>
      </div>

      {/* Expanded Suggested Video (as a borderless shadowless card) */}
      {suggestedVideo && (
        <div className="w-full max-w-[652px] mb-6 border-none shadow-none bg-transparent p-0">
          <div className="text-[12px] font-bold uppercase tracking-widest text-[#5f6368] mb-2.5">Suggested Video</div>
          <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black relative shadow-none border-none">
            {isSuggestedPlaying ? (
              <iframe 
                width="100%" 
                height="100%" 
                src={`https://www.youtube.com/embed/${suggestedVideo.id}?autoplay=1&rel=0`} 
                title={suggestedVideo.title} 
                frameBorder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                allowFullScreen 
                className="w-full h-full border-none"
              />
            ) : (
              <div 
                className="absolute inset-0 cursor-pointer group"
                onClick={() => setIsSuggestedPlaying(true)}
              >
                <img 
                  src={suggestedVideo.thumbnail || `https://img.youtube.com/vi/${suggestedVideo.id}/mqdefault.jpg`} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  alt={suggestedVideo.title}
                />
                
                {/* Centered play button overlay */}
                <div className="absolute inset-0 bg-black/10 group-hover:bg-black/25 transition-colors flex items-center justify-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 bg-white/95 text-slate-800 rounded-full flex items-center justify-center scale-95 group-hover:scale-100 transition-all shadow-md duration-300">
                    <Play size={20} fill="currentColor" className="ml-1 text-slate-800" />
                  </div>
                </div>
                
                {/* Bottom-left duration badge */}
                {suggestedVideo.duration && (
                  <span className="absolute bottom-3 left-3 bg-black/85 text-white font-mono text-xs font-medium px-2 py-0.5 rounded tracking-wide">
                    {suggestedVideo.duration}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="mt-3">
            <h4 
              className="font-sans font-medium text-[#1a0dab] text-[17px] sm:text-[19px] leading-snug hover:underline cursor-pointer"
              onClick={() => setIsSuggestedPlaying(true)}
            >
              {suggestedVideo.title}
            </h4>
            
            <div className="text-[13px] sm:text-[14px] text-slate-500 font-normal leading-relaxed mt-1 flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-slate-700">{suggestedVideo.channelTitle}</span>
              <span>·</span>
              <span>YouTube</span>
              {suggestedVideo.publishedTime && (
                <>
                  <span>·</span>
                  <span className="text-slate-400">{suggestedVideo.publishedTime}</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Remaining normal videos list */}
      {otherVideos.length > 0 && (
        <div className="flex flex-col border-t border-slate-200/60 pt-2 w-full max-w-[652px]">
          {otherVideos.map((vid: any) => {
            const isPlaying = activeVideoId === vid.id;
            return (
              <div 
                key={vid.id} 
                className="flex gap-4 sm:gap-6 py-4 border-b border-slate-200/40 last:border-b-0"
              >
                {/* Left Column: Thumbnail / Video Player */}
                <div 
                  className="w-[120px] sm:w-[150px] aspect-video rounded-xl overflow-hidden bg-black shrink-0 relative shadow-2xs cursor-pointer group"
                  onClick={() => setActiveVideoId(isPlaying ? null : vid.id)}
                >
                  {isPlaying ? (
                    <iframe 
                      width="100%" 
                      height="100%" 
                      src={`https://www.youtube.com/embed/${vid.id}?autoplay=1&rel=0`} 
                      title={vid.title} 
                      frameBorder="0" 
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                      allowFullScreen 
                      className="w-full h-full border-none"
                    />
                  ) : (
                    <>
                      <img 
                        src={vid.thumbnail || `https://img.youtube.com/vi/${vid.id}/mqdefault.jpg`} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        alt={vid.title}
                      />
                      
                      {/* Centered play button overlay */}
                      <div className="absolute inset-0 bg-black/5 group-hover:bg-black/25 transition-colors flex items-center justify-center">
                        <div className="w-8 h-8 rounded-full bg-white/95 scale-95 group-hover:scale-100 transition-all shadow-md flex items-center justify-center text-slate-800 opacity-90 group-hover:opacity-100">
                          <Play size={12} fill="currentColor" className="ml-0.5" />
                        </div>
                      </div>
                      
                      {/* Bottom-left duration badge */}
                      {vid.duration && (
                        <span className="absolute bottom-1 right-1 bg-black/80 text-white font-mono text-[9px] sm:text-[10px] font-medium px-1 py-0.2 rounded tracking-wide">
                          {vid.duration}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Right Column: Information details in Google style */}
                <div className="flex-1 min-w-0">
                  <h4 
                    className="font-sans font-normal text-[#1a0dab] text-[14px] sm:text-[16px] leading-tight hover:underline cursor-pointer line-clamp-2"
                    onClick={() => setActiveVideoId(isPlaying ? null : vid.id)}
                  >
                    {vid.title}
                  </h4>
                  
                  <div className="text-[12px] sm:text-[13px] text-slate-500 font-normal leading-relaxed mt-1 flex items-center gap-1.5 flex-wrap">
                    <span>YouTube</span>
                    <span>·</span>
                    <span>{vid.channelTitle}</span>
                  </div>

                  <div className="text-[11.5px] sm:text-[12px] text-slate-400 font-normal mt-0.5">
                    {vid.publishedTime}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Center grey pill button for "View all" */}
      <div className="flex justify-center mt-2 border-t border-slate-200/80 pt-4 w-full max-w-[652px]">
        <button 
          onClick={onMore}
          className="bg-[#f1f3f4] hover:bg-[#e8eaed] text-slate-800 text-[13px] font-sans font-semibold px-12 py-2 rounded-full flex items-center justify-center gap-1.5 transition-colors cursor-pointer border-none shadow-none"
        >
          View all <ChevronRight size={14} className="text-slate-600" />
        </button>
      </div>

      {/* Compliance Policy footer in soft grey */}
      <div className="mt-5 pt-3 flex flex-col sm:flex-row items-center justify-between text-[10px] text-slate-400 font-sans gap-2 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <span>Search integrated with <strong>YouTube™</strong>.</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">YouTube Terms</a>
          <span>•</span>
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">Privacy Policy</a>
        </div>
      </div>
    </motion.div>
  );
}


function RecipeIntegrationBox({ recipes, onResultClick, onImageError }: { recipes: any[]; onResultClick?: any; onImageError?: any }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!recipes || recipes.length === 0) return null;

  // Initially show only 4 recipes (matches the 2x2 grid in screenshot!)
  const visibleRecipes = isExpanded ? recipes : recipes.slice(0, 4);

  return (
    <div className="bg-transparent mb-8 w-full max-w-[652px] select-none">
      {/* Title & Settings Cog Line */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[20px] font-sans font-medium text-slate-900 tracking-tight flex items-center gap-1.5 leading-none">
          Recipes
        </h3>
        <div className="w-8 h-8 rounded-full bg-[#1a73e8] hover:bg-blue-700 text-white flex items-center justify-center cursor-pointer transition-colors shadow-3xs" title="Recipe Settings">
          <Settings size={15} className="stroke-[2.5]" />
        </div>
      </div>

      {/* Subfilters list (Image 2 mockup pills) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-3.5 scrollbar-none scrollbar-hide select-none" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        <div className="flex items-center gap-1 bg-[#1a73e8] text-white px-3 py-1 bg-[#1a73e8] rounded-full text-xs font-bold shadow-2xs border-none cursor-default shrink-0">
          <X size={12} className="stroke-[2.5]" />
          <span>Bacon</span>
        </div>
        <div className="bg-white border border-[#dadce0] text-slate-700 px-3.5 py-1.2 rounded-full text-xs font-medium hover:bg-slate-50 transition-all shrink-0 cursor-pointer active:scale-95 leading-relaxed">
          Quick
        </div>
        <div className="bg-white border border-[#dadce0] text-slate-700 px-3.5 py-1.2 rounded-full text-xs font-medium hover:bg-slate-50 transition-all shrink-0 cursor-pointer active:scale-95 leading-relaxed">
          Oven
        </div>
        <div className="bg-white border border-[#dadce0] text-slate-700 px-3.5 py-1.2 rounded-full text-xs font-medium hover:bg-slate-50 transition-all shrink-0 cursor-pointer active:scale-95 leading-relaxed">
          Low Calorie
        </div>
      </div>

      {/* 2x2 Recipe Grid */}
      <div className="grid grid-cols-2 gap-3.5 sm:gap-4 md:gap-5 py-1.5 select-none">
        {visibleRecipes.map((res: any, idx: number) => {
          let details: any = {};
          try {
            details = typeof res.card_details === 'string' ? JSON.parse(res.card_details) : (res.card_details || {});
          } catch (_) {
            details = {};
          }

          const cardImg = details.card_image || res.image || "https://images.unsplash.com/photo-1606787366850-de6330128bfc?q=80&w=350";
          
          return (
            <div key={res.id || idx} className="flex flex-col group/recipe-card min-w-0">
              {/* Image with overlay elements */}
              <div className="aspect-[1.15] sm:aspect-[1.25] w-full rounded-2xl overflow-hidden relative bg-slate-50 shrink-0 select-none">
                <img 
                  src={cardImg} 
                  className="w-full h-full object-cover group-hover/recipe-card:scale-[1.03] transition-transform duration-500" 
                  referrerPolicy="no-referrer"
                  alt={res.title}
                  onError={() => {
                    if (cardImg) onImageError?.(cardImg);
                  }}
                />
                
                {/* Translucent Bookmark icon top right */}
                <div 
                  className="absolute top-2 right-2 w-7.5 h-7.5 rounded-lg bg-black/45 backdrop-blur-xs flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-all cursor-pointer z-10"
                  onClick={(e) => { e.stopPropagation(); }}
                  title="Save Recipe"
                >
                  <Bookmark size={14} className="stroke-[2.5]" />
                </div>

                {/* Left & Right Chevron navigation representing dynamic item pager */}
                <div className="absolute left-2 top-1/2 -translate-y-1/2 w-6.5 h-6.5 rounded-full bg-black/35 backdrop-blur-3xs flex items-center justify-center text-white pointer-events-none opacity-85">
                  <ChevronLeft size={13} className="stroke-[2.5]" />
                </div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 w-6.5 h-6.5 rounded-full bg-black/35 backdrop-blur-3xs flex items-center justify-center text-white pointer-events-none opacity-85">
                  <ChevronRight size={13} className="stroke-[2.5]" />
                </div>

                {/* Visual Carousel Pager dots at the bottom-center */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.2 py-1 bg-black/30 backdrop-blur-xs rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-white block" />
                  <span className="w-2.2 h-[3.5px] bg-white rounded-full block" />
                  <span className="w-1.5 h-1.5 bg-white/55 rounded-full block" />
                </div>
              </div>

              {/* Text metadata block below */}
              <div className="flex-1 flex flex-col min-w-0 pt-2 bg-white">
                {/* Title Line next to 3-dots */}
                <div className="flex justify-between items-start gap-1.5 min-w-0">
                  <a 
                    href={res.url} 
                    target="_blank" 
                    rel="noreferrer"
                    onClick={() => onResultClick?.(res.id, res.url, idx + 1)}
                    className="block hover:underline shrink-0 flex-1 min-w-0 text-left"
                  >
                    <h4 className="font-sans font-medium text-[#1a0dab] text-[14.5px] sm:text-[15.5px] leading-snug line-clamp-2 pr-0.5 break-words">
                      {res.title}
                    </h4>
                  </a>
                  <div className="text-slate-400 hover:text-slate-600 cursor-pointer p-0.5 rounded-full hover:bg-slate-100 transition-colors shrink-0">
                    <MoreVertical size={16} />
                  </div>
                </div>

                {/* Subtitle publisher */}
                <span className="text-[12.5px] font-normal text-slate-500 mt-1 block text-left truncate">
                  {details.publisher || new URL(res.url).hostname.replace('www.', '')}
                </span>

                {/* Google-like star rating row matching high status display */}
                <div className="flex items-center gap-1 text-[12.5px] mt-0.5 select-none leading-none text-left">
                  <span className="text-slate-800 font-extrabold">{parseFloat(details.rating || "5.0").toFixed(1)}</span>
                  <div className="flex items-center text-amber-500 font-normal">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span key={i} className={i < Math.round(parseFloat(details.rating || "5.0")) ? "text-amber-500" : "text-slate-200"}>★</span>
                    ))}
                  </div>
                  <span className="text-slate-500 font-normal text-[11.5px] ml-0.5">({details.reviews || "52"})</span>
                </div>

                {/* Detail text caption */}
                <span className="text-[12px] text-slate-500 block text-left font-normal mt-0.5 truncate">
                  {details.ingredients || "1 ingredient"} {details.time ? `· ${details.time.replace('PT','').replace('M','m').replace('H','h')}` : "· 20m"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Large-capsule custom full width bottom toggle "More recipes" button */}
      {recipes.length > 4 && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          type="button"
          className="mt-4 w-full bg-[#f1f3f4] hover:bg-slate-200 text-slate-800 text-[13.5px] font-extrabold py-3.2 px-5 rounded-full border-none outline-none focus:outline-none flex items-center justify-center gap-1.5 text-center cursor-pointer select-none transition-all duration-200 active:scale-98"
        >
          <span>{isExpanded ? "Less recipes" : "More recipes"}</span>
          <ChevronDown size={16} className={`text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}

function ResultsView({ query, setQuery, onSearch, loading, results, error, aiOverview, dictionary, knowledgePanel, isEnglishHelp, isOverviewExpanded, setIsOverviewExpanded, faq, openFaqIndex, setOpenFaqIndex, aiLoading, activeTab, setActiveTab, page, totalPages, goHome, user, onLogin, onLogout, onMicClick, suggestions, showSuggestions, setShowSuggestions, searchContainerRef, safeSearch, setSafeSearch, isSafeSearchIntercepted, onResultClick, clickedUrls, isSignoutOpen, setIsSignoutOpen, appsRef, isAppsOpen, setIsAppsOpen, correction, originalQuery, imageQuery, onImageUpload, removeImageQuery, fileInputRef, visualMathProblem, searchStage, visualAnalysis, setImageQuery, selectedImage, setSelectedImage, aiRateLimited, onOpenAnalytics, appsData, businessProfile, lyrics, holidays, movie, sports, person, youtubeVideos, videosLoading, setIsMobileSearchOpen, howTo, organicFaqs, isSemanticLoading, detectedIntent, isPrivacyMode, setIsPrivacyMode, setIsSearchEngineModalOpen }: any) {
  const [isResInputFocused, setIsResInputFocused] = useState(false);
  const [aiOverviewCopied, setAiOverviewCopied] = useState(false);
  const [aiOverviewRating, setAiOverviewRating] = useState<'up' | 'down' | null>(null);
  const [chatInputText, setChatInputText] = useState('');

  // Keep track of broken image URLs to automatically filter them from results
  const [brokenUrls, setBrokenUrls] = useState<string[]>([]);
  const onImageError = (url: string) => {
    if (url) {
      setBrokenUrls(prev => {
        if (prev.includes(url)) return prev;
        return [...prev, url];
      });
    }
  };

  // Helper to check if a URL is an image
  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url.split('?')[0]);

  // Clean the results by omitting cards that contain a known-broken image URL
  const cleanResults = (results || []).filter((res: any) => {
    if (res.image && brokenUrls.includes(res.image)) return false;
    if (brokenUrls.includes(res.url)) return false;
    
    let cardImg = '';
    if (res.card_details) {
      try {
        const details = typeof res.card_details === 'string' ? JSON.parse(res.card_details) : res.card_details;
        cardImg = details.card_image || details.image;
      } catch (_) {}
    }
    if (cardImg && brokenUrls.includes(cardImg)) return false;
    return true;
  });

  // Group images by domain for the carousel using our cleaned up results list
  const carouselImages = cleanResults.filter((res: any) => isImageUrl(res.url));

  // Get all recipes to show inside the RecipeIntegrationBox
  const recipes = cleanResults.filter((res: any) => res.card_type === 'recipe');

  const filteredResults = activeTab === 'images' 
    ? cleanResults.filter((res: any) => isImageUrl(res.url) || res.image)
    : cleanResults.filter((res: any) => !isImageUrl(res.url) && res.card_type !== 'recipe'); // Keep 'all' list focused on webpages, but omit premium recipes to prevent duplication

  // Group results by domain (simple grouping)
  const groupedResults: any[] = [];
  const processedDomains = new Set();
  const maxNested = 3; // Nesting limit
  
  if (activeTab === 'all') {
    filteredResults.forEach((res: any) => {
      // Normalize domain for reliable grouping (remove www. and lowercase)
      const groupKey = res.displayUrl.toLowerCase().replace(/^www\./, '');
      
      if (processedDomains.has(groupKey)) return;

      // Find all results for this domain in the filtered results set
      const domainMatches = filteredResults.filter(r => 
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
  const [isWikiExpanded, setIsWikiExpanded] = useState(false);
  const [isThreeDotsOpen, setIsThreeDotsOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [isIntentDecoderOpen, setIsIntentDecoderOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const resInputRef = useRef<HTMLTextAreaElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const mainElement = mainRef.current;
    const handleScroll = () => {
      const scrollPos = window.innerWidth < 768 ? window.scrollY : (mainElement ? mainElement.scrollTop : 0);
      if (scrollPos > 30) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    if (mainElement) {
      mainElement.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (mainElement) {
        mainElement.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setGlowVisible(false), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const textarea = resInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const sH = textarea.scrollHeight;
    textarea.style.height = `${Math.min(sH, 120)}px`;
    setIsExpanded(sH > 32);
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex min-h-screen bg-white w-full">
      {/* GEMINI LAPTOP SIDEBAR */}
      {activeTab === 'ai' && (
        <div className="hidden md:flex flex-col w-[68px] shrink-0 border-r border-[#ececec] bg-[#f0f4f9] h-screen sticky top-0 items-center justify-between py-6 z-40 select-none animate-in slide-in-from-left duration-300">
          <div className="flex flex-col items-center gap-6 w-full">
            <div onClick={goHome} className="h-11 w-11 rounded-full bg-linear-to-tr from-[#4285F4] via-[#a855f7] via-[#ea4335] to-[#f9ab00] bg-[length:200%_auto] text-white flex items-center justify-center font-black text-lg cursor-pointer shadow-[0_0_12px_rgba(168,85,247,0.3)] hover:scale-105 active:scale-95 transition-all">
              G
            </div>
            <button
              type="button"
              className="p-2.5 text-slate-600 hover:bg-slate-200/60 rounded-full transition-all border-none bg-transparent cursor-pointer"
              title="Menu"
            >
              <Menu size={20} />
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery('');
              }}
              className="p-2.5 text-slate-600 hover:bg-slate-200/60 rounded-full transition-all border-none bg-transparent cursor-pointer"
              title="New Chat"
            >
              <CheckSquare size={20} />
            </button>
          </div>
          <div className="w-full h-8 flex items-center justify-center">
            <div className="h-7 w-7 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-550 text-[11px] border border-slate-350">
              {user?.email ? user.email.charAt(0).toUpperCase() : 'K'}
            </div>
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        <input type="file" ref={fileInputRef} onChange={onImageUpload} className="hidden" accept="image/*" />
        <header className="bg-white select-none font-sans">
        {/* MOBILE LAYOUT HEADER (Replicating user's requested Google mobile-style layout) */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 md:hidden">
          {/* Beaker Lab Flask Icon on Left (Replicates Google Flask - No Bounce) */}
          <button 
            type="button"
            onClick={() => setIsIntentDecoderOpen(true)}
            className="p-1 px-1.5 transition-colors text-slate-500 hover:text-slate-800 shrink-0"
            title="Intent Laboratory"
          >
            <FlaskConical size={20} className="text-slate-700" />
          </button>

          {/* Centered purple-gradient Scout logo */}
          <div onClick={goHome} className="flex items-center gap-2 cursor-pointer shrink-0 select-none">
             <span className={`font-display font-black text-2xl tracking-tighter ${activeTab === 'ai' ? 'bg-clip-text text-transparent bg-gradient-to-tr from-[#4285F4] via-[#a855f7] via-[#ea4335] to-[#f9ab00] animate-pulse' : 'bg-clip-text text-transparent bg-linear-to-t from-[#9333ea] to-[#3b0764]'}`}>
               {activeTab === 'ai' ? 'S' : 'Scout'}
             </span>
          </div>

          {/* User profile on Right */}
          <div className="flex items-center shrink-0">
            <UserProfile user={user} onLogin={onLogin} onLogout={onLogout} isSignoutOpen={isSignoutOpen} setIsSignoutOpen={setIsSignoutOpen} />
          </div>
        </div>

        {/* Mobile Search input bar (Static, non-wrapping clickable pill) */}
        {activeTab !== 'ai' && (
          <div className="px-6 pt-2 pb-4 md:hidden">
            <div className="relative w-full">
              <div 
                onClick={() => setIsMobileSearchOpen(true)}
                className="relative flex items-center justify-between pl-4.5 pr-4 py-2.5 bg-white border border-slate-200/90 shadow-md rounded-full w-full cursor-pointer select-none"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                  <Search size={20} className="text-slate-500 shrink-0" />
                  <span className="flex-1 text-[16px] font-normal text-slate-800 placeholder:text-slate-450 truncate">
                    {query || "Search Scout..."}
                  </span>
                  {query && (
                    <button 
                      type="button" 
                      onClick={(e) => { e.stopPropagation(); setQuery(''); }} 
                      className="p-1 text-slate-500 hover:text-slate-700 focus:outline-none shrink-0"
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2.5 shrink-0 pl-1">
                  <div className="h-5 w-[1px] bg-slate-200 shrink-0" />
                  <button 
                    type="button" 
                    onClick={(e) => { e.stopPropagation(); onMicClick(); }}
                    className="p-1 text-slate-600 active:scale-95 hover:scale-110 transition-all focus:outline-none bg-transparent border-none shrink-0 cursor-pointer"
                  >
                    <Mic size={20} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DESKTOP LAYOUT HEADER */}
        <div className="hidden md:flex items-center justify-between px-6 lg:px-12 py-5 max-w-[1700px] mx-auto gap-12">
          <div className="flex items-center gap-14 lg:gap-20 flex-1 max-w-4xl pl-2">
            {/* Logo on Left */}
            <div onClick={goHome} className="flex items-center gap-2 cursor-pointer shrink-0 select-none">
              {activeTab === 'ai' ? (
                <div className="w-10 h-10 flex items-center justify-center bg-white rounded-none border-none select-none">
                  <span className="font-display font-black text-2xl tracking-tighter bg-clip-text text-transparent bg-linear-to-t from-[#9333ea] to-[#3b0764]">
                    S
                  </span>
                </div>
              ) : (
                <span className="font-display font-black text-2xl tracking-tighter bg-clip-text text-transparent bg-linear-to-t from-[#9333ea] to-[#3b0764]">
                  Scout
                </span>
              )}
            </div>

            {/* Double Search Bar on Desktop / Inline Tabs in AI mode */}
            {activeTab !== 'ai' ? (
              <div className="flex-1 max-w-2xl relative" ref={searchContainerRef}>
                <form 
                  onSubmit={(e) => { e.preventDefault(); onSearch(); }}
                  className="relative flex items-center gap-3.5 pl-6 pr-3.5 py-2.5 bg-white border border-slate-200/90 shadow-sm hover:shadow-md focus-within:shadow-md rounded-full transition-all duration-200"
                >
                  {imageQuery && (
                    <div className="relative group/resimg mr-2 h-6 w-6 shrink-0 rounded overflow-hidden shadow-xs border border-slate-100 relative z-10">
                      <img src={imageQuery} className="w-full h-full object-cover blur-[1.5px]" />
                    </div>
                  )}
                  
                  {/* Sleek dynamic URL indicator showing what tab/category they are searching on */}
                  <div className="hidden lg:flex items-center text-slate-400 text-sm font-medium tracking-tight font-mono select-none mr-0.5 shrink-0 relative z-10">
                    <span className="text-slate-900 font-semibold">scout.ai</span>
                    <span className="text-slate-400 mx-0.5">/</span>
                    <span className="text-indigo-600 font-semibold bg-indigo-50 px-1.5 py-0.5 rounded text-[11px] uppercase tracking-wider">
                      {activeTab === 'ai' ? 'ai-mode' : activeTab}
                    </span>
                    <span className="text-slate-400 ml-0.5">/</span>
                  </div>

                  <textarea 
                    ref={resInputRef}
                    value={query} 
                    rows={1}
                    onFocus={() => { setIsResInputFocused(true); setShowSuggestions(true); }}
                    onBlur={() => { setTimeout(() => setIsResInputFocused(false), 200); }}
                    onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }} 
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        onSearch();
                        setShowSuggestions(false);
                      }
                    }}
                  placeholder={
                    isPrivacyMode 
                      ? "Search incognito..." 
                      : activeTab === 'ai' 
                        ? "Ask Scout AI..." 
                        : activeTab === 'images' 
                          ? "Search Scout Images..." 
                          : activeTab === 'videos' 
                            ? "Search Scout Videos..." 
                            : activeTab === 'news' 
                              ? "Search Scout News..." 
                              : activeTab === 'developer' 
                                ? "Search Developer Docs..." 
                                : activeTab === 'docs' 
                                  ? "Search Documentation..." 
                                  : activeTab === 'memes' 
                                    ? "Search Memes..." 
                                    : "Search Scout or type URL"
                  }
                    style={{
                      resize: 'none',
                      height: 'auto',
                      maxHeight: '100px'
                    }}
                    className="w-full flex-1 bg-transparent border-none outline-none text-slate-900 font-normal py-1 h-auto resize-none leading-normal font-sans"
                  />
                  
                  {query && (
                    <button 
                      type="button" 
                      onClick={() => setQuery('')} 
                      className="p-1 text-slate-400 hover:text-slate-600 focus:outline-none shrink-0"
                    >
                      <X size={16} />
                    </button>
                  )}

                  <div className="flex items-center gap-1.5 shrink-0 border-l border-slate-200 pl-3.5">
                    <button 
                      type="button" 
                      onClick={onMicClick}
                      className="p-1 px-1.5 flex items-center justify-center text-slate-900 hover:scale-110 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
                      title="Search by voice"
                    >
                      <Mic size={17} className="text-slate-950 animate-pulse-slow" />
                    </button>
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-1 px-1.5 flex items-center justify-center text-slate-900 hover:scale-110 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
                      title="Search by image"
                    >
                      <Camera size={17} className="text-slate-950" />
                    </button>
                    <button 
                      type="submit" 
                      className="p-1 px-1.5 flex items-center justify-center text-slate-900 hover:scale-110 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0" 
                      onClick={() => onSearch()}
                      title="Search"
                    >
                      <Search size={17} className="text-slate-950" />
                    </button>
                  </div>
                </form>
                <AnimatePresence>
                  {showSuggestions && suggestions.length > 0 && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="absolute top-[48px] left-0 right-0 border border-slate-200 rounded-2xl shadow-xl z-[2100] overflow-hidden bg-white mt-1"
                    >
                      {suggestions.map((s: string, i: number) => (
                        <button 
                          key={i} 
                          onClick={() => { setQuery(s); onSearch(s); setShowSuggestions(false); }}
                        className="w-full px-5 py-3 flex items-center gap-3 text-slate-700 hover:bg-slate-50 transition-colors text-left"
                      >
                        <Search size={14} className="text-slate-400" />
                        <span className="font-medium text-sm text-slate-800">{s}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            ) : (
              <div className="flex items-center gap-6 md:gap-7 select-none pl-2 h-10">
                {['AI Mode', 'All', 'Images', 'News', 'Developer', 'Docs', 'Memes'].map(tab => {
                  const tabLower = tab === 'AI Mode' ? 'ai' : tab.toLowerCase();
                  const isActive = activeTab === tabLower;
                  return (
                    <button 
                      key={tab} 
                      className={`h-full text-[14px] border-b-2 transition-all whitespace-nowrap shrink-0 relative flex items-center px-1 font-sans ${
                        isActive 
                          ? 'text-purple-600 font-bold border-purple-600' 
                          : 'text-slate-500 border-transparent hover:text-slate-900 font-medium'
                      }`} 
                      onClick={() => {
                        setActiveTab(tabLower);
                      }}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="hidden md:flex items-center gap-4 shrink-0">
            <button 
              type="button"
              onClick={() => setIsIntentDecoderOpen(true)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-full transition-all"
              title="Intent Laboratory"
            >
              <FlaskConical size={18} />
            </button>
            <div ref={appsRef}>
              <AppsLauncher isOpen={isAppsOpen} setIsOpen={setIsAppsOpen} />
            </div>
            <button
              onClick={() => setIsPrivacyMode(!isPrivacyMode)}
              className={`flex items-center justify-center p-2 rounded-full transition-all border select-none duration-200 cursor-pointer shadow-3xs hover:scale-105 shrink-0 ${
                isPrivacyMode 
                  ? 'bg-slate-900 border-slate-950 text-slate-100 shadow-sm hover:bg-slate-800 gap-1 px-2.5' 
                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
              }`}
              title={isPrivacyMode ? "Incognito Mode Active" : "Incognito Mode Disabled"}
            >
              {isPrivacyMode ? (
                <div className="flex items-center gap-1">
                  <Glasses size={14} className="text-violet-400 shrink-0" />
                  <span className="text-[10px] font-bold text-violet-400 leading-none">on</span>
                </div>
              ) : (
                <div className="relative w-4 h-4 shrink-0 flex items-center justify-center">
                  <Glasses size={14} className="text-slate-400" />
                  <div className="absolute w-[18px] h-[1.5px] bg-slate-400 -rotate-45 transform origin-center" />
                </div>
              )}
            </button>
            <UserProfile user={user} onLogin={onLogin} onLogout={onLogout} isSignoutOpen={isSignoutOpen} setIsSignoutOpen={setIsSignoutOpen} onOpenAnalytics={onOpenAnalytics} />
          </div>
        </div>

        {/* TAB NAVIGATION RIBBON (Replicates exact look of Google sub-tab bar with equalized spacing) */}
        {activeTab !== 'ai' && (
          <div className="md:sticky md:top-0 z-40 bg-white border-t border-b border-slate-100 select-none">
            <div className="px-6 md:px-12 max-w-[1700px] bg-white mx-auto">
              <div className="flex items-center gap-5 sm:gap-8 overflow-x-auto scrollbar-hide md:pl-[145px]">
                {/* AI Mode tab + original tabs */}
                {['AI Mode', 'All', 'Images', 'News', 'Developer', 'Docs', 'Memes'].map(tab => {
                  const tabLower = tab === 'AI Mode' ? 'ai' : tab.toLowerCase();
                  const isActive = activeTab === tabLower;
                  
                  return (
                    <button 
                      key={tab} 
                      className={`pb-3 pt-2.5 px-0.5 text-[14px] border-b-[3px] transition-all whitespace-nowrap shrink-0 relative ${
                        isActive 
                          ? 'text-slate-950 font-black border-slate-950 border-black' 
                          : 'text-slate-600 border-transparent hover:text-slate-900'
                      }`} 
                      onClick={() => {
                        setActiveTab(tabLower);
                      }}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </header>

      <main ref={mainRef} className="flex-1">
        {activeTab === 'images' ? (
          <div className="w-full px-8 py-8 md:px-8">
            {loading ? (
              <div className="animate-pulse grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {[1,2,3,4,5,6,7,8,9,10,11,12].map(i => (
                  <div key={i} className="aspect-square bg-slate-100 rounded-3xl" />
                ))}
              </div>
            ) : filteredResults.length > 0 ? (
              <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-6 space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
                {filteredResults.map((res: any) => {
                  const imgUrl = isImageUrl(res.url) ? res.url : res.image;
                  return (
                    <div 
                      key={res.id} 
                      onClick={() => setSelectedImage(res)} 
                      className="break-inside-avoid bg-white rounded-2xl overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer p-2 mb-6 group inline-block w-full border-none"
                    >
                      <div className="rounded-xl overflow-hidden bg-slate-50 relative flex items-center justify-center">
                        <img 
                          src={imgUrl} 
                          className="w-full h-auto object-contain transition-transform group-hover:scale-[1.01]" 
                          style={{ maxHeight: '280px' }} 
                          referrerPolicy="no-referrer" 
                          alt={res.title} 
                          onError={() => {
                            if (imgUrl) onImageError?.(imgUrl);
                          }}
                        />
                      </div>
                      <div className="pt-2 px-1 pb-1">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">
                          <span className="w-3.5 h-3.5 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden shrink-0 border-none">
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
              <div className="py-20 text-center text-slate-400 font-medium italic">No images found for your query.</div>
            )}

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
        ) : activeTab === 'videos' ? (
          <div className="w-full px-4 md:px-8 py-8 max-w-[850px] mx-auto">
            {videosLoading ? (
              <div className="animate-pulse space-y-8">
                <div className="h-6 bg-slate-100 rounded w-1/4 mb-6"></div>
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="space-y-3">
                    <div className="h-4 bg-slate-100 rounded w-1/3"></div>
                    <div className="h-5 bg-slate-105 rounded w-5/6"></div>
                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="w-full sm:w-[180px] aspect-video bg-slate-100 rounded-xl shrink-0" />
                      <div className="flex-1 space-y-2 py-1">
                        <div className="h-4 bg-slate-105 rounded w-full"></div>
                        <div className="h-4 bg-slate-105 rounded w-5/6"></div>
                        <div className="h-3 bg-slate-101 rounded w-1/4 mt-4"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : youtubeVideos && youtubeVideos.length > 0 ? (
              <div>
                {/* Header matching Google style */}
                <div className="flex items-center gap-1.5 mb-8 border-b border-slate-100 pb-4 text-slate-900">
                  <h2 className="font-sans font-normal text-2xl tracking-normal">Videos</h2>
                  <svg className="w-5 h-5 text-slate-400 hover:text-slate-600 cursor-pointer ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                  </svg>
                </div>

                {/* Vertical Google list design */}
                <div className="space-y-8">
                  {youtubeVideos.map((vid: any) => {
                    const isShorts = vid.duration && (vid.duration.split(':').length === 2 && parseInt(vid.duration.split(':')[0], 10) < 2);
                    const breadcrumbPath = isShorts ? 'shorts' : 'watch';
                    return (
                      <div key={vid.id} className="group font-sans">
                        {/* 1. Breadcrumb URL */}
                        <div className="flex items-center gap-1.5 text-[13px] text-slate-600 mb-1">
                          <span>www.youtube.com</span>
                          <span className="text-slate-400 text-xs">›</span>
                          <span>{breadcrumbPath}</span>
                          <svg className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600 cursor-pointer ml-1" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                          </svg>
                        </div>

                        {/* 2. Blue title heading */}
                        <h3 className="font-sans font-normal text-[#1a0dab] text-[20px] leading-tight hover:underline mb-2">
                          <a href={vid.url || `https://www.youtube.com/watch?v=${vid.id}`} target="_blank" rel="noopener noreferrer">
                            {vid.title}
                          </a>
                        </h3>

                        {/* 3. Side-by-side thumbnail & description */}
                        <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                          {/* Left: Thumbnail/Iframe play area */}
                          <div className="w-full sm:w-[185px] aspect-video rounded-xl overflow-hidden bg-black shrink-0 relative group shadow-3xs">
                            <iframe 
                              width="100%" 
                              height="100%" 
                              src={`https://www.youtube.com/embed/${vid.id}?rel=0`} 
                              title={vid.title} 
                              frameBorder="0" 
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                              allowFullScreen 
                              className="w-full h-full"
                            />
                            {vid.duration && (
                              <span className="absolute bottom-1.5 left-1.5 bg-black/80 text-white font-mono text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5 rounded tracking-wide pointer-events-none">
                                {vid.duration}
                              </span>
                            )}
                          </div>

                          {/* Right: Description & Meta */}
                          <div className="flex-1 flex flex-col justify-between py-0.5 min-w-0">
                            {vid.description && (
                              <p className="text-slate-600 text-[14px] leading-relaxed line-clamp-2 md:line-clamp-3">
                                {vid.description}
                              </p>
                            )}
                            
                            <div className="text-[13px] sm:text-[14px] text-slate-500 font-normal mt-3 flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-slate-700">YouTube</span>
                              <span>·</span>
                              <span>{vid.channelTitle}</span>
                              <span>·</span>
                              <span className="text-slate-400">{vid.publishedTime || 'Recent'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Main page attribution bar (Clean, gray design without red icon) */}
                <div className="mt-14 pt-6 border-t border-slate-200/60 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 font-sans gap-4">
                  <div className="flex items-center gap-2">
                    <span>This workspace is integrated with <strong>YouTube™</strong> API Services. Videos load through official endpoints.</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">YouTube Terms</a>
                    <span>•</span>
                    <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">Google Privacy Policy</a>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-20 text-center text-slate-400 font-medium italic">
                No playable videos found for your search query. Please try another query.
              </div>
            )}
          </div>
        ) : activeTab === 'ai' ? (
          <div className="w-full px-4 sm:px-6 py-6 max-w-4xl lg:pl-20 xl:pl-24 select-none font-sans">
            {!query || query.trim() === '' ? (
              <div className="flex flex-col items-center justify-center min-h-[calc(100vh-270px)] w-full max-w-3xl mx-auto px-4 select-none animate-in fade-in duration-700">
                <h1 className="font-display font-medium text-4xl sm:text-5xl text-slate-800 tracking-tight text-center mb-10">
                  Hi {user?.displayName || (user?.email ? user.email.split('@')[0] : '') || 'Komu'}, what's on your mind?
                </h1>
                <form 
                  onSubmit={(e: any) => {
                    e.preventDefault();
                    if (chatInputText.trim()) {
                      setQuery(chatInputText);
                      onSearch(chatInputText);
                      setChatInputText('');
                    }
                  }}
                  className="w-full relative shadow-[0_4px_20px_rgba(0,0,0,0.06)] hover:shadow-[0_4px_30px_rgba(0,0,0,0.08)] focus-within:shadow-[0_4px_30px_rgba(0,0,0,0.08)] transition-all duration-200 border border-slate-200 rounded-[32px] bg-white pl-5 pr-2.5 py-3 flex items-center gap-3"
                >
                  <button 
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-full font-black flex items-center justify-center shrink-0 w-10 h-10 cursor-pointer border-none"
                    title="Add image"
                  >
                    <span className="text-xl leading-none">+</span>
                  </button>
                  <input 
                    name="chatInput"
                    type="text"
                    value={chatInputText}
                    onChange={(e) => setChatInputText(e.target.value)}
                    placeholder="Ask anything"
                    className="flex-1 w-full bg-transparent border-none outline-none font-sans text-slate-800 text-[17px] placeholder:text-slate-400 py-2 focus:ring-0 leading-normal"
                  />
                  
                  <div className="flex items-center justify-center shrink-0 w-11 h-11 relative overflow-hidden">
                    <AnimatePresence mode="wait">
                      {chatInputText.trim().length === 0 ? (
                        <motion.button
                          key="voice-landing"
                          initial={{ opacity: 0, scale: 0.8, x: 20 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.8, x: -20 }}
                          transition={{ type: "spring", stiffness: 300, damping: 25 }}
                          type="button" 
                          onClick={onMicClick}
                          className="p-2.5 bg-slate-50 hover:bg-slate-100/90 text-slate-600 rounded-full active:scale-95 transition-all border-none bg-transparent shrink-0 cursor-pointer flex items-center justify-center"
                          title="Search by voice"
                        >
                          <Mic size={19} className="text-slate-600" />
                        </motion.button>
                      ) : (
                        <motion.button
                          key="send-landing"
                          initial={{ opacity: 0, scale: 0.8, x: 20 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.8, x: -20 }}
                          transition={{ type: "spring", stiffness: 300, damping: 25 }}
                          type="submit"
                          className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full hover:shadow-lg active:scale-95 border-none cursor-pointer flex items-center justify-center shadow-[0_2px_8px_rgba(37,99,235,0.3)] duration-150"
                          title="Send request"
                        >
                          <ArrowUp size={19} className="stroke-[2.5]" />
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </div>
                </form>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
              {/* User message block - representing original search query */}
              <div className="flex justify-end px-2">
                <div className="flex flex-col items-end gap-1 max-w-[85%]">
                  <div className="bg-slate-100 text-slate-800 text-[14px] sm:text-[14.5px] font-normal leading-relaxed px-5 py-3 rounded-[24px]">
                    {query}
                  </div>
                </div>
              </div>

              {/* AI Response Block - Google Gemini/Neural gradient style chatbot response */}
              <div className="flex-1 min-w-0 flex flex-col gap-1.5 animate-in fade-in duration-500">
                <div className="relative bg-white p-0 flex flex-col gap-6 overflow-hidden">
                  
                  {aiLoading ? (
                    <div className="animate-pulse space-y-3.5 py-2">
                      <div className="flex items-center gap-2 text-[12px] opacity-75 font-semibold text-slate-400">
                        <Loader2 size={13} className="animate-spin text-slate-500" />
                        <span>Scout AI is thinking...</span>
                      </div>
                      <div className="h-3.5 bg-gradient-to-r from-slate-100 via-slate-200/50 to-slate-100 rounded-full w-full" />
                      <div className="h-3.5 bg-gradient-to-r from-slate-100 via-slate-200/50 to-slate-100 rounded-full w-[95%]" />
                      <div className="h-3.5 bg-gradient-to-r from-slate-100 via-slate-200/50 to-slate-100 rounded-full w-[85%]" />
                      <div className="h-3.5 bg-gradient-to-r from-slate-100 via-slate-200/50 to-slate-100 rounded-full w-[60%]" />
                    </div>
                  ) : aiOverview ? (
                    <div>
                      {/* Shimmer header status */}
                      <div className="flex items-center justify-between mb-4.5 select-none border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">
                            {isEnglishHelp ? 'English Help Summary' : 'AI Overview'}
                          </span>
                        </div>
                      </div>

                        {/* Markdown prose element */}
                        <div className="text-slate-800 text-[15.5px] font-normal leading-relaxed prose prose-slate max-w-none">
                          {(() => {
                            const imageSources = (aiOverview.sources || []).filter((s: any) => s.image);
                            const backupImages = results ? results.filter((r: any) => r.image).map((r: any) => ({
                              url: r.url,
                              title: r.title,
                              snippet: r.snippet,
                              image: r.image
                            })) : [];
                            const displayImages = [...imageSources, ...backupImages].filter((item, idx, self) => 
                              self.findIndex(t => t.image === item.image) === idx
                            ).slice(0, 4);

                            return (
                              <div className="space-y-6">
                                <div 
                                  className={`prose prose-slate prose-p:my-4 prose-headings:font-black prose-headings:text-slate-900 prose-li:my-1.5 prose-table:border prose-table:border-slate-200 prose-th:bg-slate-150 prose-th:p-2.5 prose-td:p-2.5 prose-td:border prose-td:border-slate-100 transition-all duration-300 overflow-hidden ${!isOverviewExpanded ? 'max-h-[300px] md:max-h-[450px]' : 'max-h-none'}`}
                                  style={{ 
                                    maskImage: !isOverviewExpanded ? 'linear-gradient(to bottom, black 85%, transparent 100%)' : 'none', 
                                    WebkitMaskImage: !isOverviewExpanded ? 'linear-gradient(to bottom, black 85%, transparent 100%)' : 'none' 
                                  }}
                                >
                                  <Markdown 
                                    remarkPlugins={[remarkGfm]} 
                                    components={{
                                      img: ({ ...props }) => (
                                        <img 
                                          {...props} 
                                          className="w-full max-w-sm aspect-video object-cover rounded-xl border border-slate-100 shadow-2xs my-4 mx-auto" 
                                          referrerPolicy="no-referrer"
                                        />
                                      ),
                                      a: ({ href, children }) => {
                                        const text = String(children || '');
                                        const isNumericRef = /^\d+$/.test(text) || text.startsWith('Source') || text.startsWith('[');
                                        const cleanIndexText = text.replace(/[\[\]]/g, '');
                                        const indexVal = parseInt(cleanIndexText, 10);
                                        
                                        const sourceItem = (aiOverview && aiOverview.sources) 
                                          ? aiOverview.sources[indexVal - 1] || aiOverview.sources.find((s: any) => s.url === href)
                                          : null;
                                        
                                        if (isNumericRef && sourceItem) {
                                          const hostname = (() => {
                                            try { return new URL(sourceItem.url).hostname.replace('www.', ''); } catch(_) { return 'source'; }
                                          })();
                                          
                                          return (
                                            <span className="relative inline-block group mx-0.5 align-middle select-none">
                                              <a
                                                href={sourceItem.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="no-underline inline-flex items-center justify-center gap-0.5 bg-slate-150 hover:bg-violet-105 hover:text-violet-700 text-slate-700 rounded-full font-bold text-[9.5px] px-1.5 py-0.5 transition-all h-[17px] leading-none mb-[2px]"
                                                title={sourceItem.title}
                                              >
                                                <ExternalLink size={8} className="shrink-0 text-slate-500" />
                                                <span>{cleanIndexText}</span>
                                              </a>
                                              <span className="hidden group-hover:block transition-all absolute bottom-[115%] left-1/2 transform -translate-x-1/2 p-3 bg-white text-slate-800 text-xs rounded-xl shadow-xl w-[260px] sm:w-[290px] z-50 text-left cursor-default leading-relaxed border border-slate-200">
                                                <span className="flex items-center gap-1.5 mb-1.5 border-b border-slate-100 pb-1.5">
                                                  <img 
                                                    src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`} 
                                                    className="w-3.5 h-3.5 rounded-full shrink-0" 
                                                    referrerPolicy="no-referrer"
                                                    onError={(e: any) => { (e.target as any).style.display = 'none'; }}
                                                  />
                                                  <span className="font-extrabold text-slate-800 truncate block text-[11px] flex-1">{sourceItem.title || 'Source Reference'}</span>
                                                  <span className="text-[8.5px] font-mono text-slate-400 shrink-0">{hostname}</span>
                                                </span>
                                                <span className="text-[10.5px] text-slate-500 block line-clamp-3 mb-1.5 font-medium leading-snug">
                                                  {sourceItem.snippet || 'Excerpt reference content from matching verified source for search context.'}
                                                </span>
                                                <span className="text-[9.5px] text-violet-600 font-bold hover:underline block text-right">
                                                  Visit Website ↗
                                                </span>
                                              </span>
                                            </span>
                                          );
                                        }
                                        
                                        return (
                                          <a href={href} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline font-semibold">
                                            {children}
                                          </a>
                                        );
                                      }
                                    }}
                                  >
                                    {aiOverview.summary}
                                  </Markdown>
                                </div>

                                {/* Shimmer toggle button */}
                                <div className="flex items-center justify-center mt-3 mb-1">
                                  <button 
                                    type="button"
                                    onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
                                    className="text-[12.5px] font-bold text-violet-600 hover:text-violet-700 flex items-center gap-1.5 px-5 py-1.5 bg-violet-50 hover:bg-violet-100 rounded-full transition-all active:scale-95 shadow-2xs border-none cursor-pointer"
                                  >
                                    {isOverviewExpanded ? 'Read less' : 'Read more'}
                                    <ChevronRight size={13} className={isOverviewExpanded ? '-rotate-90' : 'rotate-90'} />
                                  </button>
                                </div>

                                {/* Compact Scrolling Multimedia Images if any */}
                                {displayImages.length > 0 && (
                                  <div className="mt-4 border-t border-slate-100 pt-4">
                                    <div className="text-[10.5px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">
                                      Referenced Visuals
                                    </div>
                                    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none scrollbar-hide">
                                      {displayImages.map((imgItem: any, idx: number) => {
                                        const imgHost = (() => {
                                          try { return new URL(imgItem.url).hostname.replace('www.', ''); } catch(_) { return 'link'; }
                                        })();
                                        return (
                                          <div 
                                            key={idx} 
                                            className="bg-slate-50 rounded-xl overflow-hidden p-2 shadow-3xs border border-slate-150 shrink-0 w-[160px] snap-start flex flex-col justify-between"
                                          >
                                            <div className="h-[80px] w-full rounded-lg overflow-hidden bg-slate-105 mb-1.5 relative animate-fade-in">
                                              <img src={imgItem.image} alt={imgItem.title} className="w-full h-full object-cover select-none" referrerPolicy="no-referrer" />
                                            </div>
                                            <a href={imgItem.url} target="_blank" rel="noreferrer" className="truncate text-[10px] font-extrabold text-slate-700 hover:text-violet-600 block">
                                              {imgItem.title}
                                            </a>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        {/* Bottom Utility controls */}
                        <div className="flex items-center gap-3 border-t border-slate-100 mt-5 pt-3.5 text-slate-500">
                          <button 
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(aiOverview.summary);
                              setAiOverviewCopied(true);
                              setTimeout(() => setAiOverviewCopied(false), 2000);
                            }}
                            className={`p-1.5 hover:bg-slate-50 rounded-lg transition-all cursor-pointer border-none bg-transparent flex items-center gap-1 shrink-0 ${aiOverviewCopied ? 'text-green-600 font-bold' : 'text-slate-450'}`}
                            title="Copy response"
                          >
                            <Copy size={13.5} />
                            {aiOverviewCopied && <span className="text-[10px]">Copied!</span>}
                          </button>
                          
                          <button 
                            type="button"
                            onClick={() => setAiOverviewRating(aiOverviewRating === 'up' ? null : 'up')}
                            className={`p-1.5 hover:bg-slate-50 rounded-lg transition-all cursor-pointer border-none bg-transparent ${aiOverviewRating === 'up' ? 'text-green-600' : 'text-slate-450'}`}
                            title="Helpful"
                          >
                            <ThumbsUp size={13.5} className={aiOverviewRating === 'up' ? 'fill-green-105' : ''} />
                          </button>
                          
                          <button 
                            type="button"
                            onClick={() => setAiOverviewRating(aiOverviewRating === 'down' ? null : 'down')}
                            className={`p-1.5 hover:bg-slate-50 rounded-lg transition-all cursor-pointer border-none bg-transparent ${aiOverviewRating === 'down' ? 'text-red-500' : 'text-slate-450'}`}
                            title="Not helpful"
                          >
                            <ThumbsDown size={13.5} className={aiOverviewRating === 'down' ? 'fill-red-105' : ''} />
                          </button>
                        </div>
                      </div>
                    ) : aiRateLimited ? (
                      <div className="py-8 text-center text-slate-450 font-medium italic">
                        AI Overview is temporarily unavailable. Please try again soon.
                      </div>
                    ) : (
                      <div className="py-8 text-center text-slate-450 font-medium italic">
                        AI Mode is only generated for informational search queries. Try asking a question!
                      </div>
                    )}
                  </div>

                  {/* Sources Citation Bar underneath AI bubble */}
                  {aiOverview && aiOverview.sources && aiOverview.sources.length > 0 &&
                    <div className="px-1.5 mt-2 animate-in fade-in duration-300">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                        Trusted Citations
                      </div>
                      <div className="flex gap-2 pb-2 overflow-x-auto scrollbar-none scrollbar-hide snap-x">
                        {aiOverview.sources.map((source: any, i: number) => {
                          let hostname = 'link';
                          try { hostname = new URL(source.url).hostname.replace('www.', ''); } catch (_) {}
                          return (
                            <a 
                              key={i} href={source.url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-150 rounded-full transition-colors shrink-0 text-slate-600 text-[11px] font-bold"
                            >
                              <img 
                                src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`} 
                                className="w-3.5 h-3.5 rounded-full shrink-0" 
                                referrerPolicy="no-referrer"
                                onError={(e: any) => { (e.target as any).style.display = 'none'; }}
                              />
                              <span className="truncate max-w-[130px]">{source.title || hostname}</span>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  }
                </div>

              {/* Chat-focused Interactive Capsule Input bar inside AI tab */}
              <div className="mt-4 pt-4 border-t border-slate-100">
                <AIConversationalInput onSearch={onSearch} setQuery={setQuery} onMicClick={onMicClick} />
              </div>
            </div>
            )}
          </div>
        ) : (
          <div className={`flex flex-col lg:flex-row ${sports ? 'gap-3 md:gap-6 px-1.5 sm:px-4 md:px-6 lg:pl-10 xl:pl-12 lg:pr-6 xl:pr-8' : 'gap-4 sm:gap-6 md:gap-8 lg:gap-10 xl:gap-12 px-2.5 sm:px-6 md:px-12 lg:pl-20 xl:pl-24 lg:pr-10 xl:pr-12'} py-2 md:py-6 max-w-[1700px] mx-auto`}>
          {activeTab === 'all' && (knowledgePanel || businessProfile || movie) && (
            <aside className="order-1 lg:order-2 space-y-8 w-full lg:w-[368px] shrink-0">
               {businessProfile && (
                 <GoogleBusinessProfileCard profile={businessProfile} query={query} />
               )}
               {knowledgePanel && (
                 <motion.div 
                   initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                   className="bg-white rounded-[28px] overflow-hidden border-0"
                 >
                 {(() => {
                   const panelImages = (knowledgePanel.images && knowledgePanel.images.length > 0) 
                     ? knowledgePanel.images 
                     : (knowledgePanel.image ? [knowledgePanel.image] : []);

                   return (
                     <div className="p-4 md:p-5">
                       {/* Header: Title, Subtitle, and Share + Three Dots Menu */}
                       <div className="flex justify-between items-start mb-6">
                         <div>
                           <h2 className="text-2xl font-display font-medium text-slate-900 tracking-tight leading-tight">{knowledgePanel.title}</h2>
                           <p className="text-sm text-slate-500 mt-1 font-normal">{knowledgePanel.subtitle}</p>
                         </div>
                         <div className="flex items-center gap-1.5 shrink-0 select-none relative animate-none">
                            {/* Share button */}
                            <button
                              id="wiki-share-btn"
                              title="Share this card"
                              type="button"
                              onClick={() => {
                                const url = knowledgePanel.wikipediaUrl || window.location.href;
                                if (navigator.share) {
                                  navigator.share({
                                    title: knowledgePanel.title || 'Wikipedia Information',
                                    url: url
                                  }).catch(() => {
                                    navigator.clipboard.writeText(url);
                                    setCopyFeedback("Copied link!");
                                    setTimeout(() => setCopyFeedback(""), 2000);
                                  });
                                } else {
                                  navigator.clipboard.writeText(url);
                                  setCopyFeedback("Copied link!");
                                  setTimeout(() => setCopyFeedback(""), 2000);
                                }
                              }}
                              className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-slate-100 cursor-pointer text-slate-400 hover:text-slate-600 transition-colors border-none bg-transparent"
                            >
                              <Share2 size={13} className="shrink-0" />
                            </button>
                            
                            {/* 3 dots button */}
                            <button
                              id="wiki-more-btn"
                              title="More options"
                              type="button"
                              onClick={() => setIsThreeDotsOpen(!isThreeDotsOpen)}
                              className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-slate-100 cursor-pointer text-slate-400 hover:text-slate-600 transition-colors border-none bg-transparent relative"
                            >
                              <MoreVertical size={13} className="shrink-0" />
                            </button>

                            {/* Toast / feedback popup on copy */}
                            {copyFeedback && (
                              <div className="absolute top-[110%] right-0 bg-slate-800 text-white text-[10px] sm:text-xs font-bold px-2 py-1 rounded shadow-md z-50 whitespace-nowrap">
                                {copyFeedback}
                              </div>
                            )}

                            {/* Dropdown Menu for 3 Dots */}
                            {isThreeDotsOpen && (
                              <div className="absolute top-[110%] right-0 bg-white border-none outline-none rounded-xl shadow-xl p-1.5 z-50 min-w-[150px] animate-in fade-in slide-in-from-top-1 duration-150 text-left">
                                <a
                                  href={knowledgePanel.wikipediaUrl || `https://en.wikipedia.org/wiki/${encodeURIComponent(knowledgePanel.title || '')}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={() => setIsThreeDotsOpen(false)}
                                  className="flex items-center gap-2 px-3 py-2 text-xs text-slate-705 hover:bg-slate-50 hover:text-blue-600 rounded-lg transition-colors font-medium hover:no-underline"
                                >
                                  <ExternalLink size={11} />
                                  <span>View on Wikipedia</span>
                                </a>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsThreeDotsOpen(false);
                                    window.print();
                                  }}
                                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-slate-705 hover:bg-slate-50 hover:text-blue-600 rounded-lg transition-colors font-medium border-none bg-transparent cursor-pointer"
                                >
                                  <Printer size={11} />
                                  <span>Print this panel</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsThreeDotsOpen(false);
                                    const text = `${knowledgePanel.title} - ${knowledgePanel.description || ''}`;
                                    navigator.clipboard.writeText(text);
                                    setCopyFeedback("Copied info!");
                                    setTimeout(() => setCopyFeedback(""), 2000);
                                  }}
                                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-slate-750 hover:bg-slate-50 hover:text-blue-600 rounded-lg transition-colors font-medium border-none bg-transparent cursor-pointer"
                                >
                                  <Copy size={11} />
                                  <span>Copy information</span>
                                </button>
                              </div>
                            )}
                          </div>
                         <div className="hidden">
                           <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                           <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                           <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                         </div>
                       </div>

                       {/* Image Collage / Mosaic */}
                       {panelImages.length > 0 && (
                         <div className="-mx-2 mb-6">
                           {/* Mobile Scrollable View (Only when more than 1 image) */}
                           {panelImages.length > 1 && (
                             <div className="md:hidden flex gap-2.5 overflow-x-auto scrollbar-hide py-1 px-2 snap-x select-none h-[220px]" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                               {panelImages.map((img, i) => (
                                 <div key={i} className="h-full shrink-0 snap-start bg-slate-50 rounded-2xl overflow-hidden shadow-2xs border border-slate-100">
                                   <img 
                                     src={img} 
                                     className="max-h-full max-w-full object-contain hover:opacity-95 transition-all" 
                                     referrerPolicy="no-referrer" 
                                     alt={`${knowledgePanel.title || 'Wikipedia image'} ${i + 1}`} 
                                   />
                                 </div>
                               ))}
                             </div>
                           )}

                           {/* Desktop collage/mosaic view OR mobile single image view */}
                           <div className="flex items-center justify-center gap-2 hover:opacity-100 transition-opacity bg-slate-50/50 p-1.5 rounded-2xl h-[160px] w-full overflow-hidden select-none">
                             {panelImages.slice(0, 3).map((img, i) => (
                               <img 
                                 key={i}
                                 src={img} 
                                 className="h-full w-auto max-w-[48%] object-contain rounded-xl hover:scale-[1.02] transition-transform duration-300 border border-slate-100" 
                                 referrerPolicy="no-referrer" 
                                 alt={`${knowledgePanel.title || 'Wikipedia image'} ${i + 1}`} 
                                />
                             ))}
                           </div>
                         </div>
                       )}

                       {/* About description and Wikipedia source link */}
                       <div className="space-y-6">
                         <div className="pb-5 border-b border-slate-100 text-left">
                           {(() => {
                             const descText = knowledgePanel.description || "";
                             const needsTruncation = descText.length > 280;
                             const displayedDesc = (isWikiExpanded || !needsTruncation)
                               ? descText
                               : `${descText.substring(0, 260).trim()}...`;

                             return (
                               <p className="text-slate-600 leading-relaxed text-[15px]">
                                 {displayedDesc}
                                 {needsTruncation && (
                                   <button
                                     onClick={() => setIsWikiExpanded(!isWikiExpanded)}
                                     className="text-blue-600 hover:underline font-semibold text-[13.5px] ml-1.5 focus:outline-none rounded shrink-0 whitespace-nowrap"
                                   >
                                     {isWikiExpanded ? "Read less" : "Read more"}
                                   </button>
                                 )}
                               </p>
                             );
                           })()}
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
               )}
               {movie && (
                 <MovieSidebar movie={movie} className="hidden lg:flex flex-col gap-5" />
               )}
            </aside>
          )}

          <div className={`w-full ${sports ? 'max-w-full lg:max-w-[1100px] xl:max-w-[1200px]' : 'max-w-[650px] md:max-w-[850px] lg:max-w-[900px] xl:max-w-[980px]'} space-y-6 order-2 lg:order-1 lg:pl-0`}>
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

            {/* AI-GRADE DYNAMIC LAYOUT ORDERING BY INTENT */}

            {/* A. Dictionary Query -> Render Oxford definition at the very top */}
            {activeTab === 'all' && detectedIntent === 'dictionary' && dictionary && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white text-left rounded-[24px] sm:rounded-[32px] p-4 sm:p-6 md:p-8 transition-all mb-6 max-w-full shadow-sm"
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
                  <div className="text-slate-200 font-display font-bold text-lg italic pr-1">Oxford</div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-slate-800 text-[15px] leading-relaxed mb-3 font-normal">
                      {dictionary.definition}
                    </p>
                    {dictionary.example && (
                      <p className="text-slate-550 italic pl-4 border-l-2 border-slate-200 font-medium">"{dictionary.example}"</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Synonyms</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {dictionary.synonyms?.map((s: string, i: number) => (
                           <span key={i} className="text-blue-600 hover:underline cursor-pointer text-sm font-bold">{s}{i < dictionary.synonyms.length - 1 ? ',' : ''}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Antonyms</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {dictionary.antonyms?.map((s: string, i: number) => (
                           <span key={i} className="text-slate-550 text-sm font-bold">{s}{i < dictionary.antonyms.length - 1 ? ',' : ''}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* B. Lyrics Query -> Render lyrics at the very top */}
            {activeTab === 'all' && detectedIntent === 'lyrics' && lyrics && (
              <LyricsSection lyrics={lyrics} />
            )}

            {/* C. Holiday Query -> Render public holiday calendar at the very top */}
            {activeTab === 'all' && detectedIntent === 'holiday' && holidays && (
              <HolidaysSection holidays={holidays} onSearch={onSearch} setQuery={setQuery} />
            )}

            {/* D. Movie Query -> Render movie info card at the very top */}
            {activeTab === 'all' && detectedIntent === 'movie' && movie && (
              <MovieSection movie={movie} />
            )}

            {/* Sports Query -> Render sports matches info card at the very top */}
            {activeTab === 'all' && detectedIntent === 'sports' && sports && (
              <SportsSection sports={sports} />
            )}

            {/* E. Person Query -> Render famous person card at the very top */}
            {activeTab === 'all' && detectedIntent === 'person' && person && (
              <PeopleSection person={person} />
            )}

            {/* F1. Clean, Beautiful Google SGE-style AI Overview Loader */}
            {activeTab === 'all' && aiLoading && (
              <div className="mb-6 py-4 animate-pulse">
                <div className="flex items-center gap-2.5 mb-4 select-none">
                  <div className="p-1.5 bg-slate-900 rounded-lg text-white">
                    <Loader2 size={15} className="animate-spin text-white" />
                  </div>
                  <span className="text-[15px] font-semibold text-slate-800">
                    {isEnglishHelp ? 'English Spelling Help' : 'AI Overview'}
                  </span>
                </div>
                <div className="space-y-3.5 pl-0.5 max-w-[652px]">
                  <div className="h-3.5 bg-gradient-to-r from-slate-100 via-slate-200/70 to-slate-100 rounded-full w-[95%]" />
                  <div className="h-3.5 bg-gradient-to-r from-slate-100 via-slate-200/70 to-slate-100 rounded-full w-[90%]" />
                  <div className="h-3.5 bg-gradient-to-r from-slate-100 via-slate-200/70 to-slate-100 rounded-full w-[65%]" />
                </div>
              </div>
            )}

            {/* Simple AI Overview Block for standard 'all' tab (restored back to how it was before) */}
            {activeTab === 'all' && !aiLoading && aiOverview && !aiRateLimited && (
              <div id="ai-overview-simple" className={`glass rounded-[24px] sm:rounded-[32px] p-4 sm:p-6 md:p-8 mb-6 overflow-hidden shadow-none ${isEnglishHelp ? 'border-none' : 'border border-white/40'}`}>
                <div className="flex items-center justify-between mb-5 select-none">
                  <div className="flex items-center gap-2 opacity-75">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">
                      {isEnglishHelp ? 'English Help' : 'AI Overview'}
                    </span>
                  </div>
                </div>
                
                <div className="relative">
                    <div className={`text-slate-800 text-[16px] md:text-[17px] font-normal leading-relaxed prose prose-slate prose-p:my-5 prose-headings:font-black prose-headings:text-slate-900 prose-li:my-2 prose-table:border prose-table:border-slate-200 prose-th:bg-slate-100 prose-th:p-3 prose-td:p-3 prose-td:border prose-td:border-slate-100 prose-img:rounded-3xl prose-img:shadow-lg prose-img:my-8 prose-img:mx-auto prose-img:max-h-[400px] transition-all duration-500 overflow-hidden ${!isOverviewExpanded ? 'max-h-[260px] md:max-h-[480px]' : 'max-h-none'}`} 
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
                    
                    <div className={`relative flex items-center justify-center ${!isOverviewExpanded ? 'mt-[-15px]' : 'mt-8'} mb-4`}>
                      <div className="absolute inset-x-0 h-px bg-slate-100 z-0" />
                      <button 
                        onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
                        className="relative z-10 text-[13px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-2 px-6 py-2 bg-[#e8edff] rounded-full hover:bg-[#dee5ff] transition-all active:scale-95 shadow-sm cursor-pointer border-none pb-2 pt-2"
                      >
                        {isOverviewExpanded ? 'Read less' : 'Read more'}
                        <ChevronRight size={14} className={isOverviewExpanded ? '-rotate-90' : 'rotate-90'} />
                      </button>
                    </div>

                    {/* Simple horizontally scrollable sources on one line, ONLY shown when expanded */}
                    {isOverviewExpanded && aiOverview.sources && aiOverview.sources.length > 0 && (
                      <div className="mt-6 border-t border-slate-100/80 pt-4 animate-in fade-in duration-300">
                        <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3 select-none">
                          Sources
                        </div>
                        <div className="flex gap-2.5 overflow-x-auto pb-3 snap-x scrollbar-none">
                          {aiOverview.sources.map((source: any, i: number) => {
                            let hostname = 'link';
                            try {
                              hostname = new URL(source.url).hostname.replace('www.', '');
                            } catch (_) {}
                            return (
                              <a 
                                key={i} 
                                href={source.url} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="flex items-center gap-2 p-2 px-3 bg-slate-50/80 hover:bg-slate-100/80 border border-slate-100 rounded-xl transition-all shrink-0 snap-start max-w-[200px]"
                              >
                                <img 
                                  src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`} 
                                  className="w-3.5 h-3.5 rounded-full shrink-0" 
                                  referrerPolicy="no-referrer"
                                  onError={(e: any) => { (e.target as any).style.display = 'none'; }}
                                />
                                <div className="min-w-0 flex-1">
                                  <h4 className="text-[12px] font-bold text-slate-755 truncate leading-snug">{source.title || 'Source'}</h4>
                                  <span className="text-[10px] text-slate-400 truncate block">{hostname}</span>
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* Removed Redundant Unreachable AI block to keep code clean and performant */}
                  </div>
              </div>
            )}


            {/* Removed Redundant Organic Faq Block from here for single clean FAQ control */}

            {/* I. Dictionary, lyrics, holidays fallbacks (Render here if present but not matching primary intent) */}
            {activeTab === 'all' && detectedIntent !== 'dictionary' && dictionary && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white text-left rounded-[24px] sm:rounded-[32px] p-4 sm:p-6 md:p-8 transition-all mb-6 max-w-full shadow-sm"
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
                  <div className="text-slate-200 font-display font-bold text-lg italic pr-1">Oxford</div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-slate-800 text-[15px] leading-relaxed mb-3 font-normal">
                      {dictionary.definition}
                    </p>
                    {dictionary.example && (
                      <p className="text-slate-550 italic pl-4 border-l-2 border-slate-200 font-medium">"{dictionary.example}"</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Synonyms</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {dictionary.synonyms?.map((s: string, i: number) => (
                           <span key={i} className="text-blue-600 hover:underline cursor-pointer text-sm font-bold">{s}{i < dictionary.synonyms.length - 1 ? ',' : ''}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Antonyms</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {dictionary.antonyms?.map((s: string, i: number) => (
                           <span key={i} className="text-slate-550 text-sm font-bold">{s}{i < dictionary.antonyms.length - 1 ? ',' : ''}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'all' && detectedIntent !== 'lyrics' && lyrics && (
              <LyricsSection lyrics={lyrics} />
            )}

            {activeTab === 'all' && detectedIntent !== 'holiday' && holidays && (
              <HolidaysSection holidays={holidays} onSearch={onSearch} setQuery={setQuery} />
            )}

            {activeTab === 'all' && detectedIntent !== 'movie' && movie && (
              <MovieSection movie={movie} />
            )}

            {activeTab === 'all' && detectedIntent !== 'sports' && sports && (
              <SportsSection sports={sports} />
            )}

            {activeTab === 'all' && detectedIntent !== 'person' && person && (
              <PeopleSection person={person} />
            )}

            {activeTab === 'all' && recipes && recipes.length > 0 && (
              <RecipeIntegrationBox recipes={recipes} onResultClick={onResultClick} onImageError={onImageError} />
            )}

            {isSafeSearchIntercepted ? (
              <motion.div 
                initial={{ opacity: 0, y: 15 }} 
                animate={{ opacity: 1, y: 0 }} 
                className="my-10 p-8 md:p-12 bg-slate-50 rounded-3xl border border-slate-100 flex flex-col items-center text-center max-w-2xl mx-auto"
              >
                <div className="p-4 bg-amber-50 rounded-full text-amber-500 mb-5 border border-amber-100 flex items-center justify-center">
                  <Shield size={36} className="stroke-[2.5]" />
                </div>
                <h3 className="text-xl md:text-2xl font-display font-black text-slate-800 tracking-tight mb-3">SafeSearch Filters Active</h3>
                <p className="text-slate-600 text-sm md:text-base leading-relaxed mb-8 max-w-md font-medium">
                  We've filtered this search query because it contains terms flagged as unsafe or potentially explicit. Scout blocks adult, violent, and explicit links and images to ensure a safe environment.
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                  <button 
                    onClick={goHome}
                    className="px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-full font-bold text-xs transition-all tracking-wider uppercase active:scale-95 cursor-pointer"
                  >
                    Go back home
                  </button>
                  <button 
                    onClick={() => {
                      setQuery("Cute kittens playing");
                      setTimeout(() => onSearch("Cute kittens playing"), 100);
                    }}
                    className="px-5 py-2.5 bg-[#1a73e8] hover:bg-blue-700 text-white rounded-full font-bold text-xs transition-all tracking-wider shadow-sm uppercase active:scale-95 cursor-pointer hover:shadow-md border-none"
                  >
                    Try "Cute kittens playing"
                  </button>
                </div>
              </motion.div>
            ) : loading ? (
              <div className="space-y-6">
                {[1,2,3].map(i => <div key={i} className="animate-pulse space-y-3 p-6 bg-white rounded-3xl border border-slate-100"><div className="h-4 bg-slate-100 rounded w-1/4" /><div className="h-6 bg-slate-100 rounded w-3/4" /><div className="h-20 bg-slate-100 rounded w-full" /></div>)}
              </div>
            ) : filteredResults.length > 0 ? (
              <div className="space-y-12 md:space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">


                {groupedResults.map((item: any, idx: number) => (
                    <React.Fragment key={item.type === 'single' ? item.result.id : item.primary.id}>
                      {/* Apps Block for tech companies after first organic result */}
                      {idx === 1 && appsData && appsData.length > 0 && (
                        <AppsBlock appsData={appsData} />
                      )}

                      {/* Video Strip / Video Line after first organic result block (idx === 1) */}
                      {idx === 1 && youtubeVideos && youtubeVideos.length > 0 && detectedIntent !== 'dictionary' && detectedIntent !== 'lyrics' && detectedIntent !== 'holiday' && (
                        <div className="my-6">
                          <VideoStrip youtubeVideos={youtubeVideos} loading={videosLoading} onMore={() => setActiveTab('videos')} query={query} />
                        </div>
                      )}

                      {/* Image Strip after second organic result block (idx === 2) */}
                      {idx === 2 && detectedIntent !== 'dictionary' && detectedIntent !== 'lyrics' && detectedIntent !== 'holiday' && (
                        <div className="my-6">
                          <ImageStrip query={query} results={cleanResults} onMore={() => setActiveTab('images')} onResultClick={onResultClick} onImageClick={(img: any) => setSelectedImage(img)} />
                        </div>
                      )}
                      
                      {item.type === 'single' ? (
                        <div className="max-w-[652px] w-full">
                          <ResultCard res={item.result} carouselImages={carouselImages} isImageUrl={isImageUrl} onResultClick={onResultClick} clickedUrls={clickedUrls} onVisualSearch={(img: string) => { setImageQuery(img); onSearch('Visual Search', 1, img); }} onImageClick={(img: any) => setSelectedImage(img)} allResults={cleanResults} onImageError={onImageError} />
                        </div>
                      ) : (
                        <div className="py-2 max-w-[652px] w-full">
                          <ResultCard res={item.primary} carouselImages={carouselImages} isImageUrl={isImageUrl} onResultClick={onResultClick} clickedUrls={clickedUrls} onVisualSearch={(img: string) => { setImageQuery(img); onSearch('Visual Search', 1, img); }} onImageClick={(img: any) => setSelectedImage(img)} allResults={cleanResults} onImageError={onImageError} />
                          {/* Sitelinks (Nested Child Results) Styled Exactly Like Google */}
                          <div className="mt-2 w-full max-w-[652px]">
                            <div className="border-t border-slate-200/60 my-2" />
                            <div className="divide-y divide-slate-100 border-b border-slate-200/60">
                              {item.secondaries.map((s: any) => {
                                const isSClicked = clickedUrls?.includes(s.url);
                                
                                // Clean sub-site title beautifully (e.g. docs/editing/getting-started -> Getting Started)
                                let cleanedSubTitle = s.title || 'Link';
                                
                                const urlObj = (() => {
                                  try { return new URL(s.url); } catch { return null; }
                                })();
                                const urlPath = urlObj ? urlObj.pathname : '';
                                const hostname = urlObj ? urlObj.hostname.replace('www.', '') : '';
                                const domainName = hostname.split('.')[0] || '';
                                const parentTitle = item.primary?.title || '';

                                const splitters = [' - ', ' | ', ' : ', ' — ', ' – '];
                                for (const spl of splitters) {
                                  if (cleanedSubTitle.includes(spl)) {
                                    cleanedSubTitle = cleanedSubTitle.split(spl)[0];
                                  }
                                }

                                const isRepetitiveOrGeneric = !cleanedSubTitle ||
                                  cleanedSubTitle.toLowerCase() === 'link' ||
                                  cleanedSubTitle.toLowerCase() === 'url' ||
                                  cleanedSubTitle.toLowerCase() === hostname.toLowerCase() ||
                                  cleanedSubTitle.toLowerCase() === domainName.toLowerCase() ||
                                  cleanedSubTitle.toLowerCase() === parentTitle.toLowerCase() ||
                                  cleanedSubTitle.toLowerCase().includes('.com') ||
                                  cleanedSubTitle.toLowerCase().includes('/') ||
                                  cleanedSubTitle.toLowerCase().includes('http');

                                if (isRepetitiveOrGeneric && urlPath && urlPath !== '/') {
                                  const pathParts = urlPath.split('/').filter(p => p && p.trim() !== '');
                                  if (pathParts.length > 0) {
                                    let lastPart = pathParts[pathParts.length - 1];
                                    if ((lastPart.toLowerCase() === 'index' || lastPart.toLowerCase() === 'main' || lastPart.length < 2) && pathParts.length > 1) {
                                      lastPart = pathParts[pathParts.length - 2];
                                    }
                                    
                                    cleanedSubTitle = lastPart
                                      .replace(/[-_]/g, ' ')
                                      .replace(/\b\w/g, c => c.toUpperCase());

                                    const pathKeywords: Record<string, string> = {
                                      'signin': 'Sign In',
                                      'signup': 'Sign Up',
                                      'login': 'Log In',
                                      'register': 'Register',
                                      'about': 'About Us',
                                      'contact': 'Contact Us',
                                      'docs': 'Documentation',
                                      'faq': 'FAQ',
                                      'support': 'Support',
                                      'pricing': 'Pricing',
                                      'features': 'Features',
                                      'block': 'Block',
                                      'blog': 'Blog',
                                      'careers': 'Careers',
                                      'download': 'Download',
                                      'getting started': 'Getting Started',
                                      'getting-started': 'Getting Started',
                                      'terms': 'Terms of Service',
                                      'privacy': 'Privacy Policy'
                                    };

                                    const mapped = pathKeywords[cleanedSubTitle.toLowerCase()];
                                    if (mapped) {
                                      cleanedSubTitle = mapped;
                                    }
                                  }
                                }

                                if (cleanedSubTitle.toLowerCase() === 'link' || cleanedSubTitle.toLowerCase() === parentTitle.toLowerCase() || cleanedSubTitle.length < 2) {
                                  if (s.url.includes('signin') || s.url.includes('sign-in')) cleanedSubTitle = 'Sign In';
                                  else if (s.url.includes('login') || s.url.includes('log-in')) cleanedSubTitle = 'Log In';
                                  else if (s.url.includes('about')) cleanedSubTitle = 'About Us';
                                  else if (s.url.includes('contact')) cleanedSubTitle = 'Contact Us';
                                  else if (s.url.includes('doc')) cleanedSubTitle = 'Documentation';
                                  else if (s.url.includes('pricing')) cleanedSubTitle = 'Pricing';
                                  else if (s.url.includes('download')) cleanedSubTitle = 'Download';
                                  else if (s.url.includes('faq')) cleanedSubTitle = 'FAQ';
                                  else if (s.url.includes('github')) cleanedSubTitle = 'Source Code';
                                  else cleanedSubTitle = 'About';
                                }

                                return (
                                  <div key={s.id} className="group/sub hover:bg-slate-50 transition-colors">
                                    <a 
                                      onClick={() => {
                                        const positionIndex = results ? results.findIndex((r: any) => r.id === s.id) : -1;
                                        const position = positionIndex !== -1 ? positionIndex + 1 : null;
                                        onResultClick?.(s.id, s.url, position);
                                      }} 
                                      href={s.url} 
                                      target="_blank" 
                                      rel="noreferrer" 
                                      className="flex items-center justify-between py-3.5 px-2"
                                    >
                                      <span className="text-[15px] sm:text-[16px] font-sans font-normal text-slate-800 group-hover/sub:underline">
                                        {cleanedSubTitle}
                                      </span>
                                      
                                      <div className="shrink-0 flex items-center justify-center">
                                        {isSClicked ? (
                                          <div className="w-[32px] h-[32px] rounded-full border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-500 shadow-3xs">
                                             <Clock size={14} className="text-slate-450 shrink-0" />
                                          </div>
                                        ) : (
                                          <div className="w-[32px] h-[32px] flex items-center justify-center text-slate-400">
                                             <ChevronRight size={16} className="text-slate-400 shrink-0" />
                                          </div>
                                        )}
                                      </div>
                                    </a>
                                  </div>
                                );
                              })}
                            </div>
                            <button 
                              onClick={() => { setQuery(`site:${item.primary.displayUrl}`); onSearch(`site:${item.primary.displayUrl}`); }}
                              className="text-xs font-semibold text-slate-500 hover:text-blue-600 flex items-center gap-1.5 mt-3.5 px-3 py-1.5 hover:bg-slate-50 rounded-lg transition-all border border-slate-100"
                            >
                              More results from {item.primary.displayUrl.replace('www.', '')} <ArrowRight size={12} />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* First FAQ or AI Steps directly after the 1st search result (idx === 0) */}
                      {idx === 0 && (
                        <>
                          {/* Skeletons if loading */}
                          {isSemanticLoading && (
                            <div className="my-6 max-w-[652px] w-full">
                              <div className="border-t border-slate-100/80 my-5" />
                              <StepByStepGuideSkeleton />
                              <div className="border-t border-slate-100/80 my-5" />
                            </div>
                          )}
                          
                          {/* Loaded components */}
                          {!isSemanticLoading && (howTo || (organicFaqs && organicFaqs.length > 0) || (faq && faq.length > 0)) && (
                            <div className="my-6 max-w-[652px] w-full">
                              {howTo ? (
                                <>
                                  <div className="border-t border-slate-100/80 my-5" />
                                  <StepByStepGuide howTo={howTo} onResultClick={onResultClick} />
                                  <div className="border-t border-slate-100/80 my-5" />
                                </>
                              ) : (
                                ((organicFaqs && organicFaqs.length > 0) || (faq && faq.length > 0)) && (
                                  <>
                                    <div className="border-t border-slate-100/80 my-5" />
                                    {organicFaqs && organicFaqs.length > 0 ? (
                                      <OrganicFaqBlock faqs={organicFaqs} onResultClick={onResultClick} />
                                    ) : (
                                      faq && faq.length > 0 && (
                                        <FAQBlock faq={faq.slice(0, 3)} openFaqIndex={openFaqIndex} setOpenFaqIndex={setOpenFaqIndex} />
                                      )
                                    )}
                                    <div className="border-t border-slate-100/80 my-5" />
                                  </>
                                )
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {/* Line/divider between results */}
                      {idx < groupedResults.length - 1 && !(idx === 0 && (howTo || (faq && faq.length > 0) || (organicFaqs && organicFaqs.length > 0) || isSemanticLoading)) && (
                        <div className="my-6">
                          {/* Desktop: standard clean border line */}
                          <div className="hidden md:block border-t border-slate-100/80" />
                          {/* Mobile: Google style full-bleed separator block */}
                          <div className="md:hidden h-[8px] bg-slate-100/70 -mx-4" />
                        </div>
                      )}
                    </React.Fragment>
                ))}
              </div>
            ) : <div className="py-20 text-center text-slate-400 font-medium italic">No results found for your query.</div>}

            {/* Elegant Default Search Promotion Box at the bottom of the results */}
            {!loading && (
              <div className="mt-12 mb-6 p-5 rounded-[24px] bg-slate-50 border border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl shrink-0">
                    <Navigation size={18} className="rotate-45" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-[13.5px]">Make Scout your default search engine</h4>
                    <p className="text-[12px] text-slate-500">Get instant AI highlights and smart tools on every search directly from your address bar.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSearchEngineModalOpen(true)}
                  className="px-4.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-full transition-colors shrink-0 shadow-2xs cursor-pointer"
                >
                  Get Started
                </button>
              </div>
            )}

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
      )}
      </main>
      </div>
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
        const res = await generateContentViaProxy({
          model: "gemini-3.5-flash",
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

function ImageStrip({ results, onMore, onResultClick, onImageClick, query = '' }: { results: SearchResult[], onMore: () => void, onResultClick?: (id: string, url: string) => void, onImageClick?: (img: any) => void, query?: string }) {
  const imagesWithMeta = React.useMemo(() => {
    // 1. Tokenize query words (longer than 1 character)
    const terms = query.toLowerCase().trim().split(/\s+/).filter(t => t.length > 1);
    
    // 2. Filter list of raw results that have an image
    const rawImages = results.filter(r => r.image);
    
    if (terms.length === 0) {
      return rawImages.slice(0, 4);
    }
    
    // 3. For each image, compute keyword relevance score
    const scored = rawImages.map(img => {
      let matchScore = 0;
      const titleL = (img.title || '').toLowerCase();
      const snippetL = (img.snippet || '').toLowerCase();
      const urlL = (img.url || '').toLowerCase();
      const altL = (img.alt || img.title || '').toLowerCase();

      terms.forEach(term => {
        if (titleL.includes(term)) matchScore += 15;
        if (altL.includes(term)) matchScore += 15;
        if (snippetL.includes(term)) matchScore += 8;
        if (urlL.includes(term)) matchScore += 5;
      });

      // Weigh in original ranking search score representation (typically between 0.3-0.9)
      const baseScore = img.score || 0;
      const totalScore = matchScore + (baseScore * 10);

      return { img, matchScore, totalScore };
    });

    // 4. Try to show only matching elements first if matchScore > 0, otherwise fallback
    let filtered = scored.filter(item => item.matchScore > 0);
    if (filtered.length === 0) {
      filtered = scored; // fallback to general relevance if no deep keyword matches found
    }

    // 5. Rank descending by final total score
    filtered.sort((a, b) => b.totalScore - a.totalScore);

    return filtered.map(item => item.img).slice(0, 4);
  }, [results, query]);

  if (imagesWithMeta.length === 0) return null;

  // Derive human search keyword representation for header
  const keywords = query.trim() || results[0]?.title.split(' ')[0] || 'your search';

  return (
    <div className="py-6 border-b border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between mb-5 px-1">
        <h2 className="text-lg md:text-xl font-display font-medium text-slate-900 truncate pr-4">Images for <span className="font-bold text-slate-800 italic">"{keywords}"</span></h2>
        <button 
          onClick={onMore} 
          className="shrink-0 bg-[#f1f3f4] hover:bg-[#e8eaed] text-slate-800 px-4 py-1.5 rounded-full text-[12px] font-sans font-semibold flex items-center gap-1 transition-colors cursor-pointer border-none shadow-none"
        >
          View all <ChevronRight size={12} className="text-slate-650 shrink-0" />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
        {imagesWithMeta.map((img) => (
          <div key={img.id} onClick={(e) => { e.preventDefault(); onImageClick?.(img); }} className="w-full group cursor-pointer">
            <div className="h-[120px] sm:h-[130px] w-full rounded-2xl overflow-hidden bg-slate-50 border border-slate-100 flex items-center justify-center p-2.5 transition-all group-hover:bg-slate-100/60 group-hover:shadow-md">
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

function SafeSearchSelector({ safeSearch, setSafeSearch }: { safeSearch: 'strict' | 'moderate' | 'off', setSafeSearch: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (mode: 'strict' | 'moderate' | 'off') => {
    setSafeSearch(mode);
    localStorage.setItem('safe_search', mode);
    setIsOpen(false);
    // Reload search to immediately filter results!
    const searchForm = document.querySelector('form');
    if (searchForm) {
      searchForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  };

  const getLabel = () => {
    if (safeSearch === 'strict') return 'SafeSearch: Strict';
    if (safeSearch === 'moderate') return 'SafeSearch: Moderate';
    return 'SafeSearch: Off';
  };

  const getColor = () => {
    if (safeSearch === 'strict') return 'text-green-600 bg-green-50 border-green-100 hover:bg-green-100/70 border-solid';
    if (safeSearch === 'moderate') return 'text-amber-600 bg-amber-50 border-amber-100 hover:bg-amber-100/70 border-solid';
    return 'text-slate-500 bg-slate-50 border-slate-200 hover:bg-slate-100 border-solid';
  };

  return (
    <div className="relative z-50 text-left" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold font-sans tracking-tight transition-all active:scale-95 cursor-pointer ${getColor()}`}
      >
        <Shield size={14} className="stroke-[2.5]" />
        <span>{getLabel()}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-56 rounded-2xl bg-white border border-slate-100 shadow-xl z-50 p-2.5 overflow-hidden"
          >
            <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 tracking-wider uppercase">
              Filter Explicit Results
            </div>
            <div className="space-y-1">
              <button
                onClick={() => handleSelect('strict')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-medium transition-all cursor-pointer ${
                  safeSearch === 'strict' ? 'bg-green-50 text-green-700' : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div>
                  <div className="font-bold">Strict (Filter)</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Filter explicit text & images</div>
                </div>
                {safeSearch === 'strict' && <Check size={14} className="stroke-[2.5]" />}
              </button>

              <button
                onClick={() => handleSelect('moderate')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-medium transition-all cursor-pointer ${
                  safeSearch === 'moderate' ? 'bg-amber-50 text-amber-700' : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div>
                  <div className="font-bold">Moderate (Blur)</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Strict web search protection</div>
                </div>
                {safeSearch === 'moderate' && <Check size={14} className="stroke-[2.5]" />}
              </button>

              <button
                onClick={() => handleSelect('off')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-medium transition-all cursor-pointer ${
                  safeSearch === 'off' ? 'bg-slate-50 text-slate-900 border border-slate-100' : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div>
                  <div className="font-bold">Off</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Show all results (if legal)</div>
                </div>
                {safeSearch === 'off' && <Check size={14} className="stroke-[2.5]" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserProfile({ user, onLogin, onLogout, isSignoutOpen, setIsSignoutOpen, isHome, onOpenAnalytics }: any) {
  const isAdmin = user && ['komumech@gmail.com'].includes(user.email?.toLowerCase());

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

function FAQFeedbackRow({ question, answer }: { question: string; answer: string }) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const handleFeedback = (type: 'up' | 'down') => {
    setFeedback(type);
    
    // Log to standard endpoint
    axios.post('/api/feedback', {
      id: 'faq_' + encodeURIComponent(question.substring(0, 30)),
      type: type === 'up' ? 'success' : 'pogo',
      queryText: question,
      url: 'faq_item_feedback'
    }).catch(() => {});

    // Save directly to Firestore clickstream
    try {
      addDoc(collection(db, "clickstream"), {
        query: question,
        type: type === 'up' ? 'thumbs_up' : 'thumbs_down',
        url: 'faq_item_feedback',
        timestamp: serverTimestamp(),
        sessionId: getSessionId(),
        uid: 'guest'
      });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-1.5 shrink-0 self-end">
      <span className="text-xs font-semibold text-slate-400">Helpful?</span>
      <button 
        onClick={() => handleFeedback('up')}
        className={`p-1.5 rounded-lg transition-all active:scale-90 ${feedback === 'up' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:text-slate-600'}`}
        title="Helpful"
      >
        <ThumbsUp size={13} className={feedback === 'up' ? 'fill-emerald-600' : ''} />
      </button>
      <button 
        onClick={() => handleFeedback('down')}
        className={`p-1.5 rounded-lg transition-all active:scale-90 ${feedback === 'down' ? 'text-red-600 bg-red-50' : 'text-slate-400 hover:text-slate-600'}`}
        title="Not helpful"
      >
        <ThumbsDown size={13} className={feedback === 'down' ? 'fill-red-600' : ''} />
      </button>
      {feedback && <span className="text-[10px] text-emerald-600 font-bold animate-pulse">Thanks!</span>}
    </div>
  );
}

function FAQBlock({ faq, openFaqIndex, setOpenFaqIndex }: any) {
  return (
    <div className="py-4 animate-in fade-in duration-500 w-full md:max-w-[850px] lg:max-w-[900px] xl:max-w-[980px] max-w-full">
      <h4 className="font-display font-bold text-slate-800 text-xl mb-4">People also ask</h4>
      <div className="divide-y divide-slate-100">
        {faq.map((item: any, i: number) => (
          <div key={i} className="py-4">
            <button 
              onClick={() => openFaqIndex === item.question ? setOpenFaqIndex(null) : setOpenFaqIndex(item.question)}
              className="w-full flex items-center justify-between text-left group"
            >
              <span className="text-base md:text-lg font-normal text-slate-800 transition-colors whitespace-normal block max-w-full leading-snug" title={item.question}>
                {item.question}
              </span>
              <div className="shrink-0 pl-2">
                <ChevronRight 
                  size={18} 
                  className={`text-slate-400 transition-transform duration-300 ${openFaqIndex === item.question ? 'rotate-90' : ''}`} 
                />
              </div>
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
                    <p className="mb-3 leading-relaxed">{item.answer}</p>
                    <div className="flex justify-end pt-2 border-t border-slate-50">
                      <FAQFeedbackRow question={item.question} answer={item.answer} />
                    </div>
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

function FeaturedVideoBlock({ video, onResultClick }: { video: any; onResultClick?: any }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  
  if (!video) return null;

  const handleFeedback = (type: 'up' | 'down') => {
    setFeedback(type);
    
    // Log to standard endpoint
    axios.post('/api/feedback', {
      id: 'youtube_' + video.id,
      type: type === 'up' ? 'success' : 'pogo',
      queryText: video.title,
      url: 'youtube_featured_feedback'
    }).catch(() => {});

    // Save directly to Firestore clickstream
    try {
      addDoc(collection(db, "clickstream"), {
        query: video.title,
        type: type === 'up' ? 'thumbs_up' : 'thumbs_down',
        url: 'youtube_featured_feedback',
        timestamp: serverTimestamp(),
        sessionId: getSessionId(),
        uid: 'guest'
      });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="bg-white rounded-xl sm:rounded-[32px] p-3.5 sm:p-6 md:p-8 shadow-sm overflow-hidden mb-6 group/video max-w-full">
      <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-slate-955 shadow-sm">
        {!isPlaying ? (
          <div className="absolute inset-0 w-full h-full cursor-pointer group" onClick={() => setIsPlaying(true)}>
            <img 
              src={video.thumbnail || `https://img.youtube.com/vi/${video.id}/mqdefault.jpg`} 
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" 
              alt={video.title} 
            />
            <div className="absolute inset-0 bg-black/25 group-hover:bg-black/15 transition-colors flex items-center justify-center">
              <div className="w-16 h-16 bg-red-650 rounded-full flex items-center justify-center text-white shadow-xl group-hover:scale-110 active:scale-95 transition-all duration-300">
                <Play size={28} fill="currentColor" className="ml-1" />
              </div>
            </div>
            {video.duration && (
              <span className="absolute bottom-3.5 right-3.5 bg-black/80 px-2 py-0.5 text-xs text-white font-mono font-bold rounded-md">
                {video.duration}
              </span>
            )}
          </div>
        ) : (
          <iframe 
            src={`https://www.youtube.com/embed/${video.id}?autoplay=1`} 
            title={video.title}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
            allowFullScreen
            className="w-full h-full"
          />
        )}
      </div>

      <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-display font-bold text-slate-800 text-lg leading-snug hover:text-blue-600 transition-colors">
            <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" onClick={() => onResultClick?.(video.id, 'youtube_featured')}>
              {video.title}
            </a>
          </h3>
          <div className="flex flex-wrap items-center text-xs text-slate-500 mt-2.5 gap-x-3 gap-y-1 font-semibold">
            <span className="font-bold text-slate-700">{video.channelTitle}</span>
            <span className="text-slate-300">•</span>
            <span>{video.views || 'YouTube Video'}</span>
            <span className="text-slate-300">•</span>
            <span>{video.publishedTime || video.publishedAt || 'Recently'}</span>
          </div>
        </div>

        {/* Feedback buttons */}
        <div className="flex items-center gap-2 border-l border-slate-100 pl-4 shrink-0">
          <span className="text-xs font-semibold text-slate-400">Helpful?</span>
          <button 
            onClick={() => handleFeedback('up')}
            className={`p-1.5 rounded-lg transition-all active:scale-90 ${feedback === 'up' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:text-slate-600'}`}
            title="Helpful recommendation"
          >
            <ThumbsUp size={14} className={feedback === 'up' ? 'fill-emerald-600' : ''} />
          </button>
          <button 
            onClick={() => handleFeedback('down')}
            className={`p-1.5 rounded-lg transition-all active:scale-90 ${feedback === 'down' ? 'text-red-600 bg-red-50' : 'text-slate-400 hover:text-slate-600'}`}
            title="Not helpful recommendation"
          >
            <ThumbsDown size={14} className={feedback === 'down' ? 'fill-red-600' : ''} />
          </button>
          {feedback && <span className="text-[10px] text-emerald-600 font-bold animate-pulse">Thanks!</span>}
        </div>
      </div>
    </div>
  );
}

function StepByStepGuideSkeleton() {
  return (
    <div className="bg-white rounded-xl sm:rounded-[32px] p-4 sm:p-6 md:p-8 shadow-sm transition-all mb-6 max-w-full animate-pulse border border-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-100 pb-5">
        <div className="space-y-2">
          <div className="h-3 w-32 bg-slate-200 rounded"></div>
          <div className="h-5 w-64 bg-slate-300 rounded"></div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-16 bg-slate-100 rounded-full"></div>
          <div className="h-6 w-16 bg-slate-100 rounded-full"></div>
        </div>
      </div>
      <div className="mb-6 space-y-2">
        <div className="flex justify-between">
          <div className="h-3 w-20 bg-slate-200 rounded"></div>
          <div className="h-3 w-12 bg-slate-200 rounded"></div>
        </div>
        <div className="h-2 bg-slate-100 rounded-full w-full"></div>
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 p-4 rounded-xl border border-slate-50 last:mb-0 bg-slate-50/50">
            <div className="w-6 h-6 rounded-full bg-slate-200 shrink-0"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 bg-slate-200 rounded"></div>
              <div className="h-3 w-5/6 bg-slate-100 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrganicFaqBlockSkeleton() {
  return (
    <div className="bg-white rounded-xl sm:rounded-[32px] p-4 sm:p-6 md:p-8 shadow-sm w-full mb-6 max-w-full animate-pulse border border-slate-100">
      <div className="flex items-center gap-2 mb-6">
        <div className="w-7 h-7 bg-slate-200 rounded-xl"></div>
        <div className="h-4 w-48 bg-slate-300 rounded"></div>
      </div>
      <div className="divide-y divide-slate-100">
        {[1, 2, 3].map((i) => (
          <div key={i} className="py-4 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between">
              <div className="h-5 w-2/3 bg-slate-200 rounded"></div>
              <div className="w-5 h-5 bg-slate-200 rounded-full"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepByStepGuide({ howTo, onResultClick }: { howTo: any; onResultClick?: any }) {
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});
  const [expandedStep, setExpandedStep] = useState<number | null>(0);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  if (!howTo || !howTo.steps || howTo.steps.length === 0) return null;

  const totalSteps = howTo.steps.length;
  const completedSteps = Object.values(checkedSteps).filter(Boolean).length;
  const progressPercent = Math.round((completedSteps / totalSteps) * 100);

  const handleCopyAll = () => {
    const text = `${howTo.title}\n\n` + howTo.steps.map((s: any, idx: number) => {
      return `${idx + 1}. ${s.step}\n${s.details || ''}\n${s.sourceUrl ? `Source: ${s.sourceUrl}` : ''}`;
    }).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFeedback = (type: 'up' | 'down') => {
    setFeedback(type);
    
    // Log to standard endpoint
    axios.post('/api/feedback', {
      id: 'step_guide_' + encodeURIComponent(howTo.title.substring(0, 30)),
      type: type === 'up' ? 'success' : 'pogo',
      queryText: howTo.title,
      url: 'how_to_guide_feedback'
    }).catch(() => {});

    // Save directly to Firestore clickstream
    try {
      addDoc(collection(db, "clickstream"), {
        query: howTo.title,
        type: type === 'up' ? 'thumbs_up' : 'thumbs_down',
        url: 'how_to_guide_feedback',
        timestamp: serverTimestamp(),
        sessionId: getSessionId(),
        uid: 'guest'
      });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="w-full py-4 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center">
          <span className="text-[12px] font-bold uppercase tracking-widest text-[#5f6368]">Interactive Guided Steps</span>
        </div>
        <div className="flex items-center gap-3">
          {howTo.estimatedTime && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 font-bold bg-slate-50 px-2.5 py-1 rounded-full border border-slate-100">
              <Clock size={12} /> {howTo.estimatedTime}
            </span>
          )}
          {howTo.difficulty && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 font-bold bg-slate-50 px-2.5 py-1 rounded-full border border-slate-100">
              <Zap size={12} /> {howTo.difficulty}
            </span>
          )}
        </div>
      </div>

      <h3 className="text-xl md:text-2xl font-display font-black text-slate-800 leading-snug tracking-tight mb-4 animate-in fade-in duration-300">
        {howTo.title}
      </h3>

      {/* Progress bar */}
      <div className="flex items-center gap-4 mb-6 select-none">
        <div className="flex-1 relative h-1.5 bg-slate-200 rounded-full overflow-visible">
          {/* Active bar */}
          <div 
            className="absolute left-0 top-0 h-full bg-[#1a73e8] rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
          {/* Slider Knob */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#1a73e8] border border-white shadow-md transition-all duration-300 ease-out"
            style={{ 
              left: `${progressPercent}%`, 
              marginLeft: '-8px'
            }}
          />
        </div>
        <span className="text-xs font-bold text-[#1a73e8] font-sans pr-2 shrink-0">{progressPercent}% complete</span>
      </div>

      <div className="space-y-3.5">
        {howTo.steps.map((s: any, idx: number) => {
          const isCompleted = !!checkedSteps[idx];
          const isExpanded = expandedStep === idx;

          return (
            <div 
              key={idx}
              className={`group rounded-2xl transition-all duration-300 overflow-hidden ${
                isCompleted 
                  ? 'bg-emerald-50/20' 
                  : isExpanded 
                    ? 'bg-blue-50/20' 
                    : 'bg-slate-50/40 hover:bg-slate-50/80'
              }`}
            >
              <div 
                className="flex items-center justify-between p-4 cursor-pointer" 
                onClick={() => setExpandedStep(isExpanded ? null : idx)}
              >
                <div className="flex items-center gap-3.5 overflow-hidden">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setCheckedSteps(prev => ({ ...prev, [idx]: !prev[idx] }));
                    }}
                    className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all shrink-0 active:scale-90 ${
                      isCompleted 
                        ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm' 
                        : 'border-slate-300 hover:border-slate-450 bg-white'
                    }`}
                  >
                    {isCompleted && <Check size={14} className="stroke-[3]" />}
                  </button>

                  <span className={`text-[15px] font-bold tracking-tight text-slate-800 transition-all whitespace-normal block leading-snug ${
                    isCompleted ? 'line-through text-slate-400 font-normal font-sans' : ''
                  }`}>
                    {s.step}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-slate-400 group-hover:text-slate-600 pl-2">
                  <ChevronRight size={16} className={`transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} />
                </div>
              </div>

              {isExpanded && (
                <div className="overflow-hidden">
                  <div className="px-11 pb-4 pr-4 transition-all duration-300 animate-in fade-in slide-in-from-top-1">
                    <p className="text-[14px] text-slate-600 leading-relaxed font-semibold mb-3">
                      {s.details}
                    </p>
                    {s.sourceUrl && (
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-slate-400 font-semibold">Source:</span>
                        <a 
                          href={s.sourceUrl} 
                          target="_blank" 
                          rel="noreferrer" 
                          onClick={() => onResultClick?.(s.sourceUrl, 'how_to_source')}
                          className="text-blue-500 hover:underline inline-flex items-center gap-0.5 font-bold truncate max-w-[280px]"
                        >
                          {s.sourceUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]} <ExternalLink size={10} />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 pt-5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={handleCopyAll}
            className="text-xs font-bold text-slate-500 hover:text-blue-600 flex items-center gap-1.5 transition-colors cursor-pointer bg-slate-50 hover:bg-slate-100 px-3.5 py-2 rounded-xl border border-transparent hover:border-slate-200"
          >
            {copied ? (
              <>
                <Check size={14} className="text-emerald-600" /> Copied steps!
              </>
            ) : (
              <>
                <Copy size={13} /> Copy all steps
              </>
            )}
          </button>
          
          <button 
            onClick={() => setCheckedSteps({})}
            className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer bg-transparent hover:bg-slate-50 px-3.5 py-2 rounded-xl"
          >
            Reset checklist
          </button>
        </div>

        {/* Feedback Section */}
        <div className="flex items-center gap-2 border-l border-slate-100 pl-4 shrink-0">
          <span className="text-xs font-semibold text-slate-400">Helpful?</span>
          <button 
            onClick={() => handleFeedback('up')}
            className={`p-1.5 rounded-lg transition-all active:scale-90 ${feedback === 'up' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:text-slate-600'}`}
            title="Helpful steps"
          >
            <ThumbsUp size={14} className={feedback === 'up' ? 'fill-emerald-600' : ''} />
          </button>
          <button 
            onClick={() => handleFeedback('down')}
            className={`p-1.5 rounded-lg transition-all active:scale-90 ${feedback === 'down' ? 'text-red-600 bg-red-50' : 'text-slate-400 hover:text-slate-600'}`}
            title="Not helpful steps"
          >
            <ThumbsDown size={14} className={feedback === 'down' ? 'fill-red-600' : ''} />
          </button>
          {feedback && <span className="text-[10px] text-emerald-600 font-bold animate-pulse">Thanks!</span>}
        </div>
      </div>
    </div>
  );
}

function OrganicFaqBlock({ faqs, onResultClick }: { faqs: any[]; onResultClick?: any }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  if (!faqs || faqs.length === 0) return null;

  return (
    <div className="bg-white rounded-xl sm:rounded-[32px] p-3.5 sm:p-6 md:p-8 shadow-sm w-full mb-6 max-w-full">
      <div className="flex items-center gap-2 mb-4 animate-in fade-in duration-300">
        <div className="p-1.5 bg-purple-50 text-purple-600 rounded-xl">
          <HelpCircle size={18} className="stroke-[2.5]" />
        </div>
        <span className="text-xs font-black uppercase tracking-widest text-[#5f6368]">People Also Ask (Semantic)</span>
      </div>

      <div className="divide-y divide-slate-100">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div key={idx} className="py-4 first:pt-0 last:pb-0 font-medium">
              <button 
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                className="w-full flex items-center justify-between text-left font-display font-medium text-slate-800 text-base md:text-[17px] hover:text-blue-600 transition-colors py-1 cursor-pointer"
              >
                <span className="pr-4">{faq.question}</span>
                <ChevronRight size={18} className={`text-slate-400 shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-90' : ''}`} />
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3 pb-1">
                      <p className="text-[15px] text-slate-600 leading-relaxed font-normal mb-3">
                        {faq.answer}
                      </p>
                      
                      <div className="flex flex-wrap items-center justify-between gap-4 mt-3 pt-2.5 border-t border-slate-55">
                        {faq.sourceUrl ? (
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                            <span>Answer from:</span>
                            <a 
                              href={faq.sourceUrl} 
                              target="_blank" 
                              rel="noreferrer" 
                              onClick={() => onResultClick?.(faq.sourceUrl, 'faq_source')}
                              className="text-blue-500 hover:underline font-bold inline-flex items-center gap-0.5 truncate max-w-[280px]"
                            >
                              {faq.sourceUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]} <ExternalLink size={10} />
                            </a>
                          </div>
                        ) : <div />}

                        {/* Thumbs up/down per FAQ */}
                        <FAQFeedbackRow question={faq.question} answer={faq.answer} />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultCard({ res, carouselImages, isImageUrl, onResultClick, clickedUrls, onVisualSearch, onImageClick, allResults, onImageError }: any) {
  const [isPlayingVideo, setIsPlayingVideo] = React.useState(false);
  const [expandedFaqIndex, setExpandedFaqIndex] = React.useState<number | null>(null);

  const details = React.useMemo(() => {
    if (!res.card_details) return {};
    try {
      return typeof res.card_details === 'string' ? JSON.parse(res.card_details) : res.card_details;
    } catch (e) {
      return {};
    }
  }, [res.card_details]);

  // Robust helper to extract YouTube video ID from any standard, encoded, or tracking-wrapped links
  const getYouTubeId = (urlStr: string) => {
    if (!urlStr) return null;
    
    // Decode URLs (handles tracking and encoding wrapped structures)
    let decoded = urlStr;
    try {
      for (let i = 0; i < 3; i++) {
        const nextDecoded = decodeURIComponent(decoded);
        if (nextDecoded === decoded) break;
        decoded = nextDecoded;
      }
    } catch (e) {
      // safe fallback on error
    }

    // Pattern 1: Match standard/parameter ?v=ID or &v=ID
    const vParamMatch = decoded.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (vParamMatch) return vParamMatch[1];

    // Pattern 2: Match paths layout (embed, shorts, v, youtu.be, etc.)
    const pathMatch = decoded.match(/(?:embed\/|shorts\/|v\/|youtu\.be\/|y2u\.be\/)([a-zA-Z0-9_-]{11})/);
    if (pathMatch) return pathMatch[1];

    // Pattern 3: General fallback search for adjacent 11-char sequence with YouTube host
    const fallbackMatch = decoded.match(/(?:youtube\.com|youtu\.be|youtube-nocookie\.com).{1,50}?([a-zA-Z0-9_-]{11})/i);
    if (fallbackMatch) return fallbackMatch[1];

    return null;
  };

  const youtubeId = getYouTubeId(res.url);

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
    <article className="group py-3.5 transition-all pl-0 overflow-hidden">
      {isPreviouslyClicked && (
        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2 px-1">
          <Clock size={12} />
          <span>Visited recently</span>
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

          {res.layout_intent && (
            <div className="flex items-center gap-1.5 mb-2 mt-1 select-none">
              {res.layout_intent === 'VIDEO_PLAYER' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200">
                  <Play size={10} fill="currentColor" />
                  Video
                </span>
              )}
              {res.layout_intent === 'LOCAL_MAP' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-emerald-600 bg-emerald-50/80 border border-emerald-100 shadow-xs">
                  <MapPin size={10} />
                  Local Map / Place
                </span>
              )}
              {res.layout_intent === 'PRODUCT_LIST' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-amber-600 bg-amber-50/80 border border-amber-100 shadow-xs">
                  <ShoppingBag size={10} />
                  Product List / Shop
                </span>
              )}
              {res.layout_intent === 'HOW_TO' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-blue-600 bg-blue-50/80 border border-blue-100 shadow-xs">
                  <BookOpen size={10} />
                  How-To Guide
                </span>
              )}
              {res.layout_intent === 'NEWS' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-indigo-600 bg-indigo-50/80 border border-indigo-100 shadow-xs">
                  <Newspaper size={10} />
                  Editorial News
                </span>
              )}
            </div>
          )}

          <div className="relative group/title inline-block">
            <a onClick={() => onResultClick?.(res.id, res.url, position)} href={res.url} target="_blank" rel="noreferrer" className="block mb-2">
              <h3 className="text-[19px] md:text-[20px] font-sans font-normal text-[#1a0dab] group-hover:underline leading-tight line-clamp-2">
                {res.title}
              </h3>
            </a>
          </div>

          <p className="text-[#4d5156] text-[14.5px] lg:text-[15px] leading-relaxed line-clamp-3 md:line-clamp-4 mb-4">
            {res.snippet && res.snippet.length > 320 ? (res.snippet.substring(0, 315) + '...') : res.snippet}
          </p>

          {/* DYNAMIC HIGH-FIDELITY SCHEMAS & VISUAL CARDS RENDERER */}
          {res.card_type && res.card_type !== 'none' && (
            <div className="mt-3 mb-4 select-none">
              {res.card_type === 'product' && (
                <div className="py-2.5 space-y-3 max-w-[500px]">
                  <div className="flex gap-4">
                    {/* Tiny product thumbnail if available */}
                    {details.card_image ? (
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-white border border-slate-100 shrink-0">
                        <img 
                          src={details.card_image} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer" 
                          onError={() => {
                            if (details.card_image) onImageError?.(details.card_image);
                          }}
                        />
                      </div>
                    ) : res.image ? (
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-white border border-slate-100 shrink-0">
                        <img 
                          src={res.image} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer" 
                          onError={() => {
                            if (res.image) onImageError?.(res.image);
                          }}
                        />
                      </div>
                    ) : null}
                    
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* High res site favicon */}
                        <img 
                          src={`https://www.google.com/s2/favicons?domain=${res.displayUrl}&sz=32`} 
                          className="w-4 h-4 rounded-full shrink-0" 
                          referrerPolicy="no-referrer"
                          onError={(e: any) => { (e.target as any).style.display = 'none'; }}
                        />
                        <span className="text-xs font-bold text-slate-700">{displaySiteName}</span>
                      </div>
                      <div className="text-[20px] font-extrabold text-[#1f2937] tracking-tight leading-normal">
                        {details.currency || "₦"}{details.price}
                      </div>
                      {(details.rating || details.reviews) && (
                        <div className="flex items-center gap-1 text-[11.5px] font-bold text-slate-500">
                          <span className="text-amber-500 text-sm leading-none">★</span>
                          <span className="text-slate-800 font-extrabold">{details.rating || "5.0"}</span>
                          <span>({details.reviews || "10+"} reviews)</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-slate-150/60">
                    <div className="flex items-center gap-1.5 text-[12px] font-bold text-emerald-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 block animate-pulse" />
                      <span>{details.availability || "In stock"}</span>
                    </div>
                    
                    <a 
                      href={res.url} 
                      target="_blank" 
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#f1f3f4] hover:bg-slate-200 text-slate-800 font-extrabold text-[12.5px] rounded-full transition-all active:scale-95 cursor-pointer decoration-none border-none"
                    >
                      <span>Visit {displaySiteName}</span>
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" fill="none" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
              )}

              {res.card_type === 'recipe' && (
                <div className="py-2.5 space-y-3 max-w-[500px]">
                  <div className="flex gap-4">
                    {/* Beautiful preview image with a flag overlay like Image 2 */}
                    {details.card_image ? (
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-white border border-slate-100 shrink-0 relative group/recipe-card-img">
                        <img 
                          src={details.card_image} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer" 
                          onError={() => {
                            if (details.card_image) onImageError?.(details.card_image);
                          }}
                        />
                        <div className="absolute top-1 right-1 p-0.5 bg-black/35 backdrop-blur-xs rounded text-white">
                          <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                            <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" />
                          </svg>
                        </div>
                      </div>
                    ) : res.image ? (
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-white border border-slate-100 shrink-0 relative">
                        <img 
                          src={res.image} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer" 
                          onError={() => {
                            if (res.image) onImageError?.(res.image);
                          }}
                        />
                        <div className="absolute top-1 right-1 p-0.5 bg-black/35 backdrop-blur-xs rounded text-white">
                          <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                            <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" />
                          </svg>
                        </div>
                      </div>
                    ) : null}
                    
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1 text-[13px] text-slate-800 font-extrabold flex-wrap">
                        <span className="text-amber-500 text-sm leading-none">★</span>
                        <span>{details.rating || "5.0"}</span>
                        <span className="text-slate-400 font-normal">({details.reviews || "20+"} reviews)</span>
                        {details.calories && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-500 font-normal text-xs">{details.calories}</span>
                          </>
                        )}
                      </div>
                      
                      <div className="text-xs text-slate-500 font-semibold flex items-center gap-1 flex-wrap">
                        <span>Prep & Cook: {details.time ? details.time.replace('PT','').replace('M','m').replace('H','h') : '15 min'}</span>
                        <span>·</span>
                        <span>By {details.publisher || displaySiteName}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="pt-2 border-t border-slate-150/60 flex justify-end">
                    <a 
                      href={res.url} 
                      target="_blank" 
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#f1f3f4] hover:bg-slate-200 text-slate-800 font-extrabold text-[12.5px] rounded-full transition-all active:scale-95 cursor-pointer decoration-none border-none"
                    >
                      <span>Read full recipe on {displaySiteName}</span>
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" fill="none" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
              )}

              {res.card_type === 'faq' && (
                <div className="space-y-2 border-t border-slate-200/70 pt-3 max-w-[650px]">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <img 
                      src={`https://www.google.com/s2/favicons?domain=${res.displayUrl}&sz=32`} 
                      className="w-3.5 h-3.5 rounded-full shrink-0" 
                      referrerPolicy="no-referrer"
                      onError={(e: any) => { (e.target as any).style.display = 'none'; }}
                    />
                    <h4 className="text-[14px] font-bold text-slate-800 leading-none">Answers from {displaySiteName}:</h4>
                  </div>
                  <div className="divide-y divide-slate-150 border-y border-slate-200/70">
                    {(details.qa_data || []).map((faq: any, i: number) => {
                      const isFaqExpanded = expandedFaqIndex === i;
                      return (
                        <div key={i} className="py-2.5 text-left transition-colors hover:bg-slate-50/40">
                          <button 
                            onClick={(e) => { e.preventDefault(); setExpandedFaqIndex(isFaqExpanded ? null : i); }}
                            className="w-full flex items-center justify-between gap-3 text-[14px] sm:text-[14.5px] font-medium text-slate-800 hover:text-blue-600 transition-colors text-left focus:outline-none"
                          >
                            <span>{faq.question}</span>
                            <ChevronRight size={15} className={`text-slate-400 shrink-0 transition-transform duration-250 ${isFaqExpanded ? 'rotate-90 text-blue-600' : ''}`} />
                          </button>
                          {isFaqExpanded && (
                            <div className="mt-2 text-[13.5px] sm:text-[14px] text-slate-600 leading-relaxed pl-1 animate-in fade-in slide-in-from-top-1 duration-200">
                              {faq.answer}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {res.card_type === 'news_article' && (
                <div className="py-2.5 max-w-[500px]">
                  <div className="text-[10px] text-indigo-600 font-extrabold uppercase tracking-wider mb-1 leading-none">Editorial News Article</div>
                  {details.author && <div className="text-[12.5px] text-slate-800 font-bold">By {details.author}</div>}
                  {details.published_date && <div className="text-[11px] text-slate-400 mt-1">Date: {details.published_date}</div>}
                </div>
              )}

              {res.card_type === 'event' && (
                <div className="py-2.5 flex gap-3 align-center max-w-[500px]">
                  <div className="w-11 h-11 rounded-lg bg-rose-50 border border-rose-100 flex flex-col items-center justify-center text-rose-600 font-bold tracking-tight shrink-0">
                    <span className="text-[9px] font-black uppercase leading-none">Event</span>
                    <span className="text-xs leading-none mt-1">Calendar</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h5 className="font-extrabold text-[13.5px] text-slate-800 leading-snug">{details.event_name || 'Upcoming Event'}</h5>
                    {details.start_date && (
                      <p className="text-xs text-slate-500 mt-0.5 font-medium truncate">
                        {details.start_date} {details.location ? `· ${details.location}` : ''}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            {/* Watch YouTube Video Inline Action */}
            {youtubeId && (
              <button 
                onClick={() => setIsPlayingVideo(!isPlayingVideo)}
                className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800 bg-[#f1f3f4] hover:bg-[#e8eaed] border border-transparent px-3 py-1.5 rounded-full transition-all active:scale-95 cursor-pointer"
              >
                <Play size={11} fill="currentColor" />
                {isPlayingVideo ? 'Close Player' : 'Play Video Inline'}
              </button>
            )}

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

          {/* Removed nested PageIntelligencePanel per user request to display single FAQ under 1st result card */}

          {/* Inline Playable YouTube Player */}
          {isPlayingVideo && youtubeId && (
            <div className="w-full aspect-video mt-5 rounded-3xl overflow-hidden shadow-md border-2 border-slate-100 bg-black relative">
              <iframe 
                width="100%" 
                height="100%" 
                src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0`} 
                title={res.title} 
                frameBorder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                allowFullScreen 
                className="w-full h-full"
              />
            </div>
          )}
        </div>
        
        {/* Main Side Image / Carousel */}
        {activeImage && (
          <div 
            onClick={() => {
              if (youtubeId) {
                setIsPlayingVideo(!isPlayingVideo);
              } else {
                const imgData = domainImages[currentImgIndex] || { id: res.id, image: res.image, title: res.title, displayUrl: res.displayUrl, url: res.url, snippet: res.snippet };
                onImageClick?.(imgData);
              }
            }}
            className="shrink-0 w-36 h-36 md:w-48 md:h-48 rounded-2xl overflow-hidden border border-slate-100 shadow-sm relative group/carousel mt-4 sm:mt-0 bg-slate-50 cursor-pointer flex items-center justify-center p-2.5"
          >
            <AnimatePresence mode="wait">
              <motion.img 
                key={activeImage}
                src={activeImage} 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="max-w-full max-h-full object-contain transition-transform hover:scale-105" 
                referrerPolicy="no-referrer" 
                onError={() => {
                  if (activeImage) onImageError?.(activeImage);
                }}
              />
            </AnimatePresence>

            {/* Play Button Overlay for Video Intent */}
            {res.layout_intent === 'VIDEO_PLAYER' && (
              <div className="absolute inset-0 bg-black/10 flex items-center justify-center transition-colors group-hover/carousel:bg-black/20">
                <div className="p-3 bg-white/90 backdrop-blur-md rounded-full shadow-lg text-slate-800 transform scale-100 group-hover/carousel:scale-110 transition-transform">
                  <Play size={16} fill="currentColor" />
                </div>
              </div>
            )}
            
            <button 
              onClick={(e) => { e.stopPropagation(); onVisualSearch?.(activeImage); }}
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

function SearchEngineGuideModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [activeSubTab, setActiveSubTab] = useState<'chrome' | 'firefox' | 'safari'>('chrome');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-[10000] flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-[32px] w-full max-w-lg shadow-2xl border border-slate-100 overflow-hidden text-slate-800"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-blue-50 text-blue-600 rounded-xl">
              <Navigation size={18} className="rotate-45" />
            </span>
            <h3 className="font-display font-black text-lg text-slate-900">Set Scout as Default Search</h3>
          </div>
          <button onClick={onClose} className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-full text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Browser selection sub-tabs */}
        <div className="px-6 pt-4 flex gap-2 border-b border-slate-100">
          {(['chrome', 'firefox', 'safari'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveSubTab(tab)}
              className={`pb-3 px-2 text-sm font-bold capitalize border-b-2 transition-all ${
                activeSubTab === tab 
                  ? 'border-blue-600 text-blue-600' 
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab === 'safari' ? 'Safari / iOS' : tab}
            </button>
          ))}
        </div>

        {/* Content instructions list depending on active browser tab */}
        <div className="p-6">
          {activeSubTab === 'chrome' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">Chrome supports automatic search engine registration through OpenSearch. Follow these quick steps:</p>
              <ol className="space-y-3 text-sm text-slate-700 list-decimal pl-5 font-medium">
                <li>Perform any search using the search bar above at least once.</li>
                <li>Open Chrome Settings and search for <strong className="text-slate-900 font-bold">Search engine</strong> (or enter <code className="bg-slate-100 px-1 py-0.5 rounded text-xs">chrome://settings/search</code>).</li>
                <li>Click <strong className="text-slate-900 font-bold">Manage search engines and site search</strong>.</li>
                <li>Find <strong className="text-slate-900 font-bold">Scout</strong> under <strong className="text-slate-900 font-bold">Site search</strong> (or "Inactive search engines").</li>
                <li>Click the three dots next to Scout, select <strong className="text-blue-600 font-bold">Activate</strong>, and then click <strong className="text-blue-600 font-bold">Make default</strong>!</li>
              </ol>
            </div>
          )}

          {activeSubTab === 'firefox' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">Firefox makes it extremely simple to add search engines. Follow these steps:</p>
              <ol className="space-y-3 text-sm text-slate-700 list-decimal pl-5 font-medium">
                <li>Click the search settings icon (the magnifying glass with a green plus icon) in the address bar or search bar when on Scout.</li>
                <li>Select <strong className="text-slate-900 font-bold">Add "Scout Search"</strong>!</li>
                <li>Open Firefox Settings, navigate to the <strong className="text-slate-900 font-bold">Search</strong> panel, and choose <strong className="text-blue-600 font-bold">Scout Search</strong> as your Default Search Engine.</li>
              </ol>
            </div>
          )}

          {activeSubTab === 'safari' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">For iOS and macOS devices, you can add Scout directly to your Dock or Home Screen for a completely standalone default search experience:</p>
              <ol className="space-y-3 text-sm text-slate-700 list-decimal pl-5 font-medium">
                <li>Tap the <strong className="text-slate-900 font-bold">Share</strong> button (the box with an up arrow) in Safari.</li>
                <li>Scroll down and tap <strong className="text-blue-600 font-bold">Add to Home Screen</strong> (or <strong className="text-blue-600 font-bold">Add to Dock</strong> on macOS).</li>
                <li>Launch Scout directly from your home screen just like a native application with lightning-fast startups!</li>
              </ol>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full text-sm transition-colors cursor-pointer"
          >
            Got It!
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function AIConversationalInput({ onSearch, setQuery, onMicClick }: { onSearch: any; setQuery: any; onMicClick: any }) {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setQuery(text);
    onSearch(text);
    setText('');
  };

  const hasTyped = text.trim().length > 0;

  return (
    <form 
      onSubmit={handleSubmit} 
      className="relative max-w-2xl mx-auto flex items-center bg-white border border-slate-200 rounded-[28px] pl-5 pr-2 py-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.08)] focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.08)] transition-all duration-200"
    >
      <input
        type="text"
        placeholder="Ask a follow-up or a new question..."
        className="w-full bg-transparent border-none outline-none text-slate-800 text-[15.5px] px-1 py-1.5 focus:ring-0 leading-normal font-sans"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      
      <div className="flex items-center justify-center shrink-0 w-11 h-11 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {!hasTyped ? (
            <motion.button
              key="voice"
              initial={{ opacity: 0, scale: 0.8, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8, x: -20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              type="button"
              onClick={onMicClick}
              className="p-2.5 bg-slate-50 hover:bg-slate-100/90 text-slate-600 rounded-full active:scale-95 transition-all border-none bg-transparent cursor-pointer flex items-center justify-center"
              title="Search by voice"
            >
              <Mic size={19} className="text-slate-600" />
            </motion.button>
          ) : (
            <motion.button
              key="send"
              initial={{ opacity: 0, scale: 0.8, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8, x: -20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              type="submit"
              className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full hover:shadow-lg active:scale-95 border-none cursor-pointer flex items-center justify-center shadow-[0_2px_8px_rgba(37,99,235,0.3)] duration-150"
              title="Send legacy"
            >
              <ArrowUp size={19} className="stroke-[2.5]" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
}
