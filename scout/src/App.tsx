/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */ 
 
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Mic, Image as ImageIcon, Video, MapPin, Newspaper, X, LayoutGrid, User, Trophy, Menu, ArrowRight, ExternalLink, Sparkles, Loader2, LogOut, ChevronLeft, ChevronRight } from 'lucide-react';
import Markdown from 'react-markdown';
import { GoogleGenAI } from "@google/genai";
import { SearchResult, AIOverview } from './types';

// Initialize Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

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

  const searchInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

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

  // SEARCH SUGGESTIONS
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        const res = await fetch(`/api/suggestions?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setSuggestions(data.slice(0, 5));
      } catch (e) {
        setSuggestions([]);
      }
    };

    const timer = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timer);
  }, [query]);

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
    setFaq([]);
    setShowSuggestions(false);
    setError(null);
    setPage(requestedPage);

    try {
      const searchRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: finalQuery, page: requestedPage })
      });
      
      const data = await searchRes.json();
      
      if (!searchRes.ok) {
        throw new Error(data.error || 'Unknown search error');
      }

      const pineconeResults = data.results || [];
      setTotalPages(data.totalPages || 1);
      
      const rawResults: SearchResult[] = pineconeResults.map((r: any) => {
        const dom = r.displayUrl || 'unknown';
        const fallbackTitle = dom.split('.')[0].charAt(0).toUpperCase() + dom.split('.')[0].slice(1);
        return {
          id: r.id,
          title: (r.title && r.title.toLowerCase() !== 'untitled' && r.title.toLowerCase() !== 'untitled result') ? r.title : fallbackTitle,
          url: r.url || '#',
          displayUrl: dom,
          snippet: r.snippet || 'No description available.',
          sourceIcon: r.sourceIcon || '🌐',
          image: r.image || null
        };
      });

      // IMMEDIATE UPDATE FOR SPEED
      setResults(rawResults);
      setLoading(false);

      // PARALLEL EXECUTION FOR AI FEATURES
      if (requestedPage === 1) {
        generateAIOverview(finalQuery, rawResults);
        generateFAQ(finalQuery, rawResults);
      }
    } catch (error: any) {
      console.error("Search failed:", error);
      const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError';
      setError(isNetworkError ? "Connection established but server is busy downloading AI models. Please wait 10 seconds and try again." : (error.message || "Something went wrong."));
      setLoading(false);
    }
  };

  const generateAIOverview = async (queryText: string, contextResults: SearchResult[]) => {
    setAiLoading(true);
    setIsOverviewExpanded(false);

    if (!ai) {
      console.warn("AI Overview skipped: GEMINI_API_KEY is not configured.");
      setAiLoading(false);
      return;
    }

    try {
      const context = contextResults.slice(0, 5).map(r => r.snippet).join("\n");
      const prompt = `Query: "${queryText}"\nContext:\n${context}\nProvide a comprehensive, high-quality, professional overview of the search topic. Use rich Markdown formatting:
- Use bold Level 3 headers (###) for sections.
- Use bulleted lists for key facts.
- Use numbered lists for steps or chronological events.
- Use Markdown tables if comparing multiple data points or entities.
- Ensure the tone is informative and authoritative.`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
      });
      
      setAiOverview({
        summary: response.text || "No summary available.",
        sources: contextResults.slice(0, 3).map(r => ({ title: r.title, url: r.url }))
      });
    } catch (e) {} finally {
      setAiLoading(false);
    }
  };

  const generateFAQ = async (queryText: string, contextResults: SearchResult[]) => {
    if (!ai) return;

    try {
      const context = contextResults.slice(0, 5).map(r => r.snippet).join("\n");
      const prompt = `Query: "${queryText}"\nContext: ${context}\nGenerate 3 FAQs as JSON: [{"question": "...", "answer": "..."}]`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
      });
      
      const text = response.text?.replace(/```json/g, '').replace(/```/g, '').trim();
      setFaq(JSON.parse(text || '[]'));
    } catch (e) {}
  };

  const goHome = () => {
    setIsSearching(false);
    setQuery('');
    setResults([]);
    setAiOverview(null);
    setIsOverviewExpanded(false);
    setFaq([]);
  };

  useEffect(() => {
    if (!isSearching) searchInputRef.current?.focus();
  }, [isSearching]);

  return (
    <div className="min-h-screen bg-white font-sans selection:bg-blue-100 selection:text-blue-900">
      <AnimatePresence>
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
          <HomeView key="home" query={query} setQuery={setQuery} onSearch={handleSearch} suggestions={suggestions} showSuggestions={showSuggestions} setShowSuggestions={setShowSuggestions} inputRef={searchInputRef} user={user} onLogin={handleLogin} onLogout={handleLogout} onMicClick={toggleListening} />
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
            />
        )}
      </AnimatePresence>
    </div>
  );
}

function HomeView({ query, setQuery, onSearch, suggestions, showSuggestions, setShowSuggestions, inputRef, user, onLogin, onLogout, onMicClick }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }}
      className="relative min-h-screen flex flex-col items-center justify-center p-4 md:p-6 bg-slate-900"
    >
      <div className="absolute inset-0 z-0 opacity-60">
        <img src="https://picsum.photos/seed/scout-vibe/1920/1080?blur=1" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        <div className="absolute inset-0 bg-linear-to-b from-black/20 via-transparent to-black/80" />
      </div>

      <header className="absolute top-0 left-0 right-0 p-4 md:p-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-4 text-white font-display font-bold text-xl">
           <div className="grid grid-cols-2 gap-0.5 w-6 h-6">
              <div className="bg-[#4285F4]" /><div className="bg-[#34A853]" /><div className="bg-[#FBBC05]" /><div className="bg-[#EA4335]" />
           </div>
           Scout
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <img src={user.picture} className="w-9 h-9 rounded-full ring-2 ring-white/20" />
          ) : (
            <button onClick={onLogin} className="bg-white/10 hover:bg-white/20 px-5 py-2 rounded-full text-white text-sm font-bold border border-white/20 transition-all">Sign in</button>
          )}
          <Menu className="text-white cursor-pointer" size={24} />
        </div>
      </header>

      <div className="w-full max-w-2xl space-y-6 md:space-y-10 z-10 text-center">
        <motion.h1 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-3xl md:text-4xl font-display font-black text-white drop-shadow-xl tracking-tight"
        >
          Ask Anything.
        </motion.h1>

        <motion.form 
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          onSubmit={onSearch}
          className="relative group px-4 max-w-lg mx-auto w-full"
        >
          <div className={`flex items-center gap-3 px-5 h-10 md:h-12 rounded-[1.5rem] md:rounded-[2rem] transition-all bg-white/95 backdrop-blur-xl shadow-2xl ${showSuggestions && suggestions.length > 0 ? 'rounded-b-none' : ''}`}>
            <Search className="text-slate-400" size={20} />
            <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }} placeholder="Search or ask Scout..." className="flex-1 bg-transparent border-none outline-none text-slate-900 text-sm md:text-base placeholder:text-slate-400" />
            <div className="flex items-center gap-3">
              {query && <X size={18} className="text-slate-400 cursor-pointer" onClick={() => setQuery('')} />}
              <div className="w-px h-5 bg-slate-200 hidden sm:block" />
              <button onClick={onMicClick} type="button" className="p-2 hover:bg-slate-100 rounded-full text-blue-600"><Mic size={22} /></button>
            </div>
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-16 left-2 right-2 bg-white rounded-b-[2rem] shadow-2xl border-t border-slate-100 py-4 z-20 text-left">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => { setQuery(s); onSearch(s); }} className="w-full px-8 py-3 flex items-center gap-4 text-slate-700 hover:bg-slate-50 transition-colors">
                  <Search size={18} className="text-slate-300" /> <span className="font-medium truncate">{s}</span>
                </button>
              ))}
            </div>
          )}
        </motion.form>
      </div>
    </motion.div>
  );
}

function ResultsView({ query, setQuery, onSearch, loading, results, error, aiOverview, isOverviewExpanded, setIsOverviewExpanded, faq, openFaqIndex, setOpenFaqIndex, aiLoading, activeTab, setActiveTab, page, totalPages, goHome, user, onLogin, onLogout, onMicClick }: any) {
  // Helper to check if a URL is an image
  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url.split('?')[0]);

  // Group images by domain for the carousel
  const carouselImages = results.filter((res: any) => isImageUrl(res.url));

  // Determine results to display in the main list
  const filteredResults = activeTab === 'images' 
    ? results.filter((res: any) => isImageUrl(res.url) || res.image)
    : results.filter((res: any) => !isImageUrl(res.url));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-screen bg-white">
      <header className="bg-white border-b border-slate-100 sticky top-0 z-50">
        <div className="flex items-center gap-3 md:gap-10 p-3 md:p-5 md:px-12 max-w-[1700px] mx-auto">
          <div onClick={goHome} className="flex items-center gap-2 cursor-pointer shrink-0">
             <div className="grid grid-cols-2 gap-0.5 w-5 h-5">
                <div className="bg-[#4285F4]" /><div className="bg-[#34A853]" /><div className="bg-[#FBBC05]" /><div className="bg-[#EA4335]" />
             </div>
             <span className="font-display font-bold text-xl hidden sm:inline text-slate-900">Scout</span>
          </div>
          <div className="flex-1 max-w-2xl">
            <form onSubmit={onSearch} className="flex items-center gap-2 px-4 h-11 bg-slate-50 border border-slate-200 rounded-full focus-within:bg-white focus-within:shadow-md transition-all">
              <input value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 bg-transparent border-none outline-none text-slate-800 font-medium text-sm md:text-base min-w-0" />
              <div className="flex items-center gap-2">
                <Mic size={18} className="text-slate-400 hover:text-blue-500 cursor-pointer" onClick={onMicClick} />
                <div className="w-px h-4 bg-slate-200 mx-1" />
                <Search size={18} className="text-blue-500 cursor-pointer" onClick={() => onSearch()} />
              </div>
            </form>
          </div>
          <div className="flex-shrink-0">
            {user ? <img src={user.picture} className="w-9 h-9 rounded-full border border-slate-100" /> : <button onClick={onLogin} className="text-sm font-bold text-blue-600">Login</button>}
          </div>
        </div>
        <div className="px-3 md:px-12 max-w-[1700px] mx-auto border-t border-slate-50 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-8 pt-4">
            {['All', 'Images', 'News'].map(tab => (
              <button key={tab} className={`pb-3 text-sm font-bold border-b-2 transition-all ${activeTab === tab.toLowerCase() ? 'text-blue-600 border-blue-600' : 'text-slate-400 border-transparent hover:text-slate-700'}`} onClick={() => setActiveTab(tab.toLowerCase())}>{tab}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className={`grid grid-cols-1 ${activeTab === 'all' ? 'lg:grid-cols-[1fr_420px]' : ''} gap-6 md:gap-12 p-3 md:p-10 md:px-12 max-w-[1700px] mx-auto`}>
          <div className="space-y-6 order-2 lg:order-1 flex flex-col">
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
                  {filteredResults.map((res: any, idx: number) => (
                    <React.Fragment key={res.id}>
                      {/* Insert FAQ accordion after 3rd result if in 'All' tab */}
                      {idx === 3 && faq.length > 0 && (
                        <div className="py-6 border-y border-slate-100 animate-in fade-in duration-500">
                          <h4 className="font-display font-bold text-slate-800 text-xl mb-4">People also ask</h4>
                          <div className="divide-y divide-slate-100">
                            {faq.map((item: any, i: number) => (
                              <div key={i} className="py-4">
                                <button 
                                  onClick={() => openFaqIndex === i ? setOpenFaqIndex(null) : setOpenFaqIndex(i)}
                                  className="w-full flex items-center justify-between text-left group"
                                >
                                  <span className="text-base md:text-lg font-normal text-slate-800 group-hover:text-blue-600 transition-colors">
                                    {item.question}
                                  </span>
                                  <ChevronRight 
                                    size={18} 
                                    className={`text-slate-400 transition-transform duration-300 ${openFaqIndex === i ? 'rotate-90' : ''}`} 
                                  />
                                </button>
                                <AnimatePresence>
                                  {openFaqIndex === i && (
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
                      )}
                      
                      <article className="group py-4 transition-all border-b border-slate-50 last:border-0 pl-0">
                        <div className="flex flex-col sm:flex-row gap-6">
                          <div className="flex-1 min-w-0">
                            {/* Breadcrumb Header */}
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 border border-slate-100 bg-slate-50 flex items-center justify-center">
                                <img 
                                  src={res.sourceIcon} 
                                  className="w-5 h-5 object-contain" 
                                  referrerPolicy="no-referrer" 
                                  onError={(e:any) => e.target.src='🌐'} 
                                />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[13px] text-slate-800 font-normal leading-tight">{res.fallbackTitle || res.displayUrl.split('.')[0].charAt(0).toUpperCase() + res.displayUrl.split('.')[0].slice(1)}</span>
                                <span className="text-[12px] text-slate-500 truncate leading-tight">{res.url.replace(/^https?:\/\//, '')}</span>
                              </div>
                            </div>

                            {/* Title with hover effect */}
                            <div className="relative group/title inline-block">
                              <a href={res.url} target="_blank" rel="noreferrer" className="block mb-2 translate-x-[-1px]">
                                <div className="flex items-center gap-3">
                                  <h3 className="text-xl md:text-2xl font-display font-normal text-[#1a0dab] group-hover:underline leading-tight line-clamp-1">
                                    {res.title}
                                  </h3>
                                  <ExternalLink size={20} className="text-[#1a0dab] opacity-0 group-hover/title:opacity-100 transition-opacity" />
                                </div>
                              </a>
                            </div>

                            <p className="text-slate-600 text-[15px] leading-relaxed line-clamp-2 md:line-clamp-3 mb-4">
                              {res.snippet}
                            </p>

                            {/* Horizontal Image Carousel for results with many images */}
                            {carouselImages.filter((img: any) => img.displayUrl === res.displayUrl).length > 0 && (
                              <div className="flex gap-3 overflow-x-auto scrollbar-hide py-2">
                                {carouselImages.filter((img: any) => img.displayUrl === res.displayUrl).slice(0, 5).map((img: any) => (
                                  <div key={img.id} className="shrink-0 w-32 h-20 bg-slate-50 rounded-lg overflow-hidden border border-slate-100">
                                    <img src={img.url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          {res.image && !isImageUrl(res.url) && (
                            <div className="shrink-0 w-full sm:w-36 h-40 sm:h-24 rounded-xl overflow-hidden border border-slate-100 shadow-sm transition-transform group-hover:scale-[1.02]">
                              <img src={res.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            </div>
                          )}
                        </div>
                      </article>
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

          {activeTab === 'all' && (
            <aside className="order-1 lg:order-2 space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-[2rem] p-8 shadow-xs animate-in slide-in-from-right-4 duration-500 sticky top-36">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3 font-display font-bold text-slate-900 text-lg">
                    <Sparkles size={22} className="text-purple-600" />
                    <span>AI Overview</span>
                  </div>
                </div>
                
                {aiLoading ? (
                  <div className="space-y-6 animate-pulse">
                    <div className="h-5 bg-slate-200 rounded w-full"/>
                    <div className="h-5 bg-slate-200 rounded w-5/6"/>
                    <div className="h-5 bg-slate-200 rounded w-4/6"/>
                  </div>
                ) : aiOverview ? (
                  <div className="space-y-8">
                    <div className={`text-slate-800 text-lg md:text-xl font-normal leading-relaxed prose prose-lg prose-slate max-w-none prose-p:my-6 prose-ul:my-6 prose-ol:my-6 prose-li:my-3 prose-headings:font-bold prose-headings:text-slate-900 ${!isOverviewExpanded ? 'line-clamp-[12]' : ''}`}>
                      <Markdown>{aiOverview.summary}</Markdown>
                    </div>
                    {aiOverview.summary.length > 400 && (
                      <button 
                        onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
                        className="text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-full shadow-sm transition-all active:scale-95"
                      >
                        {isOverviewExpanded ? 'Show less' : 'Show more'}
                        <ChevronRight size={16} className={isOverviewExpanded ? '-rotate-90' : 'rotate-90'} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                     <motion.div 
                       animate={{ x: ['-100%', '100%'] }}
                       transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                       className="w-1/2 h-full bg-linear-to-r from-transparent via-purple-500 to-transparent" 
                     />
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </main>
    </motion.div>
  );
}
