/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Mic, Image as ImageIcon, Video, MapPin, Newspaper, X, LayoutGrid, User, Trophy, Menu, ArrowRight, ExternalLink, Sparkles, Loader2, LogOut, ChevronLeft, ChevronRight } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, arrayUnion } from "firebase/firestore";
import firebaseConfig from '../firebase-applet-config.json';
import { SearchResult, AIOverview, KnowledgePanel } from './types';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export default function App() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiOverview, setAiOverview] = useState<AIOverview | null>(null);
  const [isOverviewExpanded, setIsOverviewExpanded] = useState(false);
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
  const [correction, setCorrection] = useState<string | null>(null);
  const [originalQuery, setOriginalQuery] = useState<string | null>(null);
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [clickedUrls, setClickedUrls] = useState<string[]>([]);
  const [isSignoutOpen, setIsSignoutOpen] = useState(false);
  const [knowledgePanel, setKnowledgePanel] = useState<KnowledgePanel | null>(null);
  const [isAppsOpen, setIsAppsOpen] = useState(false);
  const [isEnglishHelp, setIsEnglishHelp] = useState(false);
  const appsRef = useRef<HTMLDivElement>(null);

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
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    fetch('/api/me')
      .then(res => res.json())
      .then(data => setUser(data.user))
      .catch(console.error);

    const handleOAuthSuccess = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) return;
      
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetch('/api/me')
          .then(res => res.json())
          .then(data => setUser(data.user))
          .catch(console.error);
      }
    };

    window.addEventListener('message', handleOAuthSuccess);
    return () => window.removeEventListener('message', handleOAuthSuccess);
  }, []);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const { url } = await res.json();
      const width = 600, height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(url, 'google_login', `width=${width},height=${height},left=${left},top=${top}`);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    setUser(null);
  };

  const handleSearch = async (e?: React.FormEvent | string, requestedPage = 1) => {
    if (e && typeof e !== 'string') e.preventDefault();
    const finalQuery = typeof e === 'string' ? e : query;
    if (!finalQuery.trim()) return;

    setLoading(true);
    setIsSearching(true);
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

    // Save query to history if logged in
    if (user?.sub && requestedPage === 1) {
      setDoc(doc(db, "users", user.sub), {
        queries: arrayUnion(finalQuery),
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch(console.error);
    }

    try {
      const searchRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: finalQuery, 
          page: requestedPage,
          type: activeTab,
          clickedUrls 
        })
      });
      
      const data = await searchRes.json();
      
      if (!searchRes.ok) {
        throw new Error(data.error || 'Unknown search error');
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
      
      const rawResults: SearchResult[] = pineconeResults.map((r: any) => {
        const url = r.url || '#';
        const hostname = r.displayUrl || 'unknown';
        const parts = hostname.split('.');
        const domainName = parts[0] === 'www' ? parts[1] || parts[0] : parts[0];
        const fallbackTitle = domainName.charAt(0).toUpperCase() + domainName.slice(1);
        
        return {
          id: r.id,
          title: (r.title && !/^untitled/i.test(r.title)) ? r.title : fallbackTitle,
          url,
          displayUrl: hostname,
          snippet: r.snippet || 'No description available.',
          sourceIcon: r.sourceIcon || '🌐',
          image: r.image || r.thumbnail || r.ogImage || r.imageUrl || null
        };
      });

      // IMMEDIATE UPDATE FOR SPEED
      setResults(rawResults);
      setLoading(false);

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
      const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError';
      setError(isNetworkError ? "Connection established but server is busy downloading AI models. Please wait 10 seconds and try again." : (error.message || "Something went wrong."));
      setLoading(false);
    }
  };

  const generateAIOverview = async (queryText: string, contextResults: SearchResult[], linguisticHelp = false) => {
    setAiLoading(true);
    setIsOverviewExpanded(false);
    try {
      const context = contextResults.slice(0, 5).map(r => r.snippet).join("\n");
      const res = await fetch('/api/ai/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryText, context, isLinguisticHelp: linguisticHelp })
      });
      const data = await res.json();
      
      setAiOverview({
        summary: data.text || "No summary available.",
        sources: contextResults.slice(0, 3).map(r => ({ title: r.title, url: r.url }))
      });
    } catch (e) {} finally {
      setAiLoading(false);
    }
  };

  const generateFAQ = async (queryText: string, contextResults: SearchResult[]) => {
    try {
      const context = contextResults.slice(0, 10).map(r => r.snippet).join("\n");
      const res = await fetch('/api/ai/faq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryText, context })
      });
      const data = await res.json();
      setFaq(data);
    } catch (e) {}
  };

  const generateKnowledgePanel = async (entityName: string, entityType?: string) => {
    try {
      const res = await fetch('/api/ai/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityName, entityType })
      });
      const data = await res.json();
      if (data) setKnowledgePanel(data);
    } catch (e) {}
  };

  const handleResultClick = (url: string) => {
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
          <HomeView key="home" query={query} setQuery={setQuery} onSearch={handleSearch} suggestions={suggestions} showSuggestions={showSuggestions} setShowSuggestions={setShowSuggestions} inputRef={searchInputRef} searchContainerRef={searchContainerRef} user={user} onLogin={handleLogin} onLogout={handleLogout} onMicClick={toggleListening} bg={homeBg} isSignoutOpen={isSignoutOpen} setIsSignoutOpen={setIsSignoutOpen} appsRef={appsRef} isAppsOpen={isAppsOpen} setIsAppsOpen={setIsAppsOpen} />
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
            />
        )}
      </AnimatePresence>
    </div>
  );
}

function HomeView({ query, setQuery, onSearch, suggestions, showSuggestions, setShowSuggestions, inputRef, searchContainerRef, user, onLogin, onLogout, onMicClick, bg, isSignoutOpen, setIsSignoutOpen, appsRef, isAppsOpen, setIsAppsOpen }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}
      className="relative min-h-screen flex flex-col items-center justify-center p-4 md:p-6 bg-slate-900"
    >
      <div className="absolute inset-0 z-0 opacity-60">
        <img src={bg || "https://picsum.photos/seed/scout-vibe/1920/1080?blur=1"} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        <div className="absolute inset-0 bg-linear-to-b from-black/20 via-transparent to-black/80" />
      </div>

      <header className="absolute top-0 left-0 right-0 p-6 md:p-10 flex items-center justify-between z-50">
        <div className="flex items-center gap-4">
           <span className="font-display font-black text-2xl tracking-tighter bg-clip-text text-transparent bg-linear-to-t from-[#9333ea] to-white drop-shadow-lg">Scout</span>
        </div>
        <div className="flex items-center gap-4">
          <UserProfile user={user} onLogin={onLogin} onLogout={onLogout} isSignoutOpen={isSignoutOpen} setIsSignoutOpen={setIsSignoutOpen} isHome={true} />
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
          className="text-3xl md:text-4xl font-display font-black text-white drop-shadow-xl tracking-tight"
        >
          <motion.h1 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-4xl md:text-6xl font-display font-black text-white drop-shadow-2xl tracking-tighter"
          >
            Ask Anything.
          </motion.h1>
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
            <input 
              ref={inputRef} 
              value={query} 
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }} 
              placeholder="Ask Scout anything..." 
              className="flex-1 bg-transparent border-none outline-none text-slate-900 text-base md:text-lg placeholder:text-slate-400" 
            />
            <div className="flex items-center gap-3">
              {query && <X size={18} className="text-slate-400 cursor-pointer" onClick={() => setQuery('')} />}
              <div className="w-px h-5 bg-slate-200 hidden sm:block" />
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
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => { setQuery(s); onSearch(s); setShowSuggestions(false); }} className="w-full px-8 py-3 flex items-center gap-4 text-slate-700 hover:bg-slate-50 transition-colors">
                    <Search size={18} className="text-slate-300" /> <span className="font-medium truncate">{s}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.div>
  );
}

function ResultsView({ query, setQuery, onSearch, loading, results, error, aiOverview, dictionary, knowledgePanel, isEnglishHelp, isOverviewExpanded, setIsOverviewExpanded, faq, openFaqIndex, setOpenFaqIndex, aiLoading, activeTab, setActiveTab, page, totalPages, goHome, user, onLogin, onLogout, onMicClick, suggestions, showSuggestions, setShowSuggestions, searchContainerRef, onResultClick, clickedUrls, isSignoutOpen, setIsSignoutOpen, appsRef, isAppsOpen, setIsAppsOpen, correction, originalQuery }: any) {
  // Helper to check if a URL is an image
  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url.split('?')[0]);

  // Group images by domain for the carousel
  const carouselImages = results.filter((res: any) => isImageUrl(res.url));

  const filteredResults = activeTab === 'images' 
    ? results.filter((res: any) => isImageUrl(res.url) || res.image)
    : results.filter((res: any) => !isImageUrl(res.url));

  // Group results by domain (simple grouping)
  const groupedResults: any[] = [];
  const processedDomains = new Set();
  
  if (activeTab === 'all') {
    filteredResults.forEach((res: any, idx: number) => {
      // Normalize domain for reliable grouping (remove www. and lowercase)
      const groupKey = res.displayUrl.toLowerCase().replace(/^www\./, '');
      
      // Check if this domain has multiple entries in the results
      const domainMatches = filteredResults.filter(r => 
        r.displayUrl.toLowerCase().replace(/^www\./, '') === groupKey
      );
      
      if (domainMatches.length > 1 && !processedDomains.has(groupKey)) {
        // Create a group with a primary and secondary results
        groupedResults.push({
          type: 'group',
          primary: domainMatches[0],
          secondaries: domainMatches.slice(1).slice(0, 4) // Show up to 4 rich sitelinks
        });
        processedDomains.add(groupKey);
      } else if (!processedDomains.has(groupKey)) {
        groupedResults.push({ type: 'single', result: res });
      }
    });
  } else {
    // For other tabs, don't group or use simple list
    filteredResults.forEach(res => groupedResults.push({ type: 'single', result: res }));
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-screen bg-white">
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
              <input value={query} onFocus={() => setShowSuggestions(true)} onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }} className="flex-1 bg-transparent border-none outline-none text-slate-800 font-medium text-sm md:text-base min-w-0" />
              <div className="flex items-center gap-3">
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
              <UserProfile user={user} onLogin={onLogin} onLogout={onLogout} isSignoutOpen={isSignoutOpen} setIsSignoutOpen={setIsSignoutOpen} />
            </div>
          </div>
        </div>
        <div className="px-4 md:px-8 lg:px-24 xl:px-[170px] max-w-[1700px] border-t border-slate-50 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-8 pt-4">
            {['All', 'Images', 'News'].map(tab => (
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
                    <div className={`text-slate-800 text-[16px] md:text-[17px] font-normal leading-relaxed prose prose-slate prose-p:my-5 prose-headings:font-black prose-headings:text-slate-900 prose-li:my-2 prose-table:border prose-table:border-slate-200 prose-th:bg-slate-100 prose-th:p-3 prose-td:p-3 prose-td:border prose-td:border-slate-100 transition-all duration-500 overflow-hidden ${!isOverviewExpanded ? 'max-h-[300px]' : 'max-h-none'}`} 
                         style={{ maskImage: !isOverviewExpanded ? 'linear-gradient(to bottom, black 80%, transparent 100%)' : 'none', WebkitMaskImage: !isOverviewExpanded ? 'linear-gradient(to bottom, black 80%, transparent 100%)' : 'none' }}>
                      <Markdown remarkPlugins={[remarkGfm]}>{aiOverview.summary}</Markdown>
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
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-6 duration-700">
                  {filteredResults.map((res: any) => (
                    <a key={res.id} href={res.url} target="_blank" rel="noreferrer" className="group relative aspect-square bg-slate-100 rounded-2xl overflow-hidden hover:shadow-xl transition-all border border-slate-200">
                      <img src={isImageUrl(res.url) ? res.url : res.image} className="w-full h-full object-cover transition-transform group-hover:scale-105" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                        <span className="text-white text-xs font-medium truncate">{res.title}</span>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="space-y-8 md:space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
                  {groupedResults.map((item: any, idx: number) => (
                    <React.Fragment key={item.type === 'single' ? item.result.id : item.primary.id}>
                      {/* Image Strip after 1st result */}
                      {idx === 1 && (
                        <ImageStrip results={results} onMore={() => setActiveTab('images')} />
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
                        <ResultCard res={item.result} carouselImages={carouselImages} isImageUrl={isImageUrl} onResultClick={onResultClick} clickedUrls={clickedUrls} />
                      ) : (
                        <div className="space-y-4 py-4 mb-8">
                          <ResultCard res={item.primary} carouselImages={carouselImages} isImageUrl={isImageUrl} onResultClick={onResultClick} clickedUrls={clickedUrls} />
                          <div className="ml-4 sm:ml-12 flex flex-col -mt-4">
                            <div className="border-t border-slate-100 mt-2 mb-4" />
                            <div className="space-y-0">
                              {item.secondaries.map((s: any, sIdx: number) => (
                                <div key={s.id} className="group/sub">
                                  <a 
                                    onClick={() => onResultClick?.(s.url)} 
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
                            <a href={`https://${item.primary.displayUrl}`} className="text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center gap-2 mt-4 px-3 py-1.5 hover:bg-slate-50 w-fit rounded-lg transition-all border border-transparent hover:border-slate-100">
                              More results from {item.primary.displayUrl.replace('www.', '')} <ArrowRight size={14} />
                            </a>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )
            ) : <div className="py-20 text-center text-slate-400 font-medium italic">No results found for your query.</div>}

            {totalPages > 1 && !loading && (
              <div className="flex items-center justify-center gap-3 py-12 border-t border-slate-100">
                <button onClick={() => onSearch(undefined, Math.max(1, page - 1))} disabled={page===1} className="p-3 rounded-2xl hover:bg-white border border-transparent hover:border-slate-200 disabled:opacity-20 transition-all font-bold text-sm">Prev</button>
                <div className="flex gap-2">
                  {[...Array(Math.min(5, totalPages))].map((_, i) => (
                    <button key={i} onClick={() => onSearch(undefined, i+1)} className={`w-11 h-11 rounded-2xl font-bold transition-all ${page===i+1 ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-white text-slate-600 border border-transparent hover:border-slate-200'}`}>{i+1}</button>
                  ))}
                </div>
                <button onClick={() => onSearch(undefined, Math.min(totalPages, page + 1))} disabled={page===totalPages} className="p-3 rounded-2xl hover:bg-white border border-transparent hover:border-slate-200 disabled:opacity-20 transition-all font-bold text-sm">Next</button>
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
      try {
        const resp = await axios.post('/api/ai/summarize', { text, max_tokens: 45 });
        if (isMounted) setSummary(resp.data.summary);
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

function ImageStrip({ results, onMore }: { results: SearchResult[], onMore: () => void }) {
  const imagesWithMeta = results.filter(r => r.image).slice(0, 8);
  if (imagesWithMeta.length < 3) return null;

  return (
    <div className="py-8 border-b border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between mb-5 px-1">
        <h2 className="text-2xl font-display font-medium text-slate-900">Images</h2>
        <button 
          onClick={onMore} 
          className="text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-full text-[13px] font-bold flex items-center gap-1 transition-all active:scale-95"
        >
          More images <ChevronRight size={16} />
        </button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4">
        {imagesWithMeta.map((img) => (
          <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="shrink-0 w-44 sm:w-52 group">
            <div className="aspect-square rounded-3xl overflow-hidden bg-slate-100 border border-slate-100 transition-all group-hover:shadow-xl group-hover:-translate-y-1">
              <img src={img.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <div className="mt-3 text-[13px] font-medium text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors">{img.title}</div>
            <div className="mt-1 text-[11px] text-slate-500 line-clamp-1 flex items-center gap-1.5 opacity-80 uppercase tracking-wider font-bold">
              <img src={img.sourceIcon || `https://www.google.com/s2/favicons?domain=${img.displayUrl}&sz=32`} className="w-3.5 h-3.5 rounded-full" referrerPolicy="no-referrer" />
              {img.displayUrl.split('.')[0]}
            </div>
          </a>
        ))}
      </div>
      <div className="mt-2 flex justify-center">
         <button onClick={onMore} className="w-full py-3 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-2xl text-[13px] font-bold flex items-center justify-center gap-2 transition-all">
           Show more images <ChevronRight size={14} className="rotate-90" />
         </button>
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

function UserProfile({ user, onLogin, onLogout, isSignoutOpen, setIsSignoutOpen, isHome }: any) {
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

function ResultCard({ res, carouselImages, isImageUrl, onResultClick, clickedUrls }: any) {
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
          <div className="flex items-center gap-3 mb-2 overflow-hidden">
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

          <div className="relative group/title inline-block">
            <a onClick={() => onResultClick?.(res.url)} href={res.url} target="_blank" rel="noreferrer" className="block mb-2">
              <h3 className="text-xl md:text-2xl font-display font-medium text-[#1a0dab] group-hover:underline leading-tight line-clamp-2">
                {res.title}
              </h3>
            </a>
          </div>

          <p className="text-slate-600 text-[15px] leading-relaxed line-clamp-2 mb-4">
            {res.snippet}
          </p>

          {/* Site Summary for specific sources */}
          {(res.displayUrl.includes('wikipedia.org') || res.isNews || res.displayUrl.includes('medium.com') || res.displayUrl.includes('nytimes.com') || res.displayUrl.includes('bbc.com') || res.displayUrl.includes('theguardian.com')) && (
             <QuickSummary text={res.snippet} />
          )}

          {/* Inline miniature strip */}
          {domainImages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide py-2">
              {domainImages.slice(0, 8).map((img: any, i: number) => (
                <button 
                  key={img.id} 
                  onClick={() => setCurrentImgIndex(i)}
                  className={`shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-all ${currentImgIndex === i ? 'border-blue-500 scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}
                >
                  <img src={img.url || img.image} title={img.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Main Side Image / Carousel */}
        {(res.image || domainImages.length > 0) && (
          <div className="shrink-0 w-36 h-36 md:w-48 md:h-48 rounded-2xl overflow-hidden border border-slate-100 shadow-sm relative group/carousel mt-4 sm:mt-8 bg-slate-50">
            <AnimatePresence mode="wait">
              <motion.img 
                key={domainImages[currentImgIndex]?.id || 'main-img'}
                src={domainImages.length > 0 ? (domainImages[currentImgIndex].url || domainImages[currentImgIndex].image) : res.image} 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full h-full object-cover" 
                referrerPolicy="no-referrer" 
              />
            </AnimatePresence>
            
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
