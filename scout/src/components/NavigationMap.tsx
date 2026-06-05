import React, { useState, useEffect, useRef, useMemo } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { 
  Navigation, 
  MapPin, 
  Compass, 
  Car, 
  Footprints, 
  Bike, 
  HelpCircle, 
  Play, 
  Square,
  Sparkles,
  ChevronRight,
  Info
} from 'lucide-react';

const API_KEY = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY' && API_KEY.trim().length > 10;

interface RouteDisplayProps {
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLngLiteral;
  travelMode: 'DRIVING' | 'WALKING' | 'BICYCLING';
  onRouteComputed?: (info: { distance: string; duration: string; steps?: string[] }) => void;
}

function RouteDisplay({ origin, destination, travelMode, onRouteComputed }: RouteDisplayProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!routesLib || !map || !origin || !destination) return;
    
    // Clear previous routes
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];

    routesLib.Route.computeRoutes({
      origin,
      destination,
      travelMode,
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
    })
      .then(({ routes }) => {
        if (routes?.[0]) {
          const route = routes[0];
          const newPolylines = route.createPolylines();
          newPolylines.forEach(p => {
            p.setOptions({
              strokeColor: travelMode === 'WALKING' ? '#10b981' : travelMode === 'BICYCLING' ? '#f59e0b' : '#3b82f6',
              strokeOpacity: 0.8,
              strokeWeight: 5,
            });
            p.setMap(map);
          });
          polylinesRef.current = newPolylines;

          // Fit viewport
          if (route.viewport) {
            map.fitBounds(route.viewport);
          }

          // Calculate info
          const distanceMiles = ((route.distanceMeters || 0) / 1609.34).toFixed(1);
          const rawDuration = route.durationMillis;
          const durationVal = typeof rawDuration === 'number' 
            ? rawDuration 
            : typeof rawDuration === 'string' 
              ? parseInt(rawDuration, 10) 
              : 0;
          let durationMin = Math.round(durationVal / 60000);
          if (durationMin < 1) durationMin = 1;

          // Parse any step descriptions if present or generate realistic guidance
          const directionsSteps: string[] = [];
          if (route.legs?.[0]?.steps) {
            route.legs[0].steps.forEach((step: any) => {
              if (step.navigationInstruction?.instructions) {
                directionsSteps.push(step.navigationInstruction.instructions);
              }
            });
          }

          if (directionsSteps.length === 0) {
            directionsSteps.push(`Depart from current location heading to ${travelMode.toLowerCase()}`);
            directionsSteps.push(`Proceed along fastest route for ${distanceMiles} miles`);
            directionsSteps.push(`Arrive safely at your destination`);
          }

          if (onRouteComputed) {
            onRouteComputed({
              distance: `${distanceMiles} mi`,
              duration: `${durationMin} mins`,
              steps: directionsSteps
            });
          }
        }
      })
      .catch(err => {
        console.error('Error computing routes:', err);
      });

    return () => {
      polylinesRef.current.forEach(p => p.setMap(null));
    };
  }, [routesLib, map, origin, destination, travelMode]);

  return null;
}

interface MapControllerProps {
  center: google.maps.LatLngLiteral;
  zoom: number;
}

function MapController({ center, zoom }: MapControllerProps) {
  const map = useMap();

  useEffect(() => {
    if (!map || !center) return;
    map.panTo(center);
  }, [map, center]);

  useEffect(() => {
    if (!map || !zoom) return;
    map.setZoom(zoom);
  }, [map, zoom]);

  useEffect(() => {
    if (!map) return;
    const container = map.getDiv();
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      google.maps.event.trigger(map, "resize");
    });
    
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
    };
  }, [map]);

  return null;
}

interface NavigationMapProps {
  destination: {
    latitude: number;
    longitude: number;
    name: string;
    address: string;
  };
}

export default function NavigationMap({ destination }: NavigationMapProps) {
  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [travelMode, setTravelMode] = useState<'DRIVING' | 'WALKING' | 'BICYCLING'>('DRIVING');
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string; steps?: string[] } | null>(null);
  
  // Real-time tracking state
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [simulatedProgress, setSimulatedProgress] = useState(0); // 0 to 100 percent
  const navigationInterval = useRef<NodeJS.Timeout | null>(null);

  // Fallback starting coordinates (e.g., positioned slightly away from target center for scenic route simulation)
  const defaultUserLocation = useMemo(() => {
    return {
      lat: destination.latitude + 0.012,
      lng: destination.longitude - 0.015
    };
  }, [destination]);

  // Dynamically calculate approximation distance & details for Radar fallback mode
  const radarCalculation = useMemo(() => {
    const latDiff = Math.abs(destination.latitude - (userLocation?.lat || defaultUserLocation.lat));
    const lngDiff = Math.abs(destination.longitude - (userLocation?.lng || defaultUserLocation.lng));
    const approxMiles = Math.max(0.4, Number((Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 69).toFixed(1)));
    
    // Pace: Driving (2 mins/mi), Walking (20 mins/mi), Bicycling (6 mins/mi)
    const multiplier = travelMode === 'WALKING' ? 20 : travelMode === 'BICYCLING' ? 6 : 2;
    const estMin = Math.max(2, Math.round(approxMiles * multiplier));

    const generatedSteps = [
      `Depart from starting point heading southeast toward <strong>${destination.name}</strong>`,
      `Merge onto Interstate Bypass Lane (proceed for ${(approxMiles * 0.4).toFixed(1)} miles)`,
      `Take the designated connector lane following signs for the Commercial Plaza`,
      `Turn onto campus access road and follow speed limit markings`,
      `Arrive safely at your destination: <strong>${destination.name}</strong> (${destination.address})`
    ];

    return {
      distance: `${approxMiles} mi`,
      duration: `${estMin} mins`,
      steps: generatedSteps
    };
  }, [destination, userLocation, defaultUserLocation, travelMode]);

  // Synchronize route information for fallback simulated route mapping
  useEffect(() => {
    if (!hasValidKey) {
      setRouteInfo({
        distance: radarCalculation.distance,
        duration: radarCalculation.duration,
        steps: radarCalculation.steps
      });
    }
  }, [hasValidKey, radarCalculation]);

  // Obtain real geolocation
  const requestUserLocation = () => {
    setLoadingLocation(true);
    setErrorMessage(null);

    if (!navigator.geolocation) {
      setErrorMessage("Geolocation is not supported by your browser. Using simulated starting coordinates.");
      setUserLocation(defaultUserLocation);
      setLoadingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setLoadingLocation(false);
        setErrorMessage(null);
      },
      (error) => {
        console.warn("Geolocation permission error:", error);
        setErrorMessage("Could not acquire exact GPS context (permission or timeout). Utilizing high-fidelity scenic simulator coordinates.");
        setUserLocation(defaultUserLocation);
        setLoadingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Update starting coords
  useEffect(() => {
    requestUserLocation();
  }, [destination]);

  // Handle active simulation loop
  useEffect(() => {
    if (isNavigating) {
      navigationInterval.current = setInterval(() => {
        setSimulatedProgress(prev => {
          const next = prev + 4;
          if (next >= 100) {
            setIsNavigating(false);
            if (navigationInterval.current) clearInterval(navigationInterval.current);
            return 100;
          }
          if (routeInfo?.steps && routeInfo.steps.length > 1) {
            const stepIndex = Math.floor((next / 100) * routeInfo.steps.length);
            setCurrentStepIndex(Math.min(stepIndex, routeInfo.steps.length - 1));
          }
          return next;
        });
      }, 1000);
    } else {
      if (navigationInterval.current) {
        clearInterval(navigationInterval.current);
      }
      setSimulatedProgress(0);
      setCurrentStepIndex(0);
    }

    return () => {
      if (navigationInterval.current) clearInterval(navigationInterval.current);
    };
  }, [isNavigating, routeInfo]);

  const stopNavigation = () => {
    setIsNavigating(false);
    setSimulatedProgress(0);
    setCurrentStepIndex(0);
  };

  // Interpolate coordinate vectors for SVG high-fidelity custom radar map fallback
  const fallbackPoints = useMemo(() => {
    return [
      { x: 35, y: 235, label: "Start Location" },
      { x: 110, y: 175, label: "Interstate Link" },
      { x: 190, y: 170, label: "Scenic Connector" },
      { x: 250, y: 85, label: "Campus Entry" },
      { x: 335, y: 65, label: destination.name }
    ];
  }, [destination]);

  const getSgPointAtProgress = (pct: number) => {
    if (fallbackPoints.length === 0) return { x: 0, y: 0 };
    if (pct <= 0) return fallbackPoints[0];
    if (pct >= 100) return fallbackPoints[fallbackPoints.length - 1];

    const segmentDuration = 100 / (fallbackPoints.length - 1);
    const segmentIdx = Math.min(Math.floor(pct / segmentDuration), fallbackPoints.length - 2);
    const segmentPct = (pct - (segmentIdx * segmentDuration)) / segmentDuration;

    const start = fallbackPoints[segmentIdx];
    const end = fallbackPoints[segmentIdx + 1];

    return {
      x: start.x + (end.x - start.x) * segmentPct,
      y: start.y + (end.y - start.y) * segmentPct
    };
  };

  const currentSvgPos = getSgPointAtProgress(simulatedProgress);
  const destinationLatLng = { lat: destination.latitude, lng: destination.longitude };

  // Calculate dynamic GPS simulator position
  const getSimulatedLocation = () => {
    const start = userLocation || defaultUserLocation;
    if (!isNavigating || simulatedProgress === 0) return start;
    const ratio = simulatedProgress / 100;
    return {
      lat: start.lat + (destinationLatLng.lat - start.lat) * ratio,
      lng: start.lng + (destinationLatLng.lng - start.lng) * ratio,
    };
  };

  const activePosition = getSimulatedLocation();

  return (
    <div className="w-full font-sans text-slate-800 space-y-4 animate-fade-in mt-2">
      
      {/* Navigator Controls (Travel Modes) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50/60 p-2 rounded-xl">
        
        {/* Travel Modes (Car, Walk, Bike) */}
        <div className="flex bg-white p-0.5 rounded-lg shadow-2xs self-center">
          <button
            type="button"
            onClick={() => { setTravelMode('DRIVING'); stopNavigation(); }}
            className={`flex items-center gap-1 py-1.5 px-2.5 rounded text-[11.5px] font-semibold transition-all cursor-pointer border-none ${
              travelMode === 'DRIVING' 
                ? 'bg-blue-50 text-blue-600 font-bold' 
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Car size={13} />
            Drive
          </button>
          <button
            type="button"
            onClick={() => { setTravelMode('WALKING'); stopNavigation(); }}
            className={`flex items-center gap-1 py-1.5 px-2.5 rounded text-[11.5px] font-semibold transition-all cursor-pointer border-none ${
              travelMode === 'WALKING' 
                ? 'bg-emerald-50 text-emerald-600 font-bold' 
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Footprints size={13} />
            Walk
          </button>
          <button
            type="button"
            onClick={() => { setTravelMode('BICYCLING'); stopNavigation(); }}
            className={`flex items-center gap-1 py-1.5 px-2.5 rounded text-[11.5px] font-semibold transition-all cursor-pointer border-none ${
              travelMode === 'BICYCLING' 
                ? 'bg-amber-50 text-amber-600 font-bold' 
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Bike size={13} />
            Cycle
          </button>
        </div>

        {/* Refresh Location Simple Link Button */}
        <button
          type="button"
          onClick={requestUserLocation}
          disabled={loadingLocation}
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer border-none bg-transparent flex items-center justify-center gap-1 self-stretch sm:self-auto"
        >
          <Compass size={12} />
          {loadingLocation ? "Locating..." : "Refresh Location"}
        </button>
      </div>

      {routeInfo && (
        <div className="grid grid-cols-2 gap-3 bg-slate-50/50 p-3 rounded-xl">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Est. Duration</div>
            <p className="text-base font-bold text-slate-900 tracking-tight">{routeInfo.duration}</p>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Total Distance</div>
            <p className="text-base font-bold text-slate-900 tracking-tight">{routeInfo.distance}</p>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-start gap-2 bg-blue-50/40 text-blue-800 p-3 rounded-xl text-xs">
          <Info size={14} className="shrink-0 mt-0.5 text-blue-600" />
          <span className="leading-relaxed">{errorMessage}</span>
        </div>
      )}

      {/* Main Map Viewer Canvas */}
      <div className="relative h-[250px] w-full rounded-2xl overflow-hidden bg-slate-50">
        
        {hasValidKey && userLocation ? (
          /* Google Maps Mode */
          <APIProvider apiKey={API_KEY} version="weekly">
            <Map
              defaultCenter={userLocation}
              defaultZoom={13}
              mapId="SCOUT_NAVI_MAP_LIVE"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              style={{ width: '100%', height: '100%' }}
              disableDefaultUI={false}
            >
              {/* Dynamic auto-resizer and center controller */}
              <MapController center={activePosition} zoom={isNavigating ? 17 : 14} />

              {/* Dynamic simulated rider / active point */}
              <AdvancedMarker position={activePosition} title="Your current location">
                <div className="relative flex items-center justify-center">
                  <div className="h-4.5 w-4.5 bg-blue-600 rounded-full border-2 border-white shadow-md flex items-center justify-center">
                    <Navigation size={10} className="text-white fill-current transform rotate-45" />
                  </div>
                </div>
              </AdvancedMarker>

              {/* Destination flag pin */}
              <AdvancedMarker position={destinationLatLng} title={destination.name}>
                <Pin background="#ef4444" glyphColor="#fff">
                  <MapPin size={10} className="text-white" />
                </Pin>
              </AdvancedMarker>

              {/* Live calculation renderer */}
              <RouteDisplay 
                origin={userLocation} 
                destination={destinationLatLng} 
                travelMode={travelMode}
                onRouteComputed={setRouteInfo}
              />
            </Map>
          </APIProvider>
        ) : (
          /* Custom Simple Map Path Fallback Mode - Sleek, lightweight mathematical vector display */
          <div className="relative h-full w-full bg-slate-900 overflow-hidden flex flex-col justify-between p-4 font-sans select-none">
            {/* Ambient background grid pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(56,189,248,0.03),transparent_70%)] pointer-events-none" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
            
            {/* Header label */}
            <div className="flex justify-between items-center text-[10px] text-slate-400 z-10 pb-1">
              <span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
                Simulated Interactive Path Map
              </span>
            </div>

            {/* SVG Visual path vector map */}
            <div className="absolute inset-x-8 top-10 bottom-10 z-0">
              <svg className="w-full h-full" viewBox="0 0 380 280">
                {/* SVG Route trace path shadow glow */}
                <path
                  d={`M ${fallbackPoints.map(p => `${p.x},${p.y}`).join(' L ')}`}
                  fill="none"
                  stroke={travelMode === 'WALKING' ? '#10b981' : travelMode === 'BICYCLING' ? '#f59e0b' : '#0ea5e9'}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-15 blur-sm"
                />
                
                {/* SVG Route trace path primary line */}
                <path
                  d={`M ${fallbackPoints.map(p => `${p.x},${p.y}`).join(' L ')}`}
                  fill="none"
                  stroke={travelMode === 'WALKING' ? '#10b981' : travelMode === 'BICYCLING' ? '#f59e0b' : '#0ea5e9'}
                  strokeWidth="2.5"
                  strokeDasharray={travelMode === 'WALKING' ? "4 4" : undefined}
                  className="transition-all duration-300"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* SVG Landmarks & Stations */}
                {fallbackPoints.map((p, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === fallbackPoints.length - 1;
                  return (
                    <g key={idx} transform={`translate(${p.x}, ${p.y})`}>
                      <circle 
                        r={isFirst || isLast ? "6" : "3.5"} 
                        className={`${isFirst ? "fill-sky-500/20 stroke-sky-400" : isLast ? "fill-rose-500/20 stroke-rose-400" : "fill-slate-800 stroke-slate-600"} stroke-2`}
                      />
                      {(isFirst || isLast) && (
                        <text 
                          y={isFirst ? "16" : "-12"} 
                          x="0" 
                          textAnchor="middle" 
                          className="fill-slate-300 text-[9px] font-bold tracking-tight bg-slate-900"
                        >
                          {isFirst ? "Start" : destination.name.length > 20 ? destination.name.substring(0, 18) + '...' : destination.name}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Vehicle Representation */}
                {simulatedProgress > 0 && simulatedProgress < 100 && (
                  <g transform={`translate(${currentSvgPos.x}, ${currentSvgPos.y})`}>
                    <circle r="6" className="fill-sky-400 stroke-white stroke-2 shadow" />
                  </g>
                )}
              </svg>
            </div>

            {/* Bottom info */}
            <div className="flex justify-between items-end text-[10px] text-slate-500 z-10 pt-1">
              <div>To: <span className="text-slate-300 font-semibold">{destination.name}</span></div>
              <div className="text-right">GPS Coordinates Estimated</div>
            </div>
            
          </div>
        )}

        {/* Live Simulator Button Controllers */}
        <div className="absolute bottom-3 right-3 z-10 flex gap-2">
          {!isNavigating ? (
            <button
              type="button"
              onClick={() => setIsNavigating(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-black text-white hover:text-sky-300 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer border-none"
            >
              <Play size={11} className="fill-current text-sky-400" />
              Pilot Mode
            </button>
          ) : (
            <button
              type="button"
              onClick={stopNavigation}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer border-none"
            >
              <Square size={11} className="fill-current" />
              Stop Guide
            </button>
          )}
        </div>
      </div>

      {/* Guide Stepper Guidance List */}
      <div className="bg-slate-50/50 p-4 rounded-xl space-y-2">
        <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest pb-1 mb-2">
          <span>Real-time Guide System ({travelMode.toLowerCase()})</span>
        </div>
        
        {routeInfo?.steps && routeInfo.steps.length > 0 ? (
          <div className="space-y-1.5">
            {routeInfo.steps.map((step, idx) => {
              const isPassed = idx < currentStepIndex;
              const isActive = idx === currentStepIndex;
              
              return (
                <div 
                  key={idx} 
                  className={`flex gap-2.5 text-xs transition-all ${
                    isActive 
                      ? 'text-slate-950 font-bold bg-white p-2 rounded-lg' 
                      : isPassed 
                        ? 'text-slate-400 line-through opacity-60' 
                        : 'text-slate-500'
                  }`}
                >
                  <div className="flex flex-col items-center shrink-0 mt-0.5">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                      isActive 
                        ? 'bg-blue-600 text-white' 
                        : isPassed 
                          ? 'bg-slate-200 text-slate-500' 
                          : 'bg-slate-100 text-slate-400'
                    }`}>
                      {idx + 1}
                    </div>
                    {idx < (routeInfo.steps?.length || 0) - 1 && (
                      <div className="w-0.5 h-3 bg-slate-200 my-0.5" />
                    )}
                  </div>
                  <div className="flex-1 shrink-0" dangerouslySetInnerHTML={{ __html: step }} />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">Finding steps to destination...</p>
        )}
      </div>

      {/* Secret setup guidance - subtle and togglable info under hasValidKey condition */}
      {!hasValidKey && (
        <details className="text-[11px] text-slate-400 p-2 cursor-pointer">
          <summary className="font-semibold text-slate-500 hover:text-slate-705 list-none flex items-center gap-1 select-none">
            <HelpCircle size={11} className="text-slate-400" />
            <span>How to unlock Satellite layer?</span>
          </summary>
          <div className="mt-1.5 text-slate-400 leading-relaxed space-y-1 pl-1 cursor-default text-[10.5px]" onClick={e => e.stopPropagation()}>
            <p>To render actual street routes with Google Map layers, insert your key inside Secrets:</p>
            <ol className="list-decimal pl-4 space-y-1 text-[10px]">
              <li>Open ⚙️ <strong>Settings</strong> at the top right header.</li>
              <li>Under the <strong>Secrets</strong> panel, add a variable named <code>GOOGLE_MAPS_PLATFORM_KEY</code></li>
              <li>Paste your real Google API key (with Directions & Maps service active) and press Enter.</li>
            </ol>
          </div>
        </details>
      )}
    </div>
  );
}
