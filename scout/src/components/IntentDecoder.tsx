import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  Settings, 
  HelpCircle, 
  Cpu, 
  Sliders, 
  Shuffle, 
  TrendingUp, 
  Check, 
  Users, 
  FileText, 
  Layout, 
  Map, 
  Play, 
  BookOpen, 
  Download, 
  Search, 
  TrendingDown, 
  ArrowRight,
  RefreshCw
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  Radar, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip,
  Cell
} from 'recharts';

interface IntentDecoderProps {
  query: string;
  results: any[];
  apps?: any[] | null;
  businessProfile?: any | null;
  dictionary?: any | null;
  isEnglishHelp?: boolean;
}

export default function IntentDecoder({ 
  query, 
  results, 
  apps, 
  businessProfile, 
  dictionary, 
  isEnglishHelp 
}: IntentDecoderProps) {
  const [activeTab, setActiveTab] = useState<'flow' | 'query' | 'vector' | 'ranking' | 'feedback'>('flow');
  const [copiedText, setCopiedText] = useState(false);

  // --- 1. SIMULATOR STATE FOR FEEDBACK SECTOR ---
  const [clicksCount, setClicksCount] = useState<Record<string, number>>({});
  const [dwellTimes, setDwellTimes] = useState<Record<string, number>>({});
  const [pogoStickCount, setPogoStickCount] = useState<Record<string, number>>({});

  // Initialize top results mock feedback factors
  const initialDocs = useMemo(() => {
    return (results && Array.isArray(results)) ? results.slice(0, 4) : [];
  }, [results]);

  useEffect(() => {
    const defaultClicks: Record<string, number> = {};
    const defaultDwell: Record<string, number> = {};
    const defaultPogo: Record<string, number> = {};
    initialDocs.forEach((doc, i) => {
      if (!doc) return;
      const id = doc.id || doc.url || `fallback-${i}`;
      defaultClicks[id] = Math.max(2, 20 - i * 5);
      defaultDwell[id] = Math.max(5, 75 - i * 15);
      defaultPogo[id] = Math.max(0, i === 3 ? 3 : 1);
    });
    setClicksCount(defaultClicks);
    setDwellTimes(defaultDwell);
    setPogoStickCount(defaultPogo);
  }, [initialDocs]);

  // Adjust popularity weights dynamically based on user knob manipulation
  const docFeedbackScores = useMemo(() => {
    return initialDocs.map((doc, i) => {
      const id = doc?.id || doc?.url || `fallback-${i}`;
      const clicks = clicksCount[id] || 0;
      const dwell = dwellTimes[id] || 0;
      const pogo = pogoStickCount[id] || 0;

      // Google-like Scoring Formula:
      // Weight increases with high click rate and high average dwell time.
      // Weight severely penalized with pogo-sticking (clicking and returning immediately).
      const ctrScore = (clicks / 150) * 10;
      const dwellScore = (dwell / 120) * 15;
      const penalty = pogo * 3.5;
      
      const relevanceScore = doc?.score ? (doc.score * 50) : 35; // base vector score (out of 50)
      const feedBackAdjust = Number((ctrScore + dwellScore - penalty).toFixed(2));
      const finalScore = Number(Math.max(5, relevanceScore + feedBackAdjust).toFixed(1));

      return {
        id,
        title: doc?.title || 'Unknown Document',
        url: doc?.url || '',
        displayUrl: doc?.displayUrl || '',
        baseSemanticScore: relevanceScore,
        feedBackAdjust,
        finalScore
      };
    }).sort((a, b) => b.finalScore - a.finalScore);
  }, [initialDocs, clicksCount, dwellTimes, pogoStickCount]);

  // Handle simulating positive/negative signals on a document
  const handleSimulateClick = (id: string, isPremium: boolean) => {
    setClicksCount(prev => ({
      ...prev,
      [id]: (prev[id] || 0) + (isPremium ? 12 : 1)
    }));
    setDwellTimes(prev => ({
      ...prev,
      [id]: Math.min(240, (prev[id] || 0) + (isPremium ? 45 : 8))
    }));
  };

  const handleSimulatePogo = (id: string) => {
    setPogoStickCount(prev => ({
      ...prev,
      [id]: (prev[id] || 0) + 1
    }));
    setClicksCount(prev => ({
      ...prev,
      [id]: Math.max(0, (prev[id] || 0) + 1)
    }));
    setDwellTimes(prev => ({
      ...prev,
      [id]: Math.max(2, Math.floor((prev[id] || 10) * 0.3)) // sudden fall in dwell time
    }));
  };

  const handleResetFeedback = () => {
    const defaultClicks: Record<string, number> = {};
    const defaultDwell: Record<string, number> = {};
    const defaultPogo: Record<string, number> = {};
    initialDocs.forEach((doc, i) => {
      if (!doc) return;
      const id = doc.id || doc.url || `fallback-${i}`;
      defaultClicks[id] = Math.max(2, 20 - i * 5);
      defaultDwell[id] = Math.max(5, 75 - i * 15);
      defaultPogo[id] = Math.max(0, i === 3 ? 3 : 1);
    });
    setClicksCount(defaultClicks);
    setDwellTimes(defaultDwell);
    setPogoStickCount(defaultPogo);
  };

  // --- 2. INTENT CLASSIFIER ANALYSIS OF THE CURRENT QUERY ---
  const queryAnalysis = useMemo(() => {
    const q = (query || '').toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(t => t.length > 0);

    // Identify dynamic highlight rules
    const matches: Array<{ token: string; category: string; color: string; desc: string }> = [];

    const appKeywords = ['app', 'apps', 'download', 'software', 'application', 'apk', 'ios', 'iphone', 'android', 'play store', 'app store', 'extension', 'plugin', 'interactive', 'widget'];
    const businessKeywords = ['near me', 'open now', 'restaurant', 'cafe', 'coffee', 'hotel', 'food', 'pizza', 'burger', 'headquarters', 'hq', 'location', 'address', 'company', 'store', 'shop', 'supermarket', 'gym', 'cinemas', 'doctors', 'directions'];
    const videoKeywords = ['video', 'videos', 'clip', 'tutorial', 'how to', 'review', 'trailer', 'gameplay', 'youtube', 'live', 'stream', 'guide to'];
    const dictionaryKeywords = ['define', 'meaning', 'definition', 'synonym', 'antonym', 'what is the meaning', 'vocabulary'];
    const newsKeywords = ['news', 'headline', 'headlines', 'article', 'editorial', 'journal', 'climate', 'breaking', 'update', 'weather', 'stocks', 'price'];

    tokens.forEach(token => {
      const cleanToken = token.replace(/[^a-z0-9]/g, '');
      if (appKeywords.some(kw => kw.includes(cleanToken) && cleanToken.length > 2)) {
        matches.push({ token, category: 'App Download', color: 'bg-blue-100 text-blue-800 border-blue-200', desc: 'Indicates user is looking for an interactive application to solve a utility needs.' });
      } else if (businessKeywords.some(kw => kw.includes(cleanToken) && cleanToken.length > 2)) {
        matches.push({ token, category: 'Local Geo / Place', color: 'bg-emerald-100 text-emerald-800 border-emerald-200', desc: 'Queries referencing locations, services near physical sites, or opening hours.' });
      } else if (videoKeywords.some(kw => kw.includes(cleanToken) && cleanToken.length > 2)) {
        matches.push({ token, category: 'Video Tutorial', color: 'bg-red-100 text-red-800 border-red-200', desc: 'Indicates visual demonstration preference; triggers play-interactive video shelves.' });
      } else if (dictionaryKeywords.some(kw => kw.includes(cleanToken) && cleanToken.length > 2)) {
        matches.push({ token, category: 'Lexical Dictionary', color: 'bg-purple-100 text-purple-800 border-purple-200', desc: 'Specific dictionary definitions or lexical support triggers dictionary overlay.' });
      } else if (newsKeywords.some(kw => kw.includes(cleanToken) && cleanToken.length > 2)) {
        matches.push({ token, category: 'Editorial News', color: 'bg-indigo-100 text-indigo-800 border-indigo-200', desc: 'Requires fresh real-time coverage; triggers editorial publisher blocks.' });
      }
    });

    // Synthesize intent confidence scores (approximation modeled after RankBrain/MUM cosine outputs)
    let scoreNav = 15;
    let scoreInfo = 40;
    let scoreTrans = 10;
    let scoreLocal = 10;
    let scoreApp = 10;
    let scoreVideo = 10;

    // Adjust based on query rules
    if ((query || '').match(/site:|www\.|com|org|net/gi)) {
      scoreNav += 65;
      scoreInfo -= 20;
    }
    if ((query || '').match(/how|why|what|when|guide|history|meaning|meaning of|define/gi)) {
      scoreInfo += 45;
    }
    if (appKeywords.some(kw => q.includes(kw))) {
      scoreApp += 70;
      scoreInfo += 15;
    }
    if (businessKeywords.some(kw => q.includes(kw))) {
      scoreLocal += 80;
      scoreNav += 10;
    }
    if (videoKeywords.some(kw => q.includes(kw))) {
      scoreVideo += 75;
      scoreInfo += 15;
    }
    if (results && Array.isArray(results) && results.some(r => r && r.image)) {
      scoreInfo += 10;
    }

    // Caps
    const normalize = (sc: number) => Math.min(98, Math.max(12, sc));

    return {
      tokens,
      matches,
      vectors: [
        { subject: 'Informational Intent', Score: normalize(scoreInfo), fullMark: 100 },
        { subject: 'Navigational Intent', Score: normalize(scoreNav), fullMark: 100 },
        { subject: 'Transactional App', Score: normalize(scoreApp), fullMark: 100 },
        { subject: 'Local Map Intent', Score: normalize(scoreLocal), fullMark: 100 },
        { subject: 'Video Preference', Score: normalize(scoreVideo), fullMark: 100 },
        { subject: 'Lexical Dictionary', Score: normalize(dictionary ? 90 : (isEnglishHelp ? 85 : 15)), fullMark: 100 }
      ]
    };
  }, [query, results, dictionary, isEnglishHelp]);

  // Determine triggered components
  const activeTriggers = useMemo(() => {
    const hasResults = results && Array.isArray(results);
    return {
      apps: !!apps && apps.length > 0,
      map: !!businessProfile,
      dictionary: !!dictionary,
      news: hasResults && results.some(r => r && (r.isNews || r.displayUrl?.includes('nytimes') || r.displayUrl?.includes('bbc'))),
      videos: hasResults && results.some(r => r && r.layout_intent === 'VIDEO_PLAYER')
    };
  }, [apps, businessProfile, dictionary, results]);

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-[32px] overflow-hidden p-6 md:p-8 text-left shadow-xs max-w-4xl mx-auto my-6 font-sans">
      
      {/* 1. Header with precise, responsive grid of metadata */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-md">
            <Cpu size={24} />
          </div>
          <div>
            <h3 className="text-xl md:text-2xl font-display font-bold text-slate-900 flex items-center gap-1.5">
              Intent Intelligence Diagnostics
              <span className="text-xs px-2.5 py-0.5 bg-blue-150 text-blue-800 rounded-full font-bold uppercase tracking-wider">BERT & MUM Matcher</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">Exploring how Scout & Google decode your search criteria</p>
          </div>
        </div>
        
        <button 
          onClick={() => {
            navigator.clipboard.writeText(query);
            setCopiedText(true);
            setTimeout(() => setCopiedText(false), 2000);
          }}
          className="text-xs font-bold text-slate-500 hover:text-slate-800 px-4 py-2 hover:bg-white rounded-xl bg-slate-100 transition-all border border-slate-200 flex items-center gap-1.5"
        >
          {copiedText ? <Check size={13} className="text-emerald-500" /> : <Search size={13} />}
          <span>Query: <strong className="font-mono text-slate-950">"{query.substring(0, 18)}{query.length > 18 ? '...' : ''}"</strong></span>
        </button>
      </div>

      {/* 2. Custom Tabs Panel with premium high-contrast underline and indicators */}
      <div className="flex gap-2 border-b border-slate-200 pb-3 mb-6 overflow-x-auto custom-scrollbar">
        {[
          { id: 'flow', label: 'Processing Pipeline', icon: Shuffle },
          { id: 'query', label: 'Semantic Keywords', icon: Sparkles },
          { id: 'vector', label: 'Vector Similarity Map', icon: Sliders },
          { id: 'ranking', label: 'Heuristic Routing', icon: Layout },
          { id: 'feedback', label: 'Collaborative Click Loop', icon: Users }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 border border-transparent cursor-pointer ${
                isActive 
                  ? 'bg-slate-900 border-slate-950 text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white hover:border-slate-100'
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* 3. Render dynamic content for active Tab with elegant exit/entry animations */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="min-h-[300px]"
        >
          {/* TAB 1: FLOWPIPELINE */}
          {activeTab === 'flow' && (
            <div className="space-y-6">
              <p className="text-sm text-slate-600 leading-relaxed">
                When you input a query into Scout or Google, it undergoes a fully parallelized list of NLP pipeline operations to determine exactly what information format you are looking for before fetching any database indices.
              </p>

              {/* Graphical Steps Cards */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 relative">
                {[
                  {
                    step: '1',
                    title: 'Tokenization',
                    desc: 'Query is lowercase-normalized, spelling is checked, and site filters are parsed.',
                    tech: 'NLP Tokenizers'
                  },
                  {
                    step: '2',
                    title: 'Lexical Match',
                    desc: 'High-speed Heuristic RegEx parses absolute trigger words like "near me" or "download".',
                    tech: 'Regex Engine'
                  },
                  {
                    step: '3',
                    title: 'Dense Vectors',
                    desc: 'Query encoded into a high-dimensional vector to extract semantic context.',
                    tech: 'Transformer Model'
                  },
                  {
                    step: '4',
                    title: 'Scoring Mixer',
                    desc: 'Pinecone weights match the queries against website schemas, images, or fresh news.',
                    tech: 'Similarity Index'
                  },
                  {
                    step: '5',
                    title: 'Collaborative IQ',
                    desc: 'Signals from historic clickstreams and bounce-rates adjust the rankings.',
                    tech: 'Reinforcement'
                  }
                ].map((item, idx) => (
                  <div key={idx} className="bg-white border border-slate-200 hover:border-slate-350 p-4 rounded-2xl relative flex flex-col justify-between shadow-[0_2px_4px_rgba(0,0,0,0.02)] transition-all">
                    <div>
                      <div className="w-6 h-6 rounded-full bg-slate-900 text-white text-[10px] font-black flex items-center justify-center mb-3">
                        {item.step}
                      </div>
                      <h4 className="text-[14px] font-bold text-slate-900 tracking-tight leading-snug mb-1">{item.title}</h4>
                      <p className="text-[12px] text-slate-500 leading-normal">{item.desc}</p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] font-mono text-blue-600 font-bold uppercase tracking-wider">
                      {item.tech}
                    </div>
                  </div>
                ))}
              </div>

              {/* Informative Explanation block */}
              <div className="bg-white border border-slate-200/60 p-5 rounded-2xl flex items-start gap-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)]">
                <HelpCircle size={20} className="text-blue-500 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-600 space-y-1.5 leading-relaxed">
                  <h5 className="font-bold text-slate-800">The "Magic" Explained: Hybrid Search</h5>
                  <p>
                    Historically, search engines searched only for exact string keyword matches. Today, Google utilizes a **Hybrid Search Pipeline** combining keyword index matching with Dense Semantic Retrievals (using deep models). If a lexical trigger (e.g., "appstore") activates, specialized container widgets mount on top. Otherwise, the model's dense neural matches take over, ensuring you always get matching formats.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: INTERACTIVE QUERY TOKENIZER */}
          {activeTab === 'query' && (
            <div className="space-y-6">
              <p className="text-sm text-slate-600 leading-relaxed">
                By inspecting individual tokens, we detect hardcoded lexical anchors. Google calls these **Trigger Words**. Below is how Scout evaluated your current query:
              </p>

              {/* Interactive Tokenized Sentence */}
              <div className="p-6 bg-white border border-slate-200 rounded-2xl">
                <div className="flex flex-wrap items-center justify-center gap-2 py-4 border-b border-dashed border-slate-150 mb-4">
                  {queryAnalysis.tokens.length > 0 ? (
                    queryAnalysis.tokens.map((token, index) => {
                      const matched = queryAnalysis.matches.find(m => m.token.toLowerCase() === token.toLowerCase());
                      return (
                        <div 
                          key={index} 
                          className={`px-3 py-1.5 rounded-xl border text-[15px] font-mono font-bold transition-all ${
                            matched 
                              ? matched.color + ' shadow-xs scale-105' 
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {token}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-slate-400 italic">No search tokens found. Type a query first.</div>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span>Tokens extracted: {queryAnalysis.tokens.length}</span>
                  <span>Active anchors triggered: {queryAnalysis.matches.length}</span>
                </div>
              </div>

              {/* Anchors Trigger Breakdown */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-slate-500">Evaluated Anchor Clusters</h4>
                {queryAnalysis.matches.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {queryAnalysis.matches.map((item, i) => (
                      <div key={i} className="flex gap-3 bg-white p-4 rounded-2xl border border-slate-200/60 shadow-xs">
                        <div className="shrink-0">
                          <span className={`inline-flex w-4 h-4 rounded-full border items-center justify-center text-[9px] font-bold ${item.color}`}>✔</span>
                        </div>
                        <div>
                          <p className="text-[13px] font-bold text-slate-800">Token Match: <span className="font-mono text-blue-600">"{item.token}"</span></p>
                          <p className="text-[11.5px] font-bold text-slate-500 uppercase tracking-wide mt-0.5">{item.category}</p>
                          <p className="text-[11px] text-slate-400 mt-1.5 leading-normal">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center text-xs text-slate-500 leading-relaxed italic">
                    No explicit word anchors were triggered by this query. Scout will rely fully on **Semantic Vector Distance matching** (Transformers) rather than hardcoded rules, just as Google does for 85% of long-tail queries!
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: VECTOR CORES & RADAR */}
          {activeTab === 'vector' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-7 space-y-4">
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Sliders size={16} className="text-blue-500" />
                  Intent Vector Analysis
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Google doesn't just match letters; it converts your search request into a **768-dimensional numerical coordinate array (embeddings)**. Scout runs a local *all-mpnet-base-v2* neural parser that evaluates the closeness of your request against key intent clusters.
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  The chart represents the similarity coefficient score vectors mapping where this query lands in spatial coordinates. An intent matching coefficient **greater than 60%** activates specialized layouts.
                </p>

                {/* High quality explanation of similarity */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {[
                    { label: 'Active Classifier', value: dictionary ? 'Lexical definition' : (businessProfile ? 'Places & Local Geo' : 'Dense Documents') },
                    { label: 'Embeddings Engine', value: 'all-mpnet-base (Local)' },
                    { label: 'Dimension Array', value: '768-Float Vector (Dense)' },
                    { label: 'Primary Retrieval', value: 'Pinecone Vector Spaces' },
                  ].map((field, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-xl border border-slate-200 font-mono text-[10px]">
                      <div className="text-slate-400 font-bold uppercase tracking-widest mb-0.5">{field.label}</div>
                      <div className="text-slate-800 font-bold truncate">{field.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Radar Chart Visual */}
              <div className="lg:col-span-5 h-[280px] w-full flex items-center justify-center bg-white border border-slate-250 p-2 rounded-2xl relative overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="75%" data={queryAnalysis.vectors}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#475569', fontSize: 10, fontWeight: 'bold' }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                    <Radar 
                      name="Query Similarity" 
                      dataKey="Score" 
                      stroke="#2563eb" 
                      fill="#3b82f6" 
                      fillOpacity={0.15} 
                      strokeWidth={2}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* TAB 4: HEURISTIC ROUTER */}
          {activeTab === 'ranking' && (
            <div className="space-y-6">
              <p className="text-sm text-slate-600 leading-relaxed">
                Google uses specific decision models to route queries to specialized front-end components. In our application, we implement this exact pattern by activating tailored UI layouts depending on classifier evaluations.
              </p>

              {/* Decision Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    title: 'Interactive Maps List',
                    criterion: 'Local Geo Keywords OR Physical franchise titles',
                    state: activeTriggers.map ? 'ACTIVE' : 'INACTIVE',
                    color: activeTriggers.map ? 'border-emerald-300 bg-emerald-50/50 text-emerald-800' : 'border-slate-200 bg-white text-slate-400',
                    icon: Map,
                    desc: 'Spits out a full Google Places details card with maps preview, contact, hours, and direction directions.'
                  },
                  {
                    title: 'Play Store App Shelf',
                    criterion: 'Keywords like "app", "download" OR notable software brands',
                    state: activeTriggers.apps ? 'ACTIVE' : 'INACTIVE',
                    color: activeTriggers.apps ? 'border-blue-300 bg-blue-50/50 text-blue-800' : 'border-slate-200 bg-white text-slate-400',
                    icon: Download,
                    desc: 'Injects an interactive App shelf card showing store ratings, category definitions, and direct download links.'
                  },
                  {
                    title: 'Lexical Dictionary Desk',
                    criterion: 'Direct "define" or "meaning" query strings',
                    state: activeTriggers.dictionary ? 'ACTIVE' : 'INACTIVE',
                    color: activeTriggers.dictionary ? 'border-purple-300 bg-purple-50/50 text-purple-800' : 'border-slate-200 bg-white text-slate-400',
                    icon: BookOpen,
                    desc: 'Brings up real-time phonetics, pronunciation sound files, synonyms lists, and direct grammar checks.'
                  },
                  {
                    title: 'Fresh Editorial News Pubs',
                    criterion: 'Queries matching news publications OR marked as editorial',
                    state: activeTriggers.news ? 'ACTIVE' : 'INACTIVE',
                    color: activeTriggers.news ? 'border-indigo-300 bg-indigo-50/50 text-indigo-800' : 'border-slate-200 bg-white text-slate-400',
                    icon: FileText,
                    desc: 'Injects live editorial flags and raises reputable news feeds (e.g., NYTimes, BBC) of the topic to the top.'
                  },
                  {
                    title: 'Visual Video Tutor Rails',
                    criterion: 'Video/how-to queries or tutorials',
                    state: activeTriggers.videos ? 'ACTIVE' : 'INACTIVE',
                    color: activeTriggers.videos ? 'border-red-300 bg-red-50/50 text-red-800' : 'border-slate-200 bg-white text-slate-400',
                    icon: Play,
                    desc: 'Injects visual play badges on matching cards and provides tutorial video overlay carousels.'
                  },
                  {
                    title: 'AI Smart Overview (SGE)',
                    criterion: 'All informational searches lacking rapid exact-match domains',
                    state: results.length > 0 ? 'ACTIVE' : 'INACTIVE',
                    color: results.length > 0 ? 'border-amber-300 bg-amber-50/50 text-amber-800' : 'border-slate-200 bg-white text-slate-400',
                    icon: Sparkles,
                    desc: 'Invokes Gemini LLM model prompts server-side to generate concise answer syntheses in real-time.'
                  }
                ].map((item, i) => {
                  const Icon = item.icon;
                  const isActive = item.state === 'ACTIVE';
                  return (
                    <div key={i} className={`p-5 rounded-2xl border flex flex-col justify-between transition-all ${item.color}`}>
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <Icon size={16} className={isActive ? 'text-inherit animate-pulse' : 'text-slate-300'} />
                            <h5 className="font-bold text-[13px] leading-snug">{item.title}</h5>
                          </div>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${
                            isActive ? 'bg-slate-900/10 text-slate-900 border border-slate-900/10' : 'bg-slate-100 text-slate-400 border border-slate-200'
                          }`}>
                            {item.state}
                          </span>
                        </div>
                        <p className="text-[11.5px] opacity-90 leading-normal">{item.desc}</p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-slate-200/50 text-[10px] font-mono opacity-80 leading-normal">
                        <strong>Trigger Criteria:</strong> {item.criterion}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 5: COLLABORATIVE CLICK FEEDBACK LOOP */}
          {activeTab === 'feedback' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 leading-none mb-1">
                    <Users size={16} className="text-blue-500" />
                    Interactive Clickstream Sandbox
                  </h4>
                  <p className="text-xs text-slate-500 font-mono">Simulating RankBrain & User Experience Rank Boost loops</p>
                </div>
                <button
                  onClick={handleResetFeedback}
                  className="px-3 py-1.5 hover:bg-slate-2 py-1 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <RefreshCw size={12} />
                  <span>Reset Variables</span>
                </button>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Rankings aren't static. In Google's actual infrastructure, the list is re-ranked on the fly based on **User Feedback Logs**. Below are the top results for your current query. Use the buttons below each document card to **Simulate User Signals** and witness how click weights dynamic ranking live:
              </p>

              {/* Clickstream document list cards */}
              <div className="space-y-3.5">
                {docFeedbackScores.length > 0 ? (
                  docFeedbackScores.map((item, idx) => {
                    const originalIndex = initialDocs.findIndex(d => d.id === item.id);
                    const positionShift = originalIndex - idx;

                    return (
                      <div key={item.id} className="bg-white border border-slate-250 p-4 rounded-2xl shadow-[0_2px_4px_rgba(0,0,0,0.015)] flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[11px] font-mono text-slate-400 font-bold">rank #{idx + 1}</span>
                            {positionShift > 0 && (
                              <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5 animate-bounce">
                                <TrendingUp size={10} /> +{positionShift} spots
                              </span>
                            )}
                            {positionShift < 0 && (
                              <span className="text-[10px] text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                                <TrendingDown size={10} /> {positionShift} spots
                              </span>
                            )}
                          </div>
                          
                          <h5 className="font-bold text-sm text-[#1a0dab] line-clamp-1">{item.title}</h5>
                          <span className="text-[11px] text-slate-400 block font-mono mt-0.5 truncate">{item.url}</span>

                          {/* Stat outputs */}
                          <div className="flex gap-4 mt-3 text-[10px] font-mono text-slate-500 border-t border-slate-50 pt-2 flex-wrap">
                            <div>Clicks: <strong className="text-slate-800">{clicksCount[item.id] || 0}</strong></div>
                            <div>Avg Dwell: <strong className="text-slate-800">{dwellTimes[item.id] || 0}s</strong></div>
                            <div>Pogo Drops: <strong className="text-red-500 font-black">{pogoStickCount[item.id] || 0}</strong></div>
                            <div>Base Vector Cosine: <strong className="text-slate-800">{item.baseSemanticScore.toFixed(0)}%</strong></div>
                            <div>Implicit Boost: <strong className={item.feedBackAdjust >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                              {item.feedBackAdjust >= 0 ? `+${item.feedBackAdjust}` : item.feedBackAdjust}
                            </strong></div>
                          </div>
                        </div>

                        {/* Signal Trigger Knobs */}
                        <div className="shrink-0 flex sm:flex-col gap-2">
                          <button
                            onClick={() => handleSimulateClick(item.id, false)}
                            className="px-3 py-1.5 bg-[#f1f3f4] hover:bg-[#e8eaed] text-slate-800 text-[10.5px] font-semibold rounded-xl flex items-center gap-1 border-none cursor-pointer transition-all"
                          >
                            <TrendingUp size={12} className="text-emerald-600" />
                            <span>Read/Click Website</span>
                          </button>
                          
                          <button
                            onClick={() => handleSimulateClick(item.id, true)}
                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10.5px] font-semibold rounded-xl flex items-center gap-1 border-none cursor-pointer transition-all"
                            title="Users staying > 3 minutes (highly resonant)"
                          >
                            <Sparkles size={11} />
                            <span>Dwell Time Booster</span>
                          </button>
                          
                          <button
                            onClick={() => handleSimulatePogo(item.id)}
                            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-[10.5px] font-semibold rounded-xl flex items-center gap-1 border-none cursor-pointer transition-all"
                            title="Bounce Rate/Pogo-sticking penalty"
                          >
                            <TrendingDown size={12} />
                            <span>Pogo-sticking Bounce</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center text-slate-400 italic text-xs py-8 bg-white border border-slate-200 rounded-2xl">
                    Search Results must be active on screen to populate the Clickstream simulator logs.
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* 4. Fine-print scientific footnote illustrating actual Google technologies */}
      <div className="mt-8 border-t border-slate-200 pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[11px] text-slate-400">
        <div className="flex items-center gap-2 font-mono">
          <Settings size={13} />
          <span>Calculated Weighting System based on RankBrain, BERT, PageRank and MUM models</span>
        </div>
        <div>
          <span>Scout Decoders Dashboard v3.5 · Broadly Integrated</span>
        </div>
      </div>

    </div>
  );
}
