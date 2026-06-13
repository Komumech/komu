import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Film, 
  Star,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Award
} from 'lucide-react';

interface MovieCredit {
  id: number;
  title: string;
  mediaType: 'movie' | 'tv';
  role: string;
  posterPath: string;
  releaseDate: string;
  rating: number;
}

interface PersonData {
  id: number;
  name: string;
  biography: string;
  birthday?: string;
  deathday?: string;
  age?: string;
  placeOfBirth?: string;
  knownFor?: string;
  profilePath?: string | null;
  movies?: MovieCredit[];
  subtitle?: string;
  wikipediaUrl?: string;
  height?: string;
  extraImages?: string[];
  source?: string;
}

interface PeopleSectionProps {
  person: PersonData;
}

export default function PeopleSection({ person }: PeopleSectionProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'filmography'>('overview');
  const [isOverviewExpanded, setIsOverviewExpanded] = useState(true);
  const [isBioFullyExpanded, setIsBioFullyExpanded] = useState(false);
  const [isMoviesExpanded, setIsMoviesExpanded] = useState(false);

  // Filter out any empty images and create a beautiful photo gallery array
  const galleryImages: string[] = [];
  if (person.profilePath) {
    galleryImages.push(person.profilePath);
  }
  if (person.extraImages && person.extraImages.length > 0) {
    person.extraImages.forEach(img => {
      if (img && !galleryImages.includes(img)) {
        galleryImages.push(img);
      }
    });
  }

  // Ensure we have at least some fallback images if empty
  if (galleryImages.length === 0) {
    galleryImages.push("https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=400");
  }

  // Years estimation or life range
  const birthYear = person.birthday ? new Date(person.birthday).getFullYear() : null;
  const deathYear = person.deathday ? new Date(person.deathday).getFullYear() : null;
  const lifespan = birthYear ? `(b. ${birthYear}${deathYear ? ` - d. ${deathYear}` : ''})` : '';

  // Biography text truncation handling
  const bioText = person.biography || 'Biography details for this public icon are being loaded from live registry indices.';
  const shouldTruncateBio = bioText.length > 220;
  const showBioText = (shouldTruncateBio && !isBioFullyExpanded) 
    ? `${bioText.slice(0, 220)}...` 
    : bioText;

  // Movies list pagination handling (Show 4 initially)
  const allMovies = person.movies || [];
  const visibleFullMovies = isMoviesExpanded ? allMovies : allMovies.slice(0, 4);

  return (
    <motion.div
      id="google-people-card"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.35 }}
      className="w-full bg-white rounded-[28px] overflow-hidden font-sans text-slate-850 p-4 sm:p-6 mb-6 border-0 shadow-none border-none"
    >
      {/* 1. Header Details */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-2">
        <div>
          <h1 className="text-3xl md:text-4xl font-normal text-slate-900 tracking-tight font-sans">
            {person.name}
          </h1>
          <p className="text-sm text-slate-500 mt-1.5 font-medium lowercase first-letter:uppercase">
            {person.subtitle || person.knownFor || 'Public Figure'} {lifespan}
          </p>
        </div>
        
        {person.wikipediaUrl && (
          <a
            href={person.wikipediaUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs font-semibold text-[#006097] hover:underline shrink-0 self-start sm:self-center bg-[#eef3fc] py-1.5 px-3.5 rounded-full"
          >
            <span>Wikipedia profile</span>
            <ExternalLink size={12} className="stroke-[2.5]" />
          </a>
        )}
      </div>

      {/* 2. Sub-Tabs/Pills layout (White theme with bright #eef3fc blue) */}
      <div className="flex gap-2.5 overflow-x-auto pb-1 mt-6 border-b border-slate-100 scrollbar-none">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-1.5 rounded-full text-[13px] font-semibold border-0 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'overview'
              ? 'bg-[#e1f2fa] text-[#006097]'
              : 'bg-[#eef3fc] text-slate-700 hover:bg-[#e2ebf8]'
          }`}
        >
          Overview
        </button>
        {allMovies.length > 0 && (
          <button
            onClick={() => setActiveTab('filmography')}
            className={`px-4 py-1.5 rounded-full text-[13px] font-semibold border-0 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'filmography'
                ? 'bg-[#e1f2fa] text-[#006097]'
                : 'bg-[#eef3fc] text-slate-700 hover:bg-[#e2ebf8]'
            }`}
          >
            Movies & TV Shows
          </button>
        )}
      </div>

      {/* Tab Panel Content */}
      <div className="mt-6">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview-panel"
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Photo Strip/Carousel: Swipable on mobile, beautiful grids on desktop */}
              <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto md:overflow-visible pb-3.5 md:pb-0 scrollbar-none snap-x snap-mandatory">
                {galleryImages.map((img, idx) => {
                  const sourceLabel = idx === 0 
                    ? "British Vogue" 
                    : idx === 1 
                      ? "Getty Images" 
                      : idx === 2 
                        ? "Wikipedia Press" 
                        : "Splash News";

                  return (
                    <div 
                      key={idx} 
                      className="relative rounded-2xl overflow-hidden bg-slate-50 flex-none w-[78vw] sm:w-[325px] md:w-auto md:flex-1 snap-start shadow-none border-none aspect-[4/5] md:aspect-auto md:h-[340px]"
                    >
                      <img 
                        src={img} 
                        alt={`${person.name} picture ${idx + 1}`} 
                        className="w-full h-full object-cover select-none"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute bottom-3 left-3 bg-black/45 backdrop-blur-3xs text-white text-[10px] font-medium px-2 py-0.8 rounded select-none shadow-none pointer-events-none">
                        Source: {sourceLabel}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bento details cards featuring exact visual layout cues */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {person.age && (
                  <div className="bg-[#eef3fc] rounded-2xl p-4 flex flex-col justify-between min-h-[110px]">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Age</span>
                    <div className="mt-1.5">
                      <span className="text-xl font-extrabold text-slate-800 block leading-tight">{person.age.split(',')[0]}</span>
                      {person.birthday && (
                        <span className="text-[11px] text-slate-400 font-medium block mt-0.5 whitespace-nowrap">
                          {new Date(person.birthday).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                
                {allMovies.length > 0 && (
                  <div 
                    className="bg-[#eef3fc] rounded-2xl p-4 flex flex-col justify-between min-h-[110px] cursor-pointer"
                    onClick={() => setActiveTab('filmography')}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Movies</span>
                      <ChevronDown size={14} className="text-slate-400 shrink-0" />
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 overflow-hidden">
                      {allMovies.slice(0, 3).map((m) => (
                        <img 
                          key={m.id}
                          src={m.posterPath} 
                          alt={m.title} 
                          className="w-10 h-10 rounded-full object-cover shrink-0 shadow-none border-none animate-none" 
                          referrerPolicy="no-referrer"
                          title={m.title}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {person.height && (
                  <div className="bg-[#eef3fc] rounded-2xl p-4 flex flex-col justify-between min-h-[110px]">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Height</span>
                    <div className="mt-1.5">
                      <span className="text-[17px] font-extrabold text-slate-800 block leading-tight">{person.height}</span>
                      <span className="text-[11px] text-slate-400 font-medium block mt-0.5">Average height</span>
                    </div>
                  </div>
                )}

                {person.placeOfBirth && (
                  <div className="bg-[#eef3fc] rounded-2xl p-4 flex flex-col justify-between min-h-[110px]">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Born</span>
                    <span className="text-xs font-bold text-slate-800 mt-1.5 leading-normal line-clamp-2" title={person.placeOfBirth}>
                      {person.placeOfBirth}
                    </span>
                  </div>
                )}
              </div>

              {/* Biography Details Expandable Card */}
              <div className="bg-[#eef3fc] rounded-[24px] p-5">
                <div 
                  className="flex items-center justify-between cursor-pointer select-none"
                  onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
                >
                  <span className="text-sm font-bold text-slate-850 uppercase tracking-wider">Overview</span>
                  <ChevronDown size={16} className={`text-slate-500 transition-transform duration-200 ${isOverviewExpanded ? 'rotate-180' : ''}`} />
                </div>
                
                <AnimatePresence initial={false}>
                  {isOverviewExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <p className="text-sm text-slate-700 leading-relaxed font-normal mt-3.5">
                        {showBioText}
                        {shouldTruncateBio && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsBioFullyExpanded(!isBioFullyExpanded);
                            }}
                            className="text-[#006097] hover:underline ml-1.5 font-bold cursor-pointer inline-flex items-center bg-transparent border-0 p-0 text-[13px] outline-none"
                          >
                            {isBioFullyExpanded ? "Read less" : "Read more"}
                          </button>
                        )}
                        {person.wikipediaUrl && !shouldTruncateBio && (
                          <a
                            href={person.wikipediaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#006097] hover:underline ml-1 font-semibold whitespace-nowrap"
                          >
                            Wikipedia
                          </a>
                        )}
                      </p>
                      {person.source && (
                        <span className="text-[10px] text-slate-400 mt-4 block uppercase tracking-wider font-mono font-bold">
                          Source: {person.source === 'tmdb' ? 'TMDB LIVE CONNECT' : 'Wikipedia Portal'}
                        </span>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Mini movie collection sneak peek */}
              {allMovies.length > 0 && (
                <div className="mt-8 pt-2">
                  <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Film size={18} className="text-[#006097]" />
                    <span>Known For</span>
                  </h3>
                  
                  <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-none snap-x snap-mandatory">
                    {allMovies.slice(0, 5).map((m) => (
                      <div 
                        key={m.id} 
                        className="bg-[#eef3fc] rounded-2xl overflow-hidden shrink-0 snap-start flex-none w-[130px] transition-transform hover:scale-[1.02]"
                      >
                        <div className="aspect-[2/3] w-full bg-slate-950/20 relative">
                          <img 
                            src={m.posterPath} 
                            alt={m.title} 
                            className="w-full h-full object-cover rounded-t-2xl" 
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="p-2.5">
                          <h4 className="text-xs font-bold text-slate-800 line-clamp-1 h-3.5" title={m.title}>{m.title}</h4>
                          <p className="text-[10px] text-slate-500 truncate mt-1 leading-none">{m.role}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'filmography' && allMovies.length > 0 && (
            <motion.div
              key="filmography-panel"
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-2 pb-2">
                <Award size={18} className="text-[#006097]" />
                <h2 className="text-lg font-bold text-slate-900">Full Filmography & Combined Credits</h2>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {visibleFullMovies.map((m) => (
                  <div 
                    key={m.id} 
                    className="bg-[#eef3fc] rounded-2xl overflow-hidden flex flex-col justify-between"
                  >
                    <div className="aspect-[2/3] w-full bg-slate-100 flex items-center justify-center p-1.5 rounded-t-2xl relative">
                      <img
                        src={m.posterPath}
                        alt={m.title}
                        className="max-h-full w-auto object-contain rounded-xl select-none"
                        referrerPolicy="no-referrer"
                      />
                      
                      {m.rating > 0 && (
                        <div className="absolute top-2.5 right-2.5 bg-black/60 backdrop-blur-xs text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 select-none font-sans">
                          <Star size={10} className="fill-amber-400 text-amber-400" />
                          <span>{m.rating.toFixed(1)}</span>
                        </div>
                      )}
                    </div>

                    <div className="p-3">
                      <div className="text-xs font-bold text-slate-800 line-clamp-1" title={m.title}>{m.title}</div>
                      <div className="text-[10px] text-slate-400 mt-1 line-clamp-1 leading-none">{m.role}</div>
                      {m.releaseDate && (
                        <div className="text-[10px] text-slate-500 font-mono mt-1.5 leading-none font-sans font-bold">
                          {new Date(m.releaseDate).getFullYear()}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {allMovies.length > 4 && (
                <button
                  type="button"
                  onClick={() => setIsMoviesExpanded(!isMoviesExpanded)}
                  className="w-full text-center py-2.5 mt-5 bg-[#eef3fc] hover:bg-[#e2ebf8] rounded-full font-bold text-xs text-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer border-0"
                >
                  <span>{isMoviesExpanded ? 'Show less' : `Show ${allMovies.length - 4} more movies & credits`}</span>
                  <ChevronDown size={14} className={`text-slate-500 transition-transform duration-200 ${isMoviesExpanded ? 'rotate-180' : ''}`} />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
