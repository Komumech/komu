import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Clock, Star, Film, Award, Play, ChevronRight, Layers, Users } from 'lucide-react';

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

export default function MovieSection({ movie }: MovieSectionProps) {
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [episodes, setEpisodes] = useState<Episode[]>(movie.episodes || []);
  const [loadingEpisodes, setLoadingEpisodes] = useState<boolean>(false);

  // Synchronize episodes state on initial load or movie change
  useEffect(() => {
    setEpisodes(movie.episodes || []);
    setSelectedSeason(1);
  }, [movie]);

  // Fetch episodes dynamically when season changes (only for TV Shows)
  useEffect(() => {
    if (movie.mediaType === 'tv' && selectedSeason > 0) {
      // Avoid fetching if we already have this season loaded on initial data
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

  const year = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : 'N/A';

  return (
    <motion.div
      id="movie-section-container"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="w-full bg-stone-900 border border-stone-800 text-stone-100 rounded-2xl overflow-hidden shadow-2xl relative mb-8"
    >
      {/* Cinematic Backdrop Hero Header */}
      <div className="relative h-64 md:h-96 w-full overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src={movie.backdropPath || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=1200'}
            alt={movie.title}
            className="w-full h-full object-cover object-center filter brightness-50 contrast-110"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-stone-900/90 via-stone-900/20 to-transparent" />
        </div>

        {/* Backdrop details / floating badges */}
        <div className="absolute top-4 right-4 z-10 flex gap-2">
          <span className="px-3 py-1 bg-amber-500/90 text-stone-950 font-bold text-xs rounded-full uppercase tracking-wider shadow-md backdrop-blur-sm">
            {movie.mediaType === 'movie' ? 'Feature Film' : 'TV Series'}
          </span>
          <span className="px-3 py-1 bg-stone-800/80 border border-stone-700 text-stone-300 font-medium text-xs rounded-full shadow-md backdrop-blur-sm">
            {movie.status}
          </span>
        </div>
      </div>

      {/* Main Container */}
      <div className="px-6 md:px-8 pb-8 relative z-10 -mt-24 md:-mt-36">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Left Side: Floating Poster Column */}
          <div className="md:col-span-1 flex flex-col items-center md:items-start">
            <motion.div
              whileHover={{ y: -8 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              className="w-48 md:w-full aspect-[2/3] bg-stone-950 border-2 border-stone-800 rounded-xl overflow-hidden shadow-2xl bg-neutral-900"
            >
              <img
                src={movie.posterPath || 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=400'}
                alt={`${movie.title} Poster`}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </motion.div>

            {/* Score & Rating summary */}
            <div className="mt-4 w-full flex items-center justify-between px-2 py-3 bg-stone-950/50 border border-stone-800/50 rounded-xl backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
                <span className="text-lg font-bold text-stone-100">{movie.rating}</span>
                <span className="text-xs text-stone-400">/10</span>
              </div>
              <span className="text-xs font-mono text-stone-400">
                {movie.voteCount?.toLocaleString() || 85} votes
              </span>
            </div>
          </div>

          {/* Right Side: Primary Info Block */}
          <div className="md:col-span-3 flex flex-col justify-end pt-4">
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white font-sans drop-shadow-sm">
              {movie.title} <span className="text-amber-500 font-normal">({year})</span>
            </h1>

            {movie.tagline && (
              <p className="mt-2 text-lg italic text-stone-300 font-medium">
                "{movie.tagline}"
              </p>
            )}

            {/* Metadata Badges */}
            <div className="flex flex-wrap items-center gap-4 mt-4 text-xs md:text-sm text-stone-300 font-medium">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-amber-500" />
                <span>{movie.releaseDate || 'N/A'}</span>
              </div>
              <div className="w-1 h-1 bg-stone-700 rounded-full" />
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-500" />
                <span>{movie.runtime}</span>
              </div>
              {movie.source && (
                <>
                  <div className="w-1 h-1 bg-stone-700 rounded-full" />
                  <span className="font-mono text-[10px] uppercase bg-stone-800 px-2 py-0.5 rounded border border-stone-700 text-stone-400">
                    Source: {movie.source === 'tmdb' ? 'TheMovieDB Live' : 'AI Synthetic'}
                  </span>
                </>
              )}
            </div>

            {/* Movie Genres Row */}
            <div className="flex flex-wrap gap-2 mt-4">
              {movie.genres?.map((genre, idx) => (
                <span
                  key={idx}
                  className="px-2.5 py-1 bg-stone-800 border border-stone-700 hover:border-amber-500/50 hover:bg-stone-800/80 text-stone-300 text-xs rounded-md transition"
                >
                  {genre}
                </span>
              ))}
            </div>

            {/* Show / Film Overview plot */}
            <div className="mt-6">
              <h3 className="text-sm uppercase tracking-widest text-amber-500 font-bold mb-2">Synopsis</h3>
              <p className="text-stone-300 leading-relaxed text-sm md:text-base">
                {movie.overview || 'No description available.'}
              </p>
            </div>
          </div>
        </div>

        {/* Cast Members section */}
        {movie.cast && movie.cast.length > 0 && (
          <div className="mt-12 border-t border-stone-800/80 pt-8" id="movie-cast-section">
            <div className="flex items-center gap-2 mb-6">
              <Users className="w-5 h-5 text-amber-500" />
              <h3 className="text-lg font-bold text-white tracking-tight">Casting & Crew</h3>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-stone-800 scrollbar-track-transparent">
              {movie.cast.map((actor, idx) => (
                <motion.div
                  key={idx}
                  whileHover={{ scale: 1.03 }}
                  className="w-32 flex-shrink-0 bg-stone-950/60 border border-stone-850 p-2 rounded-xl text-center"
                >
                  <div className="w-full aspect-[1/1] rounded-lg overflow-hidden bg-stone-900 mb-2.5">
                    <img
                      src={actor.profilePath}
                      alt={actor.name}
                      className="w-full h-full object-cover object-top filter brightness-95"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="text-xs font-semibold text-white line-clamp-1">{actor.name}</div>
                  <div className="text-[10px] text-stone-400 line-clamp-1 mt-0.5">{actor.character}</div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Dynamic Series Episode Guide (only for TV Shows) */}
        {movie.mediaType === 'tv' && movie.seasons && movie.seasons.length > 0 && (
          <div className="mt-12 border-t border-stone-800/80 pt-8" id="tv-show-episodes-section">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-500" />
                <h3 className="text-lg font-bold text-white tracking-tight">Episode Directory</h3>
              </div>
              
              {/* Season dropdown selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-400 uppercase font-mono">Season Selection:</span>
                <select
                  value={selectedSeason}
                  onChange={(e) => setSelectedSeason(Number(e.target.value))}
                  className="bg-stone-950 border border-stone-800 rounded-lg text-xs py-1.5 px-3 focus:outline-none focus:border-amber-500 text-stone-100"
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
            </div>

            {/* List of episodes */}
            <AnimatePresence mode="wait">
              {loadingEpisodes ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-12 gap-2 text-stone-400"
                >
                  <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-mono uppercase tracking-wider">Syncing Episode Guild...</span>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="grid grid-cols-1 md:grid-cols-2 gap-4"
                >
                  {episodes.length > 0 ? (
                    episodes.map((ep, idx) => (
                      <div
                        key={idx}
                        className="bg-stone-950/40 hover:bg-stone-950/70 border border-stone-850 rounded-xl overflow-hidden p-3.5 flex gap-4 transition duration-200 group"
                      >
                        {/* Still cover preview */}
                        <div className="w-32 h-20 bg-stone-900 rounded-lg overflow-hidden flex-shrink-0 relative">
                          <img
                            src={ep.stillPath || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=300'}
                            alt={`Episode ${ep.episodeNumber}`}
                            className="w-full h-full object-cover filter brightness-90 group-hover:scale-105 transition duration-300"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute top-1 left-1.5 bg-stone-950/80 backdrop-blur-sm border border-stone-800 text-[10px] font-mono text-stone-200 px-1 py-0.5 rounded">
                            EP {ep.episodeNumber}
                          </div>
                        </div>

                        {/* Title & Plot Recap */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-1">
                            <h4 className="text-sm font-bold text-white group-hover:text-amber-400 transition truncate">
                              {ep.name}
                            </h4>
                            {ep.rating > 0 && (
                              <div className="flex items-center gap-1 text-[11px] font-bold text-amber-400 shrink-0">
                                <Star className="w-3 h-3 fill-amber-400" />
                                <span>{parseFloat(ep.rating.toString()).toFixed(1)}</span>
                              </div>
                            )}
                          </div>
                          
                          {ep.airDate && (
                            <div className="text-[10px] text-stone-400 font-mono mt-0.5">
                              Aired: {ep.airDate}
                            </div>
                          )}

                          <p className="text-xs text-stone-300 mt-2 line-clamp-2 leading-relaxed">
                            {ep.overview || 'No description synopsis currently logged.'}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-full text-center py-8 text-stone-500 text-xs font-mono uppercase">
                      No episodes discovered in this season.
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}
