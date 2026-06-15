import React, { useState } from 'react';
import { ChevronRight, Calendar, Trophy, Users, Newspaper, Award, ArrowRight } from 'lucide-react';

interface Team {
  name: string;
  flag: string;
  score?: number;
}

interface Match {
  group: string;
  team1: Team;
  team2: Team;
  status: string;
  time: string;
}

interface TableRow {
  rank: number;
  flag: string;
  team: string;
  mp: number;
  w: number;
  d: number;
  l: number;
  gd: number;
  pts: number;
}

interface SportsData {
  title: string;
  matches: Match[];
  table: TableRow[];
  news: {
    source: string;
    headline: string;
    time: string;
    live: boolean;
  };
}

interface SportsSectionProps {
  sports: SportsData;
}

export default function SportsSection({ sports }: SportsSectionProps) {
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'matches' | 'table' | 'knockout' | 'stats' | 'players'>('overview');

  const rawTitle = sports?.title || '';
  const cleanSportText = (txt: string) => {
    if (!txt) return '';
    return txt
      .replace(/\s*\b(Live\s+)?Match\s+Cent(er|re)\b/gi, '')
      .replace(/\s*\bLive\b/gi, '')
      .replace(/\s*[|·-]\s*$/gi, '')
      .trim();
  };
  const title = cleanSportText(rawTitle);
  const { matches = [], table = [], news } = sports;

  // Render stats mock data
  const topScorers = [
    { name: "Kylian Mbappé", team: "France", goals: 5, assists: 2, matches: 4 },
    { name: "Harry Kane", team: "England", goals: 4, assists: 1, matches: 4 },
    { name: "Erling Haaland", team: "Norway", goals: 4, assists: 0, matches: 3 },
    { name: "Lionel Messi", team: "Argentina", goals: 3, assists: 3, matches: 4 },
    { name: "Bukayo Saka", team: "England", goals: 3, assists: 2, matches: 4 }
  ];

  // Render featured players mock data
  const featuredPlayers = [
    { name: "Jude Bellingham", pos: "Midfielder", age: 22, club: "Real Madrid", rate: "9.1/10" },
    { name: "Vinicius Junior", pos: "Forward", age: 25, club: "Real Madrid", rate: "8.9/10" },
    { name: "Kevin De Bruyne", pos: "Midfielder", age: 34, club: "Man City", rate: "8.8/10" },
    { name: "Lamine Yamal", pos: "Forward", age: 18, club: "Barcelona", rate: "8.7/10" }
  ];

  // Knockout Bracket Mock Data
  const bracket = {
    quarters: [
      { id: 1, team1: "Germany 🇩🇪", score1: 2, team2: "Portugal 🇵🇹", score2: 1, date: "Jul 4" },
      { id: 2, team1: "France 🇫🇷", score1: 3, team2: "Spain 🇪🇸", score2: 2, date: "Jul 4" },
      { id: 3, team1: "England 🏴󠁧󠁢󠁥󠁮󠁧󠁿", score1: 1, team2: "Italy 🇮🇹", score2: 0, date: "Jul 5" },
      { id: 4, team1: "Argentina 🇦🇷", score1: 2, team2: "Brazil 🇧🇷", score2: 1, date: "Jul 5" }
    ],
    semis: [
      { id: 5, team1: "Germany 🇩🇪", score1: 1, team2: "France 🇫🇷", score2: 2, date: "Jul 8" },
      { id: 6, team1: "England 🏴󠁧󠁢󠁥󠁮󠁧󠁿", score1: 2, team2: "Argentina 🇦🇷", score2: 3, date: "Jul 9" }
    ],
    final: { team1: "France 🇫🇷", score1: 3, team2: "Argentina 🇦🇷", score2: 1, winner: "France 🇫🇷", date: "Jul 12" }
  };

  const getSportEmoji = (sportTitle: string) => {
    const t = sportTitle.toLowerCase();
    if (t.includes('basketball') || t.includes('nba') || t.includes('fiba')) return '🏀';
    if (t.includes('tennis') || t.includes('wimbledon') || t.includes('us open')) return '🎾';
    if (t.includes('cricket') || t.includes('ipl') || t.includes('t20')) return '🏏';
    if (t.includes('baseball') || t.includes('mlb')) return '⚾';
    if (t.includes('american football') || t.includes('nfl') || t.includes('super bowl')) return '🏈';
    if (t.includes('rugby')) return '🏉';
    if (t.includes('golf')) return '⛳';
    if (t.includes('volleyball')) return '🏐';
    return '⚽'; // Default
  };

  return (
    <div id="sports-tournament-card" className="bg-white rounded-[28px] p-1 sm:p-2 md:p-3 mb-6 select-none overflow-hidden border-0">
      {/* 1. Header with Tournament Name */}
      <div className="px-3.5 sm:px-5 pt-3.5 pb-1.5 flex items-center justify-between">
        <h2 className="text-xl md:text-2xl font-bold font-display text-slate-900 tracking-tight flex items-center gap-2">
          {getSportEmoji(title)} {title}
        </h2>
      </div>

      {/* 2. Google Search Style Sports Sub-Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none px-3.5 sm:px-4 py-1.5">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'matches', label: 'Matches' },
          { id: 'table', label: 'Table' },
          { id: 'knockout', label: 'Knockout' },
          { id: 'stats', label: 'Stats' },
          { id: 'players', label: 'Players' }
        ].map(subTab => (
          <button
            key={subTab.id}
            onClick={() => setActiveSubTab(subTab.id as any)}
            className={`cursor-pointer whitespace-nowrap text-xs sm:text-sm font-semibold px-3.5 py-1.5 rounded-full transition-all border-0 bg-transparent ${
              activeSubTab === subTab.id
                ? 'bg-[#eef3fc] text-blue-700 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            {subTab.label}
          </button>
        ))}
      </div>

      <div className="p-2 sm:p-4 md:p-5">
        {/* --- T1. OVERVIEW SCREEN --- */}
        {activeSubTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 border-0">
            {/* Matches & Fixtures block */}
            <div className="lg:col-span-7 flex flex-col gap-3.5 border-0">
              <div className="flex items-center justify-between border-0">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Matches · Group Stage</span>
                <button 
                  onClick={() => setActiveSubTab('matches')} 
                  className="cursor-pointer text-xs font-bold text-blue-600 flex items-center gap-0.5 hover:underline border-0 bg-transparent"
                >
                  View full schedule <ChevronRight size={13} />
                </button>
              </div>

              {/* Grid of matches */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-0">
                {matches.slice(0, 4).map((match, i) => (
                  <div key={i} className="bg-[#eef3fc] text-slate-900 rounded-2xl p-4.5 flex flex-col justify-between min-h-[125px] transition-transform hover:scale-[1.01] border-0">
                    <div className="text-[10px] font-bold text-blue-755 tracking-wider uppercase mb-2">
                      {match.group}
                    </div>
                    
                    <div className="space-y-2">
                      {/* Team 1 */}
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 font-bold text-slate-900">
                          <span className="text-lg">{match.team1.flag}</span>
                          <span className="truncate max-w-[130px]">{match.team1.name}</span>
                        </div>
                        {match.team1.score !== undefined && (
                          <span className="font-extrabold text-base text-blue-900">{match.team1.score}</span>
                        )}
                      </div>
                      
                      {/* Team 2 */}
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 font-bold text-slate-900">
                          <span className="text-lg">{match.team2.flag}</span>
                          <span className="truncate max-w-[130px]">{match.team2.name}</span>
                        </div>
                        {match.team2.score !== undefined && (
                          <span className="font-extrabold text-base text-blue-900">{match.team2.score}</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3.5 pt-2 flex items-center justify-between text-[11px] border-0">
                      <span className="font-bold bg-white text-blue-750 px-2 py-0.5 rounded-full shadow-xs border-0 select-none">
                        {match.status}
                      </span>
                      <span className="text-blue-700 font-bold">
                        {match.time}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <button 
                onClick={() => setActiveSubTab('matches')}
                className="cursor-pointer w-full mt-1 bg-[#eef3fc] hover:bg-blue-100/50 text-blue-700 rounded-xl py-3 font-semibold text-center transition-colors text-sm flex items-center justify-center gap-1.5 border-0"
              >
                Full match schedule <ArrowRight size={14} />
              </button>
            </div>

            {/* Table Standings & News feeds */}
            <div className="lg:col-span-5 flex flex-col gap-5 border-0">
              {/* Standings Teaser */}
              <div className="flex flex-col gap-2 border-0">
                <div className="flex items-center justify-between border-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Standings · Group A</span>
                  <button 
                    onClick={() => setActiveSubTab('table')} 
                    className="cursor-pointer text-xs font-bold text-blue-600 flex items-center gap-0.5 hover:underline border-0 bg-transparent"
                  >
                    View league table <ChevronRight size={13} />
                  </button>
                </div>

                <div className="bg-[#eef3fc] text-slate-900 rounded-2xl overflow-hidden shadow-xs border-0">
                  <div className="overflow-x-auto w-full">
                    <div className="min-w-[340px] md:min-w-full">
                      <table className="w-full text-left text-xs border-0">
                        <thead>
                          <tr className="bg-blue-100/40 text-blue-900 font-bold uppercase tracking-wider border-0">
                            <th className="py-2.5 px-3 w-[6%] border-0">#</th>
                            <th className="py-2.5 px-1 border-0">{title.toLowerCase().includes('tennis') || title.toLowerCase().includes('wimbledon') ? 'Player' : 'Team'}</th>
                            <th className="py-2.5 px-2 text-center w-[10%] border-0">MP</th>
                            <th className="py-2.5 px-2 text-center w-[10%] border-0">{title.toLowerCase().includes('tennis') || title.toLowerCase().includes('wimbledon') ? 'Sets' : 'GD'}</th>
                            <th className="py-2.5 px-3 text-right w-[15%] border-0">{title.toLowerCase().includes('basketball') || title.toLowerCase().includes('nba') ? 'Wins' : 'Pts'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-none border-0">
                          {table.slice(0, 4).map((row) => (
                            <tr key={row.rank} className="hover:bg-blue-100/30 transition-colors border-0">
                              <td className="py-2.5 px-3 font-black text-blue-705 border-0">{row.rank}</td>
                              <td className="py-2.5 px-1 font-bold border-0 text-slate-900">
                                <span className="mr-1.5 text-base">{row.flag}</span>
                                <span>{row.team}</span>
                              </td>
                              <td className="py-2.5 px-2 text-center text-slate-600 font-bold border-0">{row.mp}</td>
                              <td className="py-2.5 px-2 text-center font-mono font-bold text-blue-750 border-0">
                                {row.gd > 0 ? `+${row.gd}` : row.gd}
                              </td>
                              <td className="py-2.5 px-3 text-right font-black text-blue-900 border-0">{row.pts}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              {/* News Highlights */}
              <div className="flex flex-col gap-2 border-0">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Featured Sports Feed</span>
                <div className="bg-[#eef3fc] text-slate-900 rounded-2xl p-4 shadow-xs flex gap-3.5 items-start border-0">
                  <div className="p-2.5 bg-white text-blue-600 rounded-xl flex items-center justify-center shrink-0 border-0 shadow-xs">
                    <Newspaper size={20} />
                  </div>
                  <div className="border-0">
                    <div className="flex items-center gap-1.5 mb-1 select-none border-0">
                      <span className="text-[11px] font-extrabold tracking-wider text-blue-700 uppercase">{news.source}</span>
                      {news.live && (
                        <span className="bg-red-500 text-white text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border-0">
                          LIVE
                        </span>
                      )}
                    </div>
                    <h4 className="text-sm font-bold leading-snug text-slate-900">
                      {news.headline}
                    </h4>
                    <span className="text-[10px] text-slate-500 mt-1.5 block">
                      {news.time}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- T2. MATCHES SCREEN --- */}
        {activeSubTab === 'matches' && (
          <div className="space-y-4 border-0">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5 mb-2 border-0">
              <Calendar size={16} /> Complete Fixtures Summary
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 border-0">
              {matches.map((match, i) => (
                <div key={i} className="bg-[#eef3fc] text-slate-900 rounded-2xl p-4.5 shadow-xs transition-transform hover:scale-[1.01] border-0">
                  <div className="flex items-center justify-between text-xs text-blue-700 font-bold uppercase tracking-wider mb-3 border-0">
                    <span>{match.group}</span>
                    <span className="bg-white text-blue-800 px-2 py-0.5 rounded shadow-xs text-[10px] border-0 font-bold">
                      {match.status}
                    </span>
                  </div>
                  
                  <div className="space-y-2.5 py-1 border-0">
                    {/* Team 1 */}
                    <div className="flex items-center justify-between border-0">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <span className="text-xl">{match.team1.flag}</span>
                        <span>{match.team1.name}</span>
                      </div>
                      {match.team1.score !== undefined ? (
                        <span className="font-extrabold text-base text-blue-900">{match.team1.score}</span>
                      ) : (
                        <span className="text-sm text-slate-400">-</span>
                      )}
                    </div>
                    
                    {/* Team 2 */}
                    <div className="flex items-center justify-between border-0">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <span className="text-xl">{match.team2.flag}</span>
                        <span>{match.team2.name}</span>
                      </div>
                      {match.team2.score !== undefined ? (
                        <span className="font-extrabold text-base text-blue-900">{match.team2.score}</span>
                      ) : (
                        <span className="text-sm text-slate-400">-</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 flex items-center justify-between text-xs text-slate-500 font-bold border-0">
                    <span>Fixture Status</span>
                    <span className="font-bold text-blue-700 bg-white shadow-xs px-2.5 py-0.5 rounded-full border-0">
                      {match.time}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- T3. LEAGUE TABLE SCREEN --- */}
        {activeSubTab === 'table' && (
          <div className="space-y-4 border-0">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5 mb-2 border-0">
              <Trophy size={16} /> Tournament Group Stage Standings
            </h3>
            <div className="bg-[#eef3fc] text-slate-900 rounded-3xl overflow-hidden shadow-xs border-0">
              <div className="overflow-x-auto w-full">
                <div className="min-w-[550px] md:min-w-full">
                  <table className="w-full text-left border-collapse border-0">
                    <thead>
                      <tr className="bg-blue-100/40 text-blue-900 font-bold text-xs uppercase tracking-wider border-0">
                        <th className="py-3 px-4 w-[6%] text-center border-0">Rank</th>
                        <th className="py-3 px-2 border-0">Team</th>
                        <th className="py-3 px-3 text-center border-0">Played</th>
                        <th className="py-3 px-3 text-center border-0">Won</th>
                        <th className="py-3 px-3 text-center border-0">Draw</th>
                        <th className="py-3 px-3 text-center border-0">Lost</th>
                        <th className="py-3 px-3 text-center border-0">GD</th>
                        <th className="py-3 px-4 text-right border-0">Points</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm border-0">
                      {table.map((row) => (
                        <tr key={row.rank} className="hover:bg-blue-100/30 transition-colors border-0">
                          <td className="py-3 px-4 text-center font-bold text-blue-700 border-0">{row.rank}</td>
                          <td className="py-3 px-2 font-bold border-0 text-slate-900">
                            <span className="mr-2.5 text-lg">{row.flag}</span>
                            <span>{row.team}</span>
                          </td>
                          <td className="py-3 px-3 text-center text-slate-600 font-bold border-0">{row.mp}</td>
                          <td className="py-3 px-3 text-center text-slate-500 font-semibold border-0">{row.w}</td>
                          <td className="py-3 px-3 text-center text-slate-500 font-semibold border-0">{row.d}</td>
                          <td className="py-3 px-3 text-center text-slate-500 font-semibold border-0">{row.l}</td>
                          <td className="py-3 px-3 text-center font-mono font-bold text-blue-800 border-0">
                            {row.gd > 0 ? `+${row.gd}` : row.gd}
                          </td>
                          <td className="py-3 px-4 text-right font-black bg-blue-100/30 text-blue-900 border-0">{row.pts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 italic border-0">
              * Top two teams from each group stage bracket qualify directly to the Knockout Bracket phase.
            </p>
          </div>
        )}

        {/* --- T4. INTERACTIVE KNOCKOUT BRACKET SCREEN --- */}
        {activeSubTab === 'knockout' && (
          <div className="space-y-4 border-0">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5 mb-2 border-0">
              <Award size={16} /> Tournament Bracket (Knockout Finals)
            </h3>
            
            <div className="bg-[#eef3fc] rounded-3xl p-5 md:p-6 overflow-x-auto scrollbar-none shadow-xs border-0">
              <div className="flex gap-8 justify-between items-center min-w-[580px] border-0">
                {/* Quarters Round */}
                <div className="flex flex-col gap-6 w-1/3 border-0">
                  <div className="text-[10px] font-bold tracking-wider text-blue-700 uppercase text-center mb-1 border-0">Quarter Finals</div>
                  <div className="space-y-4 border-0">
                    {bracket.quarters.map((game) => (
                      <div key={game.id} className="bg-white text-slate-900 p-3 rounded-xl text-xs space-y-1 shadow-xs border-0">
                        <div className="flex justify-between font-bold border-0">
                          <span>{game.team1}</span>
                          <span className="font-extrabold text-blue-900">{game.score1}</span>
                        </div>
                        <div className="flex justify-between font-bold border-0">
                          <span>{game.team2}</span>
                          <span className="font-extrabold text-blue-900">{game.score2}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Semis Round */}
                <div className="flex flex-col gap-12 w-1/3 border-0">
                  <div className="text-[10px] font-bold tracking-wider text-blue-700 uppercase text-center mb-1 border-0">Semi Finals</div>
                  <div className="space-y-10 border-0">
                    {bracket.semis.map((game) => (
                      <div key={game.id} className="bg-white text-slate-900 p-3 rounded-xl text-xs space-y-1 shadow-xs border-0">
                        <div className="flex justify-between font-bold border-0">
                          <span>{game.team1}</span>
                          <span className="font-extrabold text-blue-900">{game.score1}</span>
                        </div>
                        <div className="flex justify-between font-bold border-0">
                          <span>{game.team2}</span>
                          <span className="font-extrabold text-blue-900">{game.score2}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Grand Final & Champion */}
                <div className="flex flex-col justify-center items-center gap-4 w-1/3 border-0">
                  <div className="text-[10px] font-bold tracking-wider text-blue-700 uppercase text-center mb-1 border-0">Grand Final</div>
                  <div className="bg-gradient-to-tr from-white to-[#dfeafd] text-slate-900 rounded-2xl p-4 w-full text-center space-y-3 shadow-xs border-0">
                    <div className="text-amber-600 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1 border-0">
                      <Trophy size={14} className="fill-amber-300 stroke-amber-500 border-0" /> TOURNAMENT FINAL
                    </div>
                    <div className="space-y-1 text-sm font-black border-0 text-slate-900">
                      <div>{bracket.final.team1} ({bracket.final.score1})</div>
                      <div className="text-slate-400 text-xs font-bold">vs</div>
                      <div>{bracket.final.team2} ({bracket.final.score2})</div>
                    </div>
                    <div className="mt-3 pt-2.5 border-0">
                      <div className="text-[10px] font-bold text-blue-700 uppercase">CHAMPION</div>
                      <div className="text-sm font-black text-amber-600 font-display flex items-center justify-center gap-1.5 mt-0.5 border-0">
                        🌟 {bracket.final.winner} 🌟
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- T5. STATS SCREEN --- */}
        {activeSubTab === 'stats' && (
          <div className="space-y-4 border-0">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5 mb-2 border-0">
              <Award size={16} /> Player Statistics Leaders (Golden Boot)
            </h3>
            
            <div className="bg-[#eef3fc] text-slate-900 rounded-3xl overflow-hidden shadow-xs border-0">
              <div className="overflow-x-auto w-full">
                <div className="min-w-[500px] md:min-w-full">
                  <table className="w-full text-left border-0">
                    <thead>
                      <tr className="bg-blue-100/40 text-blue-900 font-bold text-xs uppercase tracking-wider border-0">
                        <th className="py-3 px-4 text-center w-[10%] border-0">Rank</th>
                        <th className="py-3 px-2 border-0">Player</th>
                        <th className="py-3 px-3 border-0">Representing</th>
                        <th className="py-3 px-3 text-center border-0">Matches</th>
                        <th className="py-3 px-3 text-center border-0">Assists</th>
                        <th className="py-3 px-4 text-right border-0">Goals Scored</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm border-0">
                      {topScorers.map((scorer, i) => (
                        <tr key={i} className="hover:bg-blue-100/30 transition-colors border-0">
                          <td className="py-3 px-4 text-center font-bold text-blue-700 border-0">{i + 1}</td>
                          <td className="py-3 px-2 font-black text-slate-900 border-0">{scorer.name}</td>
                          <td className="py-3 px-3 font-semibold text-slate-650 border-0">{scorer.team}</td>
                          <td className="py-3 px-3 text-center text-slate-650 border-0">{scorer.matches}</td>
                          <td className="py-3 px-3 text-center text-slate-650 border-0">{scorer.assists}</td>
                          <td className="py-3 px-4 text-right font-black bg-blue-100/30 text-blue-900 border-0">{scorer.goals}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- T6. PLAYERS SCREEN --- */}
        {activeSubTab === 'players' && (
          <div className="space-y-4 border-0">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5 mb-2 border-0">
              <Users size={16} /> Tournament Star Players Profile
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-0">
              {featuredPlayers.map((player, i) => (
                <div key={i} className="bg-[#eef3fc] text-slate-900 rounded-2xl p-4.5 shadow-xs flex justify-between items-center transition-transform hover:scale-[1.01] border-0">
                  <div className="border-0">
                    <div className="text-[10px] bg-white text-blue-700 py-1 px-3 rounded-full font-bold uppercase tracking-wider inline-block mb-2 border-0 shadow-xs">
                      {player.pos}
                    </div>
                    <h4 className="text-base font-bold text-slate-900">{player.name}</h4>
                    <p className="text-xs text-slate-500 mt-1 font-medium border-0">
                      Club: {player.club} · Age: {player.age}
                    </p>
                  </div>
                  <div className="text-right border-0">
                    <span className="text-[10px] text-blue-700 font-extrabold uppercase block leading-none border-0">RATING</span>
                    <span className="text-sm font-black text-amber-600 mt-1 block border-0">{player.rate}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
