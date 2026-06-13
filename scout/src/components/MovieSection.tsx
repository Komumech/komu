import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, 
  Clock, 
  Star, 
  Film, 
  Award, 
  Play, 
  ChevronRight, 
  ChevronLeft,
  Layers, 
  Users, 
  Check, 
  Bookmark, 
  Plus, 
  Tv, 
  ExternalLink,
  ThumbsUp,
  MapPin,
  Flame,
  TrendingUp,
  ThumbsDown
} from 'lucide-react';

interface CastMember {
  id: number;
  name: string;
  character: string;
  profilePath: string;
}

interface Season {
  id: number;
  name: string;
  seasonNumber: number;
  episodeCount: number;
  airDate: string;
  posterPath: string | null;
}

interface Episode {
  id: number;
  name: string;
  episodeNumber: number;
  overview: string;
  airDate: string;
  rating: number;
  stillPath: string | null;
}

interface MovieData {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  tagline?: string;
  overview: string;
  releaseDate: string;
  runtime: string;
  rating: number;
  voteCount: number;
  genres: string[];
  posterPath: string;
  backdropPath: string;
  status: string;
  cast: CastMember[];
  seasons?: Season[];
  episodes?: Episode[];
  source?: string;
}

interface MovieSectionProps {
  movie: MovieData;
}

function getProviderIcon(name: string, sizeClass = "w-8 h-8") {
  const norm = name.toLowerCase();

  // 1. Netflix
  if (norm.includes('netflix')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-black p-1.5 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M4 2v20h4V10.1l8 11.9h4V2h-4v11.9L8 2H4z" fill="#E50914" />
      </svg>
    );
  }

  // 2. Prime Video / Amazon
  if (norm.includes('prime') || norm.includes('amazon')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#00A8E8] p-1.5 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M22.5 12H1.5A1.5 1.5 0 010 10.5v-7A1.5 1.5 0 011.5 2h21A1.5 1.5 0 0124 3.5v7a1.5 1.5 0 01-1.5 1.5zm-8.25 4.54c-1.89-.13-3.77-.38-5.59-.75-.38-.08-.55-.42-.36-.71.19-.3.51-.35.88-.27 1.63.34 3.32.56 5.02.68.74.05 1.51-.01 2.22-.19a2.3 2.3 0 001.37-.88 2.02 2.02 0 00.33-1.63 2 2 0 00-.83-1.3l.36-.67a3 3 0 011.23 1.94c.14.77.01 1.56-.37 2.22a3.3 3.3 0 01-2 1.34 7.63 7.63 0 01-2.26.22zM7.45 14.5l.1.5c.08.38.2.75.36 1.1l-.88.42c-.22-.44-.38-.93-.47-1.42l-.11-.6z" fill="#FFFFFF" />
      </svg>
    );
  }

  // 3. Apple TV / iTunes
  if (norm.includes('apple') || norm.includes('itunes')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#111111] p-1.5 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.21.67-2.93 1.49-.62.69-1.16 1.84-1.01 2.96 1.1.09 2.23-.58 2.95-1.39z" fill="#FFFFFF" />
      </svg>
    );
  }

  // 4. Disney+ / Disney Plus
  if (norm.includes('disney')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-slate-900 p-1.5 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M12 22c5.8 0 10-4.2 10-10S17.8 2 12 2 2 6.2 2 12s4.2 10 10 10zm-1.3-13.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z" fill="#00E6FF" />
      </svg>
    );
  }

  // 5. HBO Max / Max
  if (norm.includes('hbo') || norm.includes('max')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-indigo-950 p-1.5 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" fill="#00E5FF" />
      </svg>
    );
  }

  // 6. Hulu
  if (norm.includes('hulu')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#0a0f0d] p-1.5 shrink-0 shadow-xs border border-slate-800`} fill="currentColor">
        <path d="M19.43 14.86c0 2.21-1.02 3.32-3.05 3.32h-1.63v-3.76h-5.5v3.76H7.62V5.82h1.63v5.26h5.5V5.82h1.63v9.04z" fill="#1CE783" />
      </svg>
    );
  }

  // 7. Peacock
  if (norm.includes('peacock')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-black p-1 shrink-0 shadow-xs`} fill="currentColor">
        <circle cx="12" cy="7" r="1.5" fill="#00AEEF" />
        <circle cx="8.5" cy="9.5" r="1.5" fill="#0054A6" />
        <circle cx="15.5" cy="9.5" r="1.5" fill="#EE1C25" />
        <circle cx="7" cy="14" r="1.5" fill="#F7941D" />
        <circle cx="17" cy="14" r="1.5" fill="#FFF200" />
        <circle cx="12" cy="15.5" r="1.8" fill="#39B54A" />
      </svg>
    );
  }

  // 8. Paramount Plus / Paramount
  if (norm.includes('paramount')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#0064FF] p-1.5 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M12 2L4 8l1.5 5.5L12 22l6.5-8.5L20 8l-8-6zm0 13a3 3 0 110-6 3 3 0 010 6z" fill="#FFFFFF" />
      </svg>
    );
  }

  // 9. YouTube
  if (norm.includes('youtube')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#FF0000] p-1.5 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M23.5 6.4c-.3-1-1-1.7-2-2C19.7 4 12 4 12 4s-7.7 0-9.5.4c-1 .3-1.7 1-2 2C0 8.2 0 12 0 12s0 3.8.4 5.6c.3 1 1 1.7 2 2C4.3 20 12 20 12 20s7.7 0 9.5-.4c1-.3 1.7-1 2-2 .4-1.8.4-5.6.4-5.6s0-3.8-.4-5.6zM9.5 15.5V8.5l6.5 3.5-6.5 3.5z" fill="#FFFFFF" />
      </svg>
    );
  }

  // 10. Google Play Movies / Google
  if (norm.includes('google') || norm.includes('play')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-slate-50 p-1 shrink-0 shadow-xs border border-slate-200`} fill="currentColor">
        <path d="M3 2.5a2 2 0 012-2c3.4 0 11.2 5 13.9 6.8 1.4.9 1.4 2.5 0 3.4C16.2 12.5 8.4 17.5 5 17.5a2 2 0 01-2-2V2.5z" fill="#00E5FF" />
        <path d="M3 2.5a2 2 0 012-2l7 7-7 7a2 2 0 01-2-2V2.5z" fill="#FF3366" />
        <path d="M10 7.5L3 .5v14l7-7z" fill="#FFCC00" />
      </svg>
    );
  }

  // 11. Tubi
  if (norm.includes('tubi')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#222222] p-1 shrink-0 shadow-xs`} fill="currentColor">
        <rect x="2" y="5" width="20" height="14" rx="3" fill="#F57C00" />
        <text x="5" y="14" fill="#FFFFFF" fontSize="8" fontWeight="bold" fontFamily="sans-serif">tubi</text>
      </svg>
    );
  }

  // 12. Pluto TV
  if (norm.includes('pluto')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-slate-900 p-1 shrink-0 shadow-xs`} fill="currentColor">
        <circle cx="12" cy="12" r="10" fill="#FF00CC" />
        <circle cx="12" cy="12" r="7" fill="#00FFFF" />
        <circle cx="12" cy="12" r="4" fill="#FFFF00" />
      </svg>
    );
  }

  // 13. Roku
  if (norm.includes('roku')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#662D91] p-1.5 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M4 17V7h4a3 3 0 013 3v1a3 3 0 01-3 3H6v3H4zm6-5h4a2 2 0 002-2V9a2 2 0 00-2-2h-4v5zm8 5a2 2 0 01-2-2V7h2v8h2V7h2v10h-4z" fill="#FFFFFF" />
      </svg>
    );
  }

  // 14. Crunchyroll
  if (norm.includes('crunchyroll')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#FF6600] p-1 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 17a7 7 0 110-14 7 7 0 010 14z" fill="#FFFFFF" />
        <circle cx="12" cy="12" r="4" fill="#FFFFFF" />
      </svg>
    );
  }

  // 15. Fandango / Vudu
  if (norm.includes('vudu') || norm.includes('fandango')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#2196F3] p-1.5 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M12 2l10 10-10 10L2 12 12 2zm0 15a5 5 0 110-10 5 5 0 010 10z" fill="#FFFFFF" />
      </svg>
    );
  }

  // 16. Plex
  if (norm.includes('plex')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#0c0c0d] p-1.5 shrink-0 shadow-xs border border-slate-850`} fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5l-4-3.5 4-3.5v7zm-2-7h4v1.5h-4V9.5z" fill="#EBA000" />
      </svg>
    );
  }

  // 17. Sling
  if (norm.includes('sling')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#16AEE5] p-1 shrink-0 shadow-xs`} fill="currentColor">
        <rect x="2" y="8" width="20" height="8" rx="2" fill="#FFFFFF" />
        <circle cx="12" cy="12" r="3" fill="#EE1C25" />
      </svg>
    );
  }

  // 18. Starz
  if (norm.includes('starz')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-black p-1 shrink-0 shadow-xs`} fill="currentColor">
        <polygon points="12,3 15,9 21,12 15,15 12,21 9,15 3,12 9,9" fill="#FFFFFF" />
      </svg>
    );
  }

  // 19. Showtime
  if (norm.includes('showtime')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#E50914] p-1 shrink-0 shadow-xs`} fill="currentColor">
        <text x="3" y="15" fill="#FFFFFF" fontSize="9" fontWeight="bold" fontFamily="sans-serif">SHO</text>
      </svg>
    );
  }

  // 20. Philo
  if (norm.includes('philo')) {
    return (
      <svg viewBox="0 0 24 24" className={`${sizeClass} rounded-lg bg-[#111111] p-1.5 shrink-0 shadow-xs`} fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15H8V7h2v10zm6 0h-2V7h2v10z" fill="#00E5FF" />
      </svg>
    );
  }

  // Dynamic Fallback
  const colors = [
    'from-blue-600 to-sky-500',
    'from-indigo-600 to-purple-500',
    'from-rose-600 to-pink-500',
    'from-emerald-600 to-teal-500',
    'from-amber-600 to-orange-500'
  ];
  const charSum = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const selectedGradient = colors[charSum % colors.length];

  return (
    <div className={`${sizeClass} rounded-lg bg-gradient-to-tr ${selectedGradient} flex items-center justify-center text-white text-xs font-black shrink-0 shadow-xs select-none`}>
      {name.slice(0, 1).toUpperCase() || 'W'}
    </div>
  );
}

export function MovieSidebar({ movie, className = "" }: { movie: MovieData; className?: string }) {
  const [watchListState, setWatchListState] = useState<'none' | 'want' | 'watched'>('none');
  const [userRating, setUserRating] = useState<'thumbUp' | 'thumbDown' | null>(null);
  const [isDisliked, setIsDisliked] = useState(false);

  useEffect(() => {
    const checkPersistedRating = () => {
      const key = `movie_rating_${movie.id || movie.title}`;
      const saved = localStorage.getItem(key);
      if (saved === 'thumbUp' || saved === 'thumbDown') {
        setUserRating(saved as any);
        setIsDisliked(saved === 'thumbDown');
      } else {
        setUserRating(null);
        setIsDisliked(false);
      }
    };

    checkPersistedRating();

    window.addEventListener('movie_rating_changed', checkPersistedRating);
    return () => {
      window.removeEventListener('movie_rating_changed', checkPersistedRating);
    };
  }, [movie.id, movie.title]);

  const handleRatingClick = (type: 'thumbUp' | 'thumbDown') => {
    const key = `movie_rating_${movie.id || movie.title}`;
    const newRating = userRating === type ? null : type;
    
    if (newRating) {
      localStorage.setItem(key, newRating);
      if (newRating === 'thumbDown') {
        const dislikes = JSON.parse(localStorage.getItem('disliked_movie_ids') || '[]');
        const entry = String(movie.id || movie.title);
        if (!dislikes.includes(entry)) {
          dislikes.push(entry);
          localStorage.setItem('disliked_movie_ids', JSON.stringify(dislikes));
        }
      } else {
        const dislikes = JSON.parse(localStorage.getItem('disliked_movie_ids') || '[]');
        const entry = String(movie.id || movie.title);
        const filtered = dislikes.filter((e: string) => e !== entry);
        localStorage.setItem('disliked_movie_ids', JSON.stringify(filtered));
      }
    } else {
      localStorage.removeItem(key);
      const dislikes = JSON.parse(localStorage.getItem('disliked_movie_ids') || '[]');
      const entry = String(movie.id || movie.title);
      const filtered = dislikes.filter((e: string) => e !== entry);
      localStorage.setItem('disliked_movie_ids', JSON.stringify(filtered));
    }

    window.dispatchEvent(new Event('movie_rating_changed'));
  };

  const streamProviders = [
    { name: 'Netflix', price: 'Subscription', color: 'bg-red-600', iconLetter: 'N' },
    { name: 'Prime Video', price: 'Buy/Rent from $3.99', color: 'bg-amber-500', iconLetter: 'P' },
    { name: 'Apple TV', price: 'Buy/Rent from $3.99', color: 'bg-slate-900', iconLetter: 'A' },
  ];

  if (isDisliked) return null;

  return (
    <div className={className}>
      {/* Where to Watch Box (Google style with beautiful brand SVGs) */}
      <div className="bg-[#eef3fc] rounded-[24px] p-5 border-0 shadow-none">
        <div className="text-[13px] font-bold text-slate-500 uppercase tracking-wider mb-3">Where to watch</div>
        
        <div className="flex flex-row flex-wrap gap-2.5 items-center">
          {streamProviders.map((provider) => (
            <div key={provider.name} className="p-1 rounded-xl bg-white flex items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95 shadow-none border-none" title={provider.name}>
              {getProviderIcon(provider.name, "w-10 h-10")}
            </div>
          ))}
        </div>
      </div>

      {/* Google user interest panel (Watch now, already watched, want to watch, feedback) */}
      <div className="bg-[#eef3fc] rounded-[24px] p-5 space-y-4 border-0 shadow-none">
        <div className="flex items-center justify-between pb-3 border-b border-blue-100">
          <span className="text-xs text-slate-500 font-medium font-sans">Interested in this show?</span>
          <div className="flex gap-2">
            <button
              onClick={() => handleRatingClick('thumbUp')}
              className={`p-2 rounded-full border transition-all cursor-pointer ${
                userRating === 'thumbUp'
                  ? 'bg-[#e1f2fa] border-[#b0e2f9] text-[#006097]'
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
              title="Liked it"
            >
              <ThumbsUp size={15} />
            </button>
            <button
              onClick={() => handleRatingClick('thumbDown')}
              className={`p-2 rounded-full border transition-all cursor-pointer ${
                userRating === 'thumbDown'
                  ? 'bg-rose-50 border-rose-200 text-rose-600'
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
              title="Disliked it"
            >
              <ThumbsDown size={15} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setWatchListState(watchListState === 'want' ? 'none' : 'want')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
              watchListState === 'want'
                ? 'bg-[#e1f2fa] border-[#b0e2f9] text-[#006097]'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Bookmark size={14} className={watchListState === 'want' ? 'fill-current' : ''} />
            Want to watch
          </button>
          <button
            onClick={() => setWatchListState(watchListState === 'watched' ? 'none' : 'watched')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
              watchListState === 'watched'
                ? 'bg-[#e1f2fa] border-[#b0e2f9] text-[#006097]'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Check size={14} />
            Already watched
          </button>
        </div>
      </div>

      {/* Additional Sidebar Metadata - Styled beautifully like Wikipedia Infobox Facts */}
      <div className="bg-[#eef3fc] rounded-[24px] p-5 pb-4 border-0 shadow-none">
        <div className="space-y-2 text-xs text-slate-500">
          <div className="flex justify-between py-1.5 border-b border-blue-100">
            <span>Status</span>
            <span className="font-bold text-slate-700">{movie.status}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-blue-100">
            <span>Vote Count</span>
            <span className="text-slate-700 font-mono">{movie.voteCount} votes</span>
          </div>
          <div className="flex justify-between py-1.5">
            <span>Ref API Source</span>
            <span className="bg-blue-50 text-blue-600 font-mono px-1.5 py-0.5 rounded font-black text-[9px] uppercase tracking-wider">
              {movie.source === 'tmdb' ? 'TMDB LIVE CONNECT' : 'AI DEDUCTED'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MovieSection({ movie }: MovieSectionProps) {
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'cast' | 'episodes' | 'watch' | 'awards'>('overview');
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [episodes, setEpisodes] = useState<Episode[]>(movie.episodes || []);
  const [loadingEpisodes, setLoadingEpisodes] = useState<boolean>(false);
  const [isEpisodesExpanded, setIsEpisodesExpanded] = useState<boolean>(false);

  // Dynamic bookmark states & watch state
  const [watchListState, setWatchListState] = useState<'none' | 'want' | 'watched'>('none');
  const [userRating, setUserRating] = useState<'thumbUp' | 'thumbDown' | null>(null);
  const [isDisliked, setIsDisliked] = useState(false);

  // Cast Carousel scroll refs and tracking
  const overviewCastScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // Read dislike and feedback state dynamically
  useEffect(() => {
    const checkDisliked = () => {
      const key = `movie_rating_${movie.id || movie.title}`;
      const saved = localStorage.getItem(key);
      setIsDisliked(saved === 'thumbDown');
      if (saved === 'thumbUp' || saved === 'thumbDown') {
        setUserRating(saved as any);
      } else {
        setUserRating(null);
      }
    };
    checkDisliked();
    window.addEventListener('movie_rating_changed', checkDisliked);
    return () => {
      window.removeEventListener('movie_rating_changed', checkDisliked);
    };
  }, [movie.id, movie.title]);

  const handleUndoDislike = () => {
    const key = `movie_rating_${movie.id || movie.title}`;
    localStorage.removeItem(key);
    const dislikes = JSON.parse(localStorage.getItem('disliked_movie_ids') || '[]');
    const entry = String(movie.id || movie.title);
    const filtered = dislikes.filter((e: string) => e !== entry);
    localStorage.setItem('disliked_movie_ids', JSON.stringify(filtered));
    
    window.dispatchEvent(new Event('movie_rating_changed'));
  };

  const handleCastScroll = () => {
    const el = overviewCastScrollRef.current;
    if (el) {
      setCanScrollLeft(el.scrollLeft > 10);
      setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
    }
  };

  // Synchronize episodes state on initial load or movie change
  useEffect(() => {
    setEpisodes(movie.episodes || []);
    setSelectedSeason(1);
    setIsEpisodesExpanded(false);
    if (overviewCastScrollRef.current) {
      overviewCastScrollRef.current.scrollLeft = 0;
    }
    setCanScrollLeft(false);
    setCanScrollRight(true);
  }, [movie]);

  // Fetch episodes dynamically when season changes (only for TV Shows)
  useEffect(() => {
    if (movie.mediaType === 'tv' && selectedSeason > 0) {
      if (selectedSeason === 1 && movie.episodes && movie.episodes.length > 0) {
        setEpisodes(movie.episodes);
        return;
      }
      
      setLoadingEpisodes(true);
      fetch(`/api/tmdb/tv/${movie.id}/season/${selectedSeason}?showName=${encodeURIComponent(movie.title)}`)
        .then((res) => {
          if (!res.ok) throw new Error('Failed to load season details');
          return res.json();
        })
        .then((data) => {
          if (data && data.episodes) {
            setEpisodes(data.episodes);
          }
          setLoadingEpisodes(false);
        })
        .catch((err) => {
          console.error('🎬 Failed loading TMDB season:', err);
          setLoadingEpisodes(false);
        });
    }
  }, [selectedSeason, movie.id, movie.mediaType, movie.title, movie.episodes]);

  const [trailerVideoId, setTrailerVideoId] = useState<string>('');

  useEffect(() => {
    let active = true;
    if (!movie || !movie.title) return;
    
    const releaseYear = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : '';
    const searchQuery = `${movie.title} ${releaseYear} official trailer`;
    
    setTrailerVideoId('');
    
    fetch(`/api/youtube-search?q=${encodeURIComponent(searchQuery)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data && data.videos && data.videos.length > 0) {
          setTrailerVideoId(data.videos[0].id);
        } else {
          const lowerT = movie.title.toLowerCase();
          if (lowerT.includes('justice league')) {
            setTrailerVideoId('3cxixDgSzYg');
          } else if (lowerT.includes('spider-man') || lowerT.includes('spiderman')) {
            setTrailerVideoId('JfVOs4VSpmA');
          } else if (lowerT.includes('avatar')) {
            setTrailerVideoId('d9MyW72ELq0');
          } else if (lowerT.includes('interstellar')) {
            setTrailerVideoId('zSWdZVtXT7E');
          } else {
            setTrailerVideoId('dQw4w9WgXcQ');
          }
        }
      })
      .catch((err) => {
        console.error("Failed fetching movie trailer video:", err);
        if (active) {
          setTrailerVideoId('3cxixDgSzYg');
        }
      });
      
    return () => { active = false; };
  }, [movie]);

  const year = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : 'N/A';

  // Compute mock ratings for secondary sources to replicate high-fidelity Google info
  const rawRating = movie.rating || 7.5;
  const imdbRating = (rawRating + 0.3 > 10 ? 10 : rawRating + 0.3).toFixed(1);
  const tmdbRating = rawRating.toFixed(1);
  const rottenRating = Math.round(rawRating * 10 + (rawRating > 8 ? 5 : -2));
  const finalRottenRating = rottenRating > 100 ? 100 : (rottenRating < 50 ? 58 : rottenRating);

  // Carousel Item Builder
  const CarouselItem = () => {
    const carouselImages = [
      movie.posterPath,
      movie.backdropPath,
    ].filter(Boolean);
    
    if (movie.cast && movie.cast.length > 0) {
      movie.cast.slice(0, 4).forEach((actor) => {
        if (actor.profilePath) {
          carouselImages.push(actor.profilePath);
        }
      });
    }

    if (movie.episodes && movie.episodes.length > 0) {
      movie.episodes.slice(0, 3).forEach((ep) => {
        if (ep.stillPath) {
          carouselImages.push(ep.stillPath);
        }
      });
    }

    const videoId = trailerVideoId || '3cxixDgSzYg';

    return (
      <div className="w-full">
        {/* Horizontal scroll track with completely hidden scrollbars */}
        <div 
          className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {/* SLIDE 1: AUTOPLAY SILENTED LOOPING VIDEO TRAILER (LANDSCAPE) */}
          <div className="relative w-[75vw] sm:w-[460px] aspect-[16/9] bg-slate-950 rounded-2xl overflow-hidden shrink-0 snap-start flex-none border border-slate-200/10">
            <iframe
              src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playlist=${videoId}&loop=1&controls=0&modestbranding=1&rel=0&start=15&end=45&showinfo=0&iv_load_policy=3&fs=0`}
              className="w-full h-full object-cover select-none pointer-events-none"
              allow="autoplay; encrypted-media"
              title="Official Trailer Preview"
            />
            
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/50 pointer-events-none" />

            <div className="absolute top-2.5 left-2.5 bg-black/60 backdrop-blur-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 text-[10.5px] font-bold text-white/95 select-none pointer-events-none">
              <span className="opacity-90">YouTube</span>
              <span className="text-white/40">·</span>
              <span>Official Trailer</span>
            </div>

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-xs flex items-center justify-center border border-white/25">
                <Play size={16} className="text-white fill-white ml-0.5" />
              </div>
            </div>

            <div className="absolute bottom-2.5 left-2.5 bg-black/70 backdrop-blur-xs px-2 py-0.5 rounded text-[10.5px] font-mono text-white/90 font-semibold select-none pointer-events-none">
              Trailer · 1:01
            </div>
          </div>

          {/* SLIDES 2+: IMAGES FROM MOVIE / CAST / BACKDROPS */}
          {carouselImages.map((imgUrl, idx) => {
            const isPortrait = idx === 0; // First is poster (portrait), second is backdrop (landscape)
            const widthClass = isPortrait 
              ? 'w-[45vw] sm:w-[220px] aspect-[2/3]' 
              : 'w-[75vw] sm:w-[460px] aspect-[16/9]';
              
            return (
              <div 
                key={idx} 
                className={`relative ${widthClass} bg-slate-50 rounded-2xl overflow-hidden shrink-0 snap-start flex-none`}
              >
                <img
                  src={imgUrl}
                  alt={`${movie.title} media slot ${idx + 2}`}
                  className="w-full h-full object-contain select-none pointer-events-none"
                  referrerPolicy="no-referrer"
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Provider config
  const streamProviders = [
    { name: 'Netflix', price: 'Subscription', color: 'bg-red-600', iconLetter: 'N' },
    { name: 'Prime Video', price: 'Buy/Rent from $3.99', color: 'bg-amber-500', iconLetter: 'P' },
    { name: 'Apple TV', price: 'Buy/Rent from $3.99', color: 'bg-slate-900', iconLetter: 'A' },
  ];

  if (isDisliked) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full bg-slate-50 border-0 rounded-2xl p-5 flex items-center justify-between gap-4 mb-8 text-sm text-slate-600 font-medium font-sans shadow-none"
      >
        <div className="flex items-center gap-2">
          <span>👎 Feedback submitted. "<strong>{movie.title}</strong>" has been hidden from your search results.</span>
        </div>
        <button 
          onClick={handleUndoDislike}
          className="text-blue-600 hover:underline hover:text-blue-700 font-bold uppercase tracking-wider text-xs shrink-0 cursor-pointer"
        >
          Undo
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      id="google-movie-knowledge-panel"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.35 }}
      className="w-full bg-white rounded-[28px] mb-8 overflow-hidden font-sans text-slate-800"
    >
      {/* 1. HEADER SECTION (Google Style Title & Subtitle) */}
      <div className="p-4 sm:p-6 pb-2">
        <h1 className="text-3xl md:text-4xl font-normal text-slate-900 tracking-tight font-sans">
          {movie.title}
        </h1>
        <div className="flex flex-wrap items-center gap-1.5 text-[14px] text-slate-500 mt-1.5 font-medium">
          <span>{year}</span>
          <span>‧</span>
          <span>{movie.genres?.slice(0, 3).join(', ') || 'Drama'}</span>
          {movie.mediaType === 'tv' && movie.seasons && (
            <>
              <span>‧</span>
              <span>{movie.seasons.length} season{movie.seasons.length > 1 ? 's' : ''}</span>
            </>
          )}
          {movie.mediaType === 'movie' && movie.runtime && (
            <>
              <span>‧</span>
              <span>{movie.runtime}</span>
            </>
          )}
        </div>

        {/* SUB-TABS (Google Pills Layout with #e1f2fa Bright Blue for selected states) */}
        <div className="flex gap-2.5 overflow-x-auto pb-1 mt-5 scrollbar-hide border-b border-slate-100">
          {(['overview', 'cast', 'episodes', 'watch', 'awards'] as const).map((tab) => {
            const isTvOnly = tab === 'episodes' && movie.mediaType !== 'tv';
            if (isTvOnly) return null;

            const isSelected = activeSubTab === tab;
            let label = '';
            if (tab === 'overview') label = 'Overview';
            else if (tab === 'cast') label = 'Cast';
            else if (tab === 'episodes') label = 'Episodes';
            else if (tab === 'watch') label = 'Trailers & clips';
            else if (tab === 'awards') label = 'Awards';
            
            return (
              <button
                key={tab}
                onClick={() => setActiveSubTab(tab)}
                className={`px-4 py-1.5 rounded-full text-[13px] font-semibold border-0 transition-all cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? 'bg-[#e1f2fa] text-[#006097]'
                    : 'bg-[#eef3fc] text-slate-700 hover:bg-[#e2ebf8]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. DYNAMIC TAB CONTENT */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeSubTab}
          initial={{ opacity: 0, x: 5 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -5 }}
          transition={{ duration: 0.2 }}
          className="p-4 sm:p-6 pt-4"
        >
          {/* ==================================== OVERVIEW TAB ==================================== */}
          {activeSubTab === 'overview' && (
            <div className="flex flex-col gap-5">
              
              {/* Image & Video Carousel replacing old static collage */}
              <CarouselItem />

              {/* Ratings Summary Row with light chevron links */}
              <div className="flex items-center gap-5 py-3.5 border-t border-b border-slate-100 text-[13.5px] font-medium text-slate-600 mt-2 select-none">
                <a 
                  href={`https://www.imdb.com/find?q=${encodeURIComponent(movie.title)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline flex items-center gap-1 text-slate-800"
                >
                  <span className="font-extrabold text-slate-900">{imdbRating}/10</span>
                  <span className="text-slate-400 font-normal">·</span>
                  <span>IMDb</span>
                  <ChevronRight size={13} className="text-blue-600 ml-0.5 stroke-[2.5]" />
                </a>
                <div className="w-[1px] h-3.5 bg-slate-200" />
                <a 
                  href={`https://www.rottentomatoes.com/search?search=${encodeURIComponent(movie.title)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline flex items-center gap-1 text-slate-800"
                >
                  <span className="font-extrabold text-slate-900">{finalRottenRating}%</span>
                  <span className="text-slate-400 font-normal">·</span>
                  <span>Rotten Tomatoes</span>
                  <ChevronRight size={13} className="text-blue-600 ml-0.5 stroke-[2.5]" />
                </a>
              </div>

              {/* Bento Grid layout replicating Google's mobile card design exactly */}
              <div className="grid grid-cols-2 gap-3.5 mt-2">
                {/* 1. Cast Card */}
                <div 
                  onClick={() => setActiveSubTab('cast')}
                  className="bg-[#eef3fc] hover:bg-[#e2ebf8] border border-transparent rounded-2xl p-4 flex flex-col justify-between cursor-pointer transition-colors min-h-[110px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13.5px] font-bold text-slate-800">Cast</span>
                    <ChevronRight size={14} className="text-slate-500 rotate-90" />
                  </div>
                  <div className="flex -space-x-2 mt-3 overflow-hidden select-none">
                    {movie.cast?.slice(0, 3).map((actor, idx) => (
                      <img 
                        key={idx}
                        src={actor.profilePath} 
                        alt={actor.name} 
                        className="w-9 h-9 rounded-full object-cover border-2 border-[#eef3fc] shadow-2xs shrink-0" 
                        referrerPolicy="no-referrer"
                      />
                    ))}
                  </div>
                </div>

                {/* 2. Release Date Card */}
                <div className="bg-[#eef3fc] border border-transparent rounded-2xl p-4 flex flex-col justify-between min-h-[110px]">
                  <span className="text-[13.5px] font-bold text-slate-800">Release date</span>
                  <div className="text-[12.5px] font-bold text-slate-700 leading-tight mt-2 pb-1">
                    {movie.releaseDate ? `${new Date(movie.releaseDate).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'N/A'}
                  </div>
                </div>
              </div>

              {/* 3. Overview Card */}
              <div className="bg-[#eef3fc] border border-transparent rounded-2xl p-4.5 mt-1">
                <div className="flex items-center justify-between mb-2 select-none">
                  <span className="text-[13.5px] font-bold text-slate-800">Overview</span>
                  <ChevronRight size={14} className="text-slate-500 rotate-90" />
                </div>
                <p className="text-[12.5px] text-slate-700 leading-relaxed font-normal whitespace-pre-line">
                  {movie.overview || 'No overview synopsis is currently logged for this media.'}
                </p>
              </div>

              {/* TV Episodes sub-list overview triggers */}
              {movie.mediaType === 'tv' && episodes && episodes.length > 0 && (
                <div className="border border-slate-100 rounded-2xl p-4 bg-slate-50/10 mt-1">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[13.5px] font-bold text-slate-800">Episodes</span>
                    <span className="text-xs text-slate-400 font-mono">Season {selectedSeason}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {episodes.slice(0, isEpisodesExpanded ? undefined : 4).map((ep) => (
                      <div key={ep.id} className="flex gap-3 p-2 rounded-xl bg-slate-50/50 hover:bg-slate-50 border border-slate-100/50 transition-colors">
                        <div className="w-20 h-13 rounded-lg overflow-hidden bg-slate-100 shrink-0 relative">
                          <img
                            src={ep.stillPath || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=200'}
                            alt={ep.name}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                          <div className="text-[10px] text-slate-400 font-mono">S{selectedSeason} E{ep.episodeNumber}</div>
                          <div className="text-xs font-bold text-slate-800 truncate mt-0.5">{ep.name}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {episodes.length > 4 && (
                    <button
                      onClick={() => setIsEpisodesExpanded(!isEpisodesExpanded)}
                      className="w-full text-center py-2 mt-3 border-t border-slate-100 font-bold text-xs text-slate-405 hover:text-slate-800 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    >
                      {isEpisodesExpanded ? 'Show less' : `View ${episodes.length - 4}+ more episodes`}
                    </button>
                  )}
                </div>
              )}

              {/* Watch providers block embedded at bottom of overview on mobile screens */}
              <MovieSidebar movie={movie} className="lg:hidden flex flex-col gap-4 mt-4" />

            </div>
          )}

          {/* ==================================== CAST TAB ==================================== */}
          {activeSubTab === 'cast' && (
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Users size={20} className="text-[#006097]" />
                <h2 className="text-lg font-bold text-slate-900">Full Casting & Crew</h2>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {movie.cast?.map((actor, idx) => (
                  <div key={idx} className="bg-slate-50 rounded-2xl overflow-hidden transition-all flex flex-col">
                    <div className="aspect-[3/4] w-full bg-slate-50 relative overflow-hidden">
                      <img
                        src={actor.profilePath}
                        alt={actor.name}
                        className="w-full h-full object-cover object-top pointer-events-none select-none"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="p-3 flex-1 flex flex-col justify-center">
                      <div className="text-xs font-bold text-slate-900 line-clamp-1">{actor.name}</div>
                      <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{actor.character}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ==================================== EPISODES TAB ==================================== */}
          {activeSubTab === 'episodes' && movie.mediaType === 'tv' && (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Layers size={20} className="text-[#006097]" />
                  <h2 className="text-lg font-bold text-slate-900">Episode Directory</h2>
                </div>
                
                {/* Season selector */}
                {movie.seasons && movie.seasons.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-bold uppercase shrink-0">Season:</span>
                    <select
                      value={selectedSeason}
                      onChange={(e) => setSelectedSeason(Number(e.target.value))}

                      className="bg-white border border-slate-250 hover:border-slate-350 rounded-lg text-xs py-1.5 px-3 focus:outline-none text-slate-700 bg-none cursor-pointer"
                    >
                      {movie.seasons
                        .filter(s => s.seasonNumber > 0)
                        .map((s) => (
                          <option key={s.id} value={s.seasonNumber}>
                            {s.name || `Season ${s.seasonNumber}`} ({s.episodeCount} episodes)
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              <AnimatePresence mode="wait">
                {loadingEpisodes ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400"
                  >
                    <div className="w-7 h-7 border-2 border-[#006097] border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-mono uppercase tracking-wider">Syncing Season Catalog...</span>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="grid grid-cols-1 md:grid-cols-2 gap-4"
                  >
                    {episodes.map((ep) => (
                      <div key={ep.id} className="bg-slate-50/55 hover:bg-slate-50 border border-slate-100/80 rounded-xl overflow-hidden p-4 flex gap-4 transition duration-200">
                        {/* Episode Still image cover */}
                        <div className="w-28 h-18 bg-slate-200 rounded-lg overflow-hidden shrink-0 relative">
                          <img
                            src={ep.stillPath || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=300'}
                            alt={ep.name}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute top-1 left-1.5 bg-black/70 border border-white/10 text-[10px] font-mono text-white/90 px-1 py-0.5 rounded">
                            EP {ep.episodeNumber}
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-1.5">
                            <h4 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                              {ep.name}
                            </h4>
                            {ep.rating > 0 && (
                              <div className="flex items-center gap-0.5 text-[10px] sm:text-xs font-bold text-amber-500 shrink-0">
                                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                <span>{parseFloat(ep.rating.toString()).toFixed(1)}</span>
                              </div>
                            )}
                          </div>
                          
                          {ep.airDate && (
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                              Aired: {ep.airDate}
                            </div>
                          )}

                          <p className="text-[11px] text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                            {ep.overview || 'No description synopsis logged.'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* ==================================== WATCH TAB ==================================== */}
          {activeSubTab === 'watch' && (
            <div className="max-w-2xl mx-auto py-4">
              <div className="flex items-center gap-2 mb-6 text-[#006097]">
                <Play size={20} className="fill-current" />
                <h3 className="text-lg font-bold text-slate-950">Watch Directory & Stream Availability</h3>
              </div>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                Choose from available providers to watch <strong>{movie.title}</strong> right now. Subscriptions, logins, or purchase terms may apply on original platforms.
              </p>

              <div className="space-y-3.5">
                {[
                  { name: 'Netflix', tier: 'Streaming Plan', price: 'Free on Subscription', color: 'bg-red-600', letters: 'N', url: 'https://netflix.com' },
                  { name: 'HBO Max', tier: 'Streaming Plan', price: 'Free on Premium Sub', color: 'bg-purple-600', letters: 'H', url: 'https://max.com' },
                  { name: 'Amazon Prime Video', tier: 'Rent/Buy Store', price: 'SD/HD from $3.99', color: 'bg-blue-500', letters: 'P', url: 'https://amazon.com' },
                  { name: 'Apple iTunes TV', tier: 'Store Purchase', price: '4K Ultra purchase $14.99', color: 'bg-slate-900', letters: 'A', url: 'https://apple.com' },
                ].map((p, idx) => (
                  <a
                    key={idx}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between p-4 bg-slate-50 hover:bg-[#e1f2fa]/20 border border-slate-100 hover:border-[#b0e2f9]/50 rounded-2xl transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      {getProviderIcon(p.name, "w-10 h-10")}
                      <div>
                        <div className="text-sm font-bold text-slate-900">{p.name}</div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                          <span className="font-semibold text-slate-400">{p.tier}</span>{" "}
                          <span>‧</span> <span>{p.price}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white px-3 py-1.5 border border-slate-200 rounded-lg group-hover:text-blue-600 group-hover:border-blue-200 transition-colors">
                      Watch Now <ExternalLink size={12} />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* ==================================== AWARDS TAB ==================================== */}
          {activeSubTab === 'awards' && (
            <div className="p-4 bg-slate-50/50 border border-slate-100 rounded-2xl">
              <div className="flex items-center gap-2 mb-4 text-[#006097]">
                <Award size={20} />
                <h3 className="text-sm uppercase tracking-widest font-black text-slate-450">Awards & Accolades</h3>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Recognized Excellence & Screen Achievements</h2>
              <p className="text-xs sm:text-sm text-slate-500 mb-6 leading-relaxed">
                Featured nominations and historical visual awards won by <strong>{movie.title}</strong> across official academies, cinematic boards, and international guild festivals.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { title: 'Best Dramatic Series / Film Production', institution: 'Academy Screen Awards', category: 'Winner / Grand Jury Prize' },
                  { title: 'Outstanding Lead Performance and Directing', institution: 'Golden Circle Film Guild', category: 'Nominated / Best Cast Ensemble' },
                  { title: 'Cinematography and Art Directing Excellence', institution: 'Creative Writers & Directors Union', category: 'Winner / Gold Leaf' },
                  { title: 'Original Screenplay and Screen Adaptation', institution: 'International Screen Writers Guild', category: 'Nominated / Outstanding Script' },
                ].map((item, idx) => (
                  <div key={idx} className="bg-slate-50/70 p-4 rounded-xl flex gap-3.5 shadow-none border-none">
                    <div className="w-10 h-10 rounded-full bg-[#e1f2fa] flex items-center justify-center shrink-0 text-[#006097]">
                      <Award size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider font-mono text-slate-400">{item.institution}</div>
                      <div className="text-xs sm:text-sm font-bold text-slate-800 truncate mt-0.5">{item.title}</div>
                      <div className="text-xs text-emerald-600 font-medium mt-1">{item.category}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
