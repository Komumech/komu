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
  ChevronUp,
  ChevronDown,
  Info,
  X,
  Volume2,
  VolumeX,
  Search,
  TriangleAlert,
  Leaf,
  GitFork,
  ArrowUp,
  CheckCircle2,
  Layers
} from 'lucide-react';

const API_KEY = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY' && API_KEY.trim().length > 10;

// Premium minimal map styles centered around clean greys/whites and soft pale blues
const customMapStyle = [
  {
    "featureType": "all",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#748896" }]
  },
  {
    "featureType": "all",
    "elementType": "labels.text.stroke",
    "stylers": [{ "color": "#ffffff" }, { "visibility": "on" }]
  },
  {
    "featureType": "administrative",
    "elementType": "geometry.fill",
    "stylers": [{ "color": "#fefefe" }, { "lightness": 20 }]
  },
  {
    "featureType": "administrative",
    "elementType": "geometry.stroke",
    "stylers": [{ "color": "#fefefe" }, { "lightness": 17 }, { "weight": 1.2 }]
  },
  {
    "featureType": "landscape",
    "elementType": "geometry",
    "stylers": [{ "color": "#f4f6f9" }]
  },
  {
    "featureType": "landscape.man_made",
    "elementType": "geometry.fill",
    "stylers": [{ "color": "#eceff1" }]
  },
  {
    "featureType": "poi",
    "elementType": "geometry",
    "stylers": [{ "color": "#eceff1" }]
  },
  {
    "featureType": "poi.park",
    "elementType": "geometry.fill",
    "stylers": [{ "color": "#e8f5e9" }] // custom soft minty park green
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry.fill",
    "stylers": [{ "color": "#ffffff" }]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry.stroke",
    "stylers": [{ "color": "#cfd8dc" }]
  },
  {
    "featureType": "road.arterial",
    "elementType": "geometry.fill",
    "stylers": [{ "color": "#ffffff" }]
  },
  {
    "featureType": "road.local",
    "elementType": "geometry.fill",
    "stylers": [{ "color": "#ffffff" }]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [{ "color": "#e3f2fd" }] // soft ocean reflection blue
  }
];

interface RouteDisplayProps {
  origin: google.maps.LatLngLiteral;
  destination: google.maps.LatLngLiteral;
  travelMode: 'DRIVING' | 'WALKING' | 'BICYCLING';
  onRouteComputed?: (info: { distance: string; duration: string; steps?: string[] }) => void;
  isNavigating: boolean;
  simulatedProgress: number;
}

function RouteDisplay({ origin, destination, travelMode, onRouteComputed, isNavigating, simulatedProgress }: RouteDisplayProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const fitBoundsRef = useRef<string>('');
  const [routePath, setRoutePath] = useState<any[]>([]);

  useEffect(() => {
    if (!routesLib || !map || !origin || !destination) return;
    
    routesLib.Route.computeRoutes({
      origin,
      destination,
      travelMode,
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
    })
      .then(({ routes }) => {
        if (routes?.[0]) {
          const route = routes[0];
          
          if (route.path) {
            setRoutePath(route.path);
          }

          // Fit viewport ONLY once when a new route is queried to avoid fights with manual user zooming
          const routeKey = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}-${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}-${travelMode}`;
          if (fitBoundsRef.current !== routeKey) {
            if (route.viewport) {
              map.fitBounds(route.viewport);
            }
            fitBoundsRef.current = routeKey;
          }

          // Convert metric to imperial
          const distanceMiles = ((route.distanceMeters || 0) / 1609.34).toFixed(1);
          const rawDuration = route.durationMillis;
          const durationVal = typeof rawDuration === 'number' 
            ? rawDuration 
            : typeof rawDuration === 'string' 
              ? parseInt(rawDuration, 10) 
              : 0;
          let durationMin = Math.round(durationVal / 60000);
          if (durationMin < 1) durationMin = 1;

          // Steps list parsed directly for clean details tray
          const directionsSteps: string[] = [];
          if (route.legs?.[0]?.steps) {
            route.legs[0].steps.forEach((step: any) => {
              if (step.navigationInstruction?.instructions) {
                directionsSteps.push(step.navigationInstruction.instructions);
              }
            });
          }

          if (directionsSteps.length === 0) {
            directionsSteps.push(`Depart from starting position heading to ${travelMode.toLowerCase()}`);
            directionsSteps.push(`Proceed along designated optimal path for ${distanceMiles} mi`);
            directionsSteps.push(`Arrive safely at ${destination.lat.toFixed(4)}, ${destination.lng.toFixed(4)}`);
          }

          if (onRouteComputed) {
            onRouteComputed({
              distance: `${distanceMiles} km`, // standard localized label or converted
              duration: `${durationMin} min`,
              steps: directionsSteps
            });
          }
        }
      })
      .catch(err => {
        console.error('Error computing routes:', err);
      });
  }, [routesLib, map, origin, destination, travelMode]);

  // Handle dynamic path drawing and trimming
  useEffect(() => {
    if (!map) return;

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (routePath.length === 0) return;

    let displayPath = routePath;

    if (isNavigating && simulatedProgress > 0) {
      const idx = Math.min(
        Math.floor((simulatedProgress / 100) * routePath.length),
        routePath.length - 1
      );
      displayPath = routePath.slice(idx);
    }

    const p = new google.maps.Polyline({
      path: displayPath,
      strokeColor: travelMode === 'WALKING' ? '#10b981' : travelMode === 'BICYCLING' ? '#f59e0b' : '#3b51f1',
      strokeOpacity: 1.0,
      strokeWeight: 7,
      map: map
    });

    polylineRef.current = p;

    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    };
  }, [map, routePath, isNavigating, simulatedProgress, travelMode]);

  return null;
}

interface MapControllerProps {
  center: google.maps.LatLngLiteral;
  zoom: number;
  onZoomChange?: (newZoom: number) => void;
  recenterCount: number;
  heading: number;
  onHeadingChange?: (newHeading: number) => void;
  tilt: number;
  onTiltChange?: (newTilt: number) => void;
}

function MapController({ 
  center, 
  zoom, 
  onZoomChange, 
  recenterCount, 
  heading, 
  onHeadingChange, 
  tilt, 
  onTiltChange 
}: MapControllerProps) {
  const map = useMap();
  const [isUserInteracting, setIsUserInteracting] = useState(false);

  // When recenterCount increments, snap map back to user and resume following
  useEffect(() => {
    if (!map || !center) return;
    map.panTo(center);
    setIsUserInteracting(false);
  }, [map, recenterCount]);

  // When active position updates (simulation/GPS moves), only center if user is not interacting/looking around
  useEffect(() => {
    if (!map || !center || isUserInteracting) return;
    map.panTo(center);
  }, [map, center, isUserInteracting]);

  // When zoom changes programmatically
  useEffect(() => {
    if (!map || !zoom) return;
    if (map.getZoom() !== zoom) {
      map.setZoom(zoom);
    }
  }, [map, zoom]);

  // When heading changes programmatically
  useEffect(() => {
    if (!map) return;
    if (map.getHeading() !== heading) {
      map.setHeading(heading);
    }
  }, [map, heading]);

  // When tilt changes programmatically
  useEffect(() => {
    if (!map) return;
    if (map.getTilt() !== tilt) {
      map.setTilt(tilt);
    }
  }, [map, tilt]);

  // Track manual/gesture zoom events (like pinch, scroll, double tap)
  useEffect(() => {
    if (!map || !onZoomChange) return;
    const listener = map.addListener('zoom_changed', () => {
      const currentZoom = map.getZoom();
      if (currentZoom !== undefined && currentZoom !== zoom) {
        onZoomChange(currentZoom);
      }
    });
    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, zoom, onZoomChange]);

  // Track manual rotation/heading changes from map dragging
  useEffect(() => {
    if (!map || !onHeadingChange) return;
    const listener = map.addListener('heading_changed', () => {
      const currentHeading = map.getHeading();
      if (currentHeading !== undefined && currentHeading !== heading) {
        onHeadingChange(currentHeading);
      }
    });
    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, heading, onHeadingChange]);

  // Track manual tilt changes from map perspective dragging
  useEffect(() => {
    if (!map || !onTiltChange) return;
    const listener = map.addListener('tilt_changed', () => {
      const currentTilt = map.getTilt();
      if (currentTilt !== undefined && currentTilt !== tilt) {
        onTiltChange(currentTilt);
      }
    });
    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, tilt, onTiltChange]);

  // Track manual drag/pan events to pause auto-centering Follow-Me camera
  useEffect(() => {
    if (!map) return;
    const dragStartListener = map.addListener('dragstart', () => {
      setIsUserInteracting(true);
    });
    return () => {
      google.maps.event.removeListener(dragStartListener);
    };
  }, [map]);

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
  // Fallback scenic starting coordinates (offset logically for realistic routing)
  const defaultUserLocation = useMemo(() => {
    return {
      lat: destination.latitude - 0.009,
      lng: destination.longitude - 0.012
    };
  }, [destination]);

  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral>(defaultUserLocation);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [travelMode, setTravelMode] = useState<'DRIVING' | 'WALKING' | 'BICYCLING'>('DRIVING');
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string; steps?: string[] } | null>(null);
  
  // Real-time tracking and simulation
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [simulatedProgress, setSimulatedProgress] = useState(0); // scale 0 to 100
  const navigationInterval = useRef<NodeJS.Timeout | null>(null);

  // Decorative UI Interactions
  const [mapType, setMapType] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('roadmap');
  const [isMuted, setIsMuted] = useState(false);
  const [showSearchBox, setShowSearchBox] = useState(false);
  const [isStepsExpanded, setIsStepsExpanded] = useState(false);
  const [showAltModes, setShowAltModes] = useState(false);
  const [recenterCount, setRecenterCount] = useState(0);
  const [zoomLevel, setZoomLevel] = useState<number>(17);
  const [mapHeading, setMapHeading] = useState<number>(0);
  const [mapTilt, setMapTilt] = useState<number>(0);

  // Automatically zoom in closer to user's location initially when a destination loads
  useEffect(() => {
    setZoomLevel(17);
    setMapHeading(0);
    setMapTilt(0);
  }, [destination]);

  // Keep userLocation in sync with destination changes instantly
  useEffect(() => {
    setUserLocation(defaultUserLocation);
  }, [defaultUserLocation]);

  // High-fidelity local simulation distances for a flawless keyless preview
  const radarCalculation = useMemo(() => {
    const latDiff = Math.abs(destination.latitude - (userLocation?.lat || defaultUserLocation.lat));
    const lngDiff = Math.abs(destination.longitude - (userLocation?.lng || defaultUserLocation.lng));
    
    // Formula approximation representing Olalekan route parameters
    const approxKm = Math.max(0.6, Number((Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111).toFixed(1)));
    
    // Custom simulated travel modes duration maps
    const multiplier = travelMode === 'WALKING' ? 12 : travelMode === 'BICYCLING' ? 4.5 : 2.5;
    const estMin = Math.max(3, Math.round(approxKm * multiplier));

    const generatedSteps = [
      `Depart toward <strong>${destination.name}</strong> along highway entrance`,
      `Head northwest past campus gate junctions (0.4 km)`,
      `Turn right onto the major avenue connector (proceed for 0.6 km)`,
      `Follow local markings and decrease transit speed`,
      `Arrive safely at your destination: <strong>${destination.name}</strong> (${destination.address || 'Olalekan St'})`
    ];

    return {
      distance: `${approxKm} km`,
      duration: `${estMin} min`,
      steps: generatedSteps
    };
  }, [destination, userLocation, defaultUserLocation, travelMode]);

  // Keep route values aligned
  useEffect(() => {
    if (!hasValidKey) {
      setRouteInfo({
        distance: radarCalculation.distance,
        duration: radarCalculation.duration,
        steps: radarCalculation.steps
      });
    }
  }, [hasValidKey, radarCalculation]);

  const watchIdRef = useRef<number | null>(null);

  // Watch user location continuously with high precision for perfect sync
  useEffect(() => {
    setLoadingLocation(true);
    setErrorMessage(null);

    if (typeof window === 'undefined' || !navigator.geolocation) {
      setErrorMessage("Utilizing simulated high-resolution navigation vectors.");
      setUserLocation(defaultUserLocation);
      setLoadingLocation(false);
      return;
    }

    // Try to acquire initial high-accuracy position immediately to lock on quickly
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setLoadingLocation(false);
      },
      (error) => {
        console.warn("Initial fast GPS position request failed, using fallback until watchPosition starts:", error);
        setUserLocation(defaultUserLocation);
        setLoadingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );

    // Watch for physical movement and sync updates continuously
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setLoadingLocation(false);
        setErrorMessage(null);
      },
      (error) => {
        console.warn("GPS live tracker update failed:", error);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    watchIdRef.current = watchId;

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [destination, defaultUserLocation]);

  // Simulation Pilot progress tick
  useEffect(() => {
    if (isNavigating) {
      navigationInterval.current = setInterval(() => {
        setSimulatedProgress(prev => {
          const next = prev + 5;
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
      }, 1200);
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

  const togglePilotMode = () => {
    if (isNavigating) {
      setIsNavigating(false);
      setSimulatedProgress(0);
      setCurrentStepIndex(0);
    } else {
      setIsNavigating(true);
      setIsStepsExpanded(false);
    }
  };

  const destinationLatLng = useMemo(() => ({ lat: destination.latitude, lng: destination.longitude }), [destination]);

  // Dynamic projection bounds mapping GPS coordinates dynamically to 380x320 SVG viewport
  const bounds = useMemo(() => {
    const points = [
      { lat: userLocation?.lat || defaultUserLocation.lat, lng: userLocation?.lng || defaultUserLocation.lng },
      { lat: destinationLatLng.lat, lng: destinationLatLng.lng }
    ];
    
    // Find min/max lat/lng
    const lats = points.map(p => p.lat);
    const lngs = points.map(p => p.lng);
    
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    // Add 15% padding so the points are beautifully framed inside the SVG layout
    const latSpan = Math.max(0.001, maxLat - minLat);
    const lngSpan = Math.max(0.001, maxLng - minLng);
    
    return {
      minLat: minLat - latSpan * 0.15,
      maxLat: maxLat + latSpan * 0.15,
      minLng: minLng - lngSpan * 0.15,
      maxLng: maxLng + lngSpan * 0.15,
    };
  }, [userLocation, destinationLatLng, defaultUserLocation]);

  const projectCoordinate = (lat: number, lng: number) => {
    const { minLat, maxLat, minLng, maxLng } = bounds;
    
    // Normalize to 0..1
    const xNorm = (lng - minLng) / (maxLng - minLng);
    const yNorm = (maxLat - lat) / (maxLat - minLat);
    
    return {
      x: 40 + xNorm * 300, 
      y: 40 + yNorm * 240, 
    };
  };

  // Dynamically generated shortest path coordinates mapping real GPS coordinates!
  const dynamicPoints = useMemo(() => {
    const P_start = projectCoordinate(userLocation?.lat || defaultUserLocation.lat, userLocation?.lng || defaultUserLocation.lng);
    const P_end = projectCoordinate(destinationLatLng.lat, destinationLatLng.lng);
    
    const p1 = P_start;
    const p4 = P_end;
    
    const dx = p4.x - p1.x;
    const dy = p4.y - p1.y;
    
    // Elegant, realistic shortest grid-aligned route
    const p2 = {
      x: p1.x + dx * 0.4,
      y: p1.y,
      street: "Phronesis Foods"
    };
    
    const p3 = {
      x: p1.x + dx * 0.4,
      y: p1.y + dy * 0.7,
      street: "Lady Pee Salon"
    };
    
    return [
      { ...p1, label: "Your Location", street: "Start Path" },
      p2,
      p3,
      { ...p4, label: destination.name, street: destination.address || "Destination" }
    ];
  }, [userLocation, destinationLatLng, defaultUserLocation, destination, bounds]);

  // Trim the route line as the user passes each segments!
  const remainingPoints = useMemo(() => {
    const pts = dynamicPoints;
    if (!isNavigating || simulatedProgress <= 0) return pts;
    if (simulatedProgress >= 100) {
      return [{ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }];
    }

    // Find the exact interpolated position
    const segCount = pts.length - 1;
    const durPerSeg = 100 / segCount;
    const segIdx = Math.min(Math.floor(simulatedProgress / durPerSeg), segCount - 1);
    const segPct = (simulatedProgress - (segIdx * durPerSeg)) / durPerSeg;

    const start = pts[segIdx];
    const end = pts[segIdx + 1];

    const currentX = start.x + (end.x - start.x) * segPct;
    const currentY = start.y + (end.y - start.y) * segPct;

    return [
      { x: currentX, y: currentY },
      ...pts.slice(segIdx + 1)
    ];
  }, [simulatedProgress, dynamicPoints, isNavigating]);

  const currentSvgPos = useMemo(() => {
    if (remainingPoints.length > 0) {
      return remainingPoints[0];
    }
    return dynamicPoints[0];
  }, [remainingPoints, dynamicPoints]);

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

  // Dynamic Arrival Time Calculation based on computed duration
  const arrivalTime = useMemo(() => {
    const now = new Date();
    let minutesToAdd = 5;
    if (routeInfo?.duration) {
      const parsedNum = parseInt(routeInfo.duration, 10);
      if (!isNaN(parsedNum)) {
        minutesToAdd = parsedNum;
      }
    }
    now.setMinutes(now.getMinutes() + minutesToAdd);
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  }, [routeInfo]);

  // Simulated Street Heading text mimicking real-time pilot
  const currentPilotStreet = useMemo(() => {
    if (!isNavigating || simulatedProgress === 0) return dynamicPoints[0].street;
    const segment = Math.floor((simulatedProgress / 100) * dynamicPoints.length);
    const item = dynamicPoints[Math.min(segment, dynamicPoints.length - 1)];
    return item.street;
  }, [isNavigating, simulatedProgress, dynamicPoints]);

  return (
    <div className="w-full flex flex-col rounded-none overflow-hidden bg-white select-none relative">
      
      {/* 1. Header Navigation Banner: Solid dark teal layout matching native screenshot */}
      <div className="bg-[#004D40] text-white px-5 sm:px-6 py-4 flex items-center justify-between select-none relative z-20">
        <div className="flex items-center gap-3.5">
          {/* Large custom directional upwards arrow */}
          <div className="w-10 sm:w-11 h-10 sm:h-11 bg-white/10 rounded-full flex items-center justify-center border border-white/10 shrink-0">
            <ArrowUp size={20} className="text-white transform rotate-45 stroke-[2.8]" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] sm:text-[11px] font-black text-teal-300 uppercase tracking-widest leading-none">
              {isNavigating ? 'LIVE NAVIGATION ACTIVE' : 'GPS ROUTE OVERVIEW'}
            </span>
            <span className="text-base sm:text-lg font-black tracking-tight mt-0.5 leading-tight">
              {isNavigating ? `Toward ${currentPilotStreet}` : `toward ${destination.name || 'Olalekan St'}`}
            </span>
          </div>
        </div>

        {/* Float "Then" helper tag below the teal header */}
        <div className="bg-[#005F54] text-white text-[10.5px] font-bold py-1 px-3.5 rounded-br-2xl shadow-md absolute bottom-[-22px] left-0 z-10 border-r border-[#004D40]/20 flex items-center gap-1">
          <span>Then</span>
          <Navigation size={8.5} className="transform rotate-90 fill-current ml-0.5 mt-[1px]" />
        </div>
      </div>

      {/* 2. Map HUD View Container */}
      <div className="relative h-[320px] sm:h-[400px] w-full bg-slate-50 overflow-hidden">
        
        {hasValidKey && userLocation ? (
          /* Actual High-Contrast Minimal Roadmap */
          <APIProvider apiKey={API_KEY} version="weekly">
            <Map
              defaultCenter={userLocation}
              defaultZoom={15}
              zoom={zoomLevel}
              heading={mapHeading}
              tilt={mapTilt}
              mapTypeId={mapType}
              mapId="9d7d1e2c53404fcfdc535409"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              style={{ width: '100%', height: '100%' }}
              disableDefaultUI={false} // Enables Zoom, MapType, Streetview controls
              gestureHandling="greedy" // Allows seamless single-finger dragging and interactive panning
            >
              <MapController 
                center={activePosition} 
                zoom={zoomLevel} 
                onZoomChange={setZoomLevel}
                recenterCount={recenterCount}
                heading={mapHeading}
                onHeadingChange={setMapHeading}
                tilt={mapTilt}
                onTiltChange={setMapTilt}
              />

              {/* Dynamic simulated vehicles pointer */}
              <AdvancedMarker position={activePosition} title="Simulated GPS Position">
                <div className="relative flex items-center justify-center">
                  {/* Beautiful high-contrast ambient radar pulses */}
                  <div className="absolute h-14 w-14 bg-blue-500/25 rounded-full animate-ping pointer-events-none" />
                  <div className="absolute h-10 w-10 bg-blue-400/20 rounded-full animate-pulse pointer-events-none" />
                  
                  {/* Much larger, ultra-crisp premium blue current location indicator circle */}
                  <div className="relative h-10 w-10 bg-blue-600 hover:bg-blue-700 rounded-full border-[3px] border-white shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 cursor-pointer">
                    <Navigation size={18} className="text-white fill-current transform rotate-45" />
                  </div>
                </div>
              </AdvancedMarker>

              {/* Destination flag pin anchor */}
              <AdvancedMarker position={destinationLatLng} title={destination.name}>
                <Pin background="#ef4444" glyphColor="#fff">
                  <MapPin size={11} className="text-white" />
                </Pin>
              </AdvancedMarker>

              {/* Path layout calculator */}
              <RouteDisplay 
                origin={userLocation} 
                destination={destinationLatLng} 
                travelMode={travelMode}
                onRouteComputed={setRouteInfo}
                isNavigating={isNavigating}
                simulatedProgress={simulatedProgress}
              />
            </Map>
          </APIProvider>
        ) : (
          /* Custom fallback SVG matching the exact elements of the screenshot */
          <div className="relative h-full w-full bg-[#E5E9EE] overflow-hidden flex flex-col justify-between p-4 font-sans select-none border-b border-slate-200">
            {/* Soft grid background with zoom scaling transform */}
            <div 
              className="absolute inset-0 transition-transform duration-500 ease-out z-0 origin-center"
              style={{ transform: `scale(${Math.max(0.4, 1 + (zoomLevel - 15) * 0.25)})` }}
            >
              <div className="absolute inset-0 bg-[#e0e4eb] opacity-40 pointer-events-none" />
              <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.035)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
            
            {/* Visual landmarks (e.g. green parks, light blue river) */}
            <div className="absolute top-8 right-6 w-32 h-16 bg-[#D8EADB] rounded-[16px] transform rotate-12 flex items-center justify-center border border-[#CCDDCF]/40">
              <span className="text-[9px] font-bold text-slate-400">Greenway Park</span>
            </div>
            <div className="absolute bottom-8 left-4 w-40 h-20 bg-[#D9EAF5] rounded-[24px] transform -rotate-6 flex items-center justify-center border border-[#CCDCE6]/40">
              <span className="text-[9px] font-bold text-slate-400">Lagoon Canal</span>
            </div>
 
            {/* Simulated background road networks */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
              {/* Secondary Crossing Roads */}
              <line x1="20" y1="280" x2="350" y2="40" stroke="#FFFFFF" strokeWidth="11" strokeLinecap="round" className="opacity-90" />
              <line x1="20" y1="280" x2="350" y2="40" stroke="#CCD5DE" strokeWidth="7" strokeLinecap="round" />

              <line x1="50" y1="50" x2="360" y2="280" stroke="#FFFFFF" strokeWidth="11" strokeLinecap="round" className="opacity-90" />
              <line x1="50" y1="50" x2="360" y2="280" stroke="#CCD5DE" strokeWidth="7" strokeLinecap="round" />
              
              <line x1="120" y1="360" x2="260" y2="20" stroke="#FFFFFF" strokeWidth="11" strokeLinecap="round" className="opacity-90" />
              <line x1="120" y1="360" x2="260" y2="20" stroke="#CCD5DE" strokeWidth="7" strokeLinecap="round" />
            </svg>

            {/* Static labels in background roads */}
            <div className="absolute top-[180px] left-[55px] transform -rotate-35 text-[9px] font-bold text-slate-500 tracking-tight leading-none bg-[#E5E9EE]/90 px-1 py-0.5 rounded">
              Oremeji Street
            </div>
            <div className="absolute top-[102px] right-[78px] transform rotate-32 text-[9px] font-bold text-slate-500 tracking-tight leading-none bg-[#E5E9EE]/90 px-1 py-0.5 rounded">
              Primate Ave
            </div>

            {/* Active GPS Thick Core Route Polyline */}
            <div className="absolute inset-0 z-0">
              <svg className="w-full h-full" viewBox="0 0 380 320" xmlns="http://www.w3.org/2000/svg">
                
                {/* 1. Underlying path highlight glow (rendered strictly from remainingPoints to auto-erase!) */}
                {remainingPoints.length > 1 && (
                  <path
                    d={`M ${remainingPoints.map(p => `${p.x},${p.y}`).join(' L ')}`}
                    fill="none"
                    stroke={travelMode === 'WALKING' ? '#34d399' : travelMode === 'BICYCLING' ? '#fbbf24' : '#1e30f3'}
                    strokeWidth="8"
                    className="opacity-20 blur-[1px]"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                
                {/* 2. Crisp GPS solid core path line (rendered strictly from remainingPoints to auto-erase!) */}
                {remainingPoints.length > 1 && (
                  <path
                    d={`M ${remainingPoints.map(p => `${p.x},${p.y}`).join(' L ')}`}
                    fill="none"
                    stroke={travelMode === 'WALKING' ? '#10b981' : travelMode === 'BICYCLING' ? '#f59e0b' : '#2b3bf2'}
                    strokeWidth="5.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* 3. Concentric Round Station Nodes along the route (Disappear / Erase instantly as you pass) */}
                {dynamicPoints.map((p, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === dynamicPoints.length - 1;
                  const isPassed = isNavigating && idx > 0 && !isLast && (idx / (dynamicPoints.length - 1)) * 100 < simulatedProgress;
                  
                  if (isPassed) return null; // ERASE Node AND text label completely!
                  
                  return (
                    <g key={idx} transform={`translate(${p.x}, ${p.y})`}>
                      {isFirst ? (
                        /* Origin standard gray/white nav circle */
                        <>
                          <circle r="7" className="fill-blue-500 stroke-white stroke-2 shadow" />
                          <circle r="2.5" className="fill-white animate-pulse" />
                        </>
                      ) : isLast ? (
                        /* Target destination point */
                        <>
                          <circle r="9" className="fill-rose-500 stroke-white stroke-2 shadow" />
                          <circle r="3.5" className="fill-white animate-ping" />
                          <circle r="3" className="fill-white" />
                          <text y="-15" textAnchor="middle" className="text-[9px] font-black fill-rose-600 bg-white/90 px-1 py-0.5 rounded shadow-xs leading-none border border-rose-100">{destination.name}</text>
                        </>
                      ) : (
                        /* Regular gray progress knot checkpoints that dynamically fade / erase */
                        <>
                          <circle r="6.5" className="fill-[#1e293b] stroke-white stroke-[2] shadow-sm" />
                          <circle r="2" className="fill-white" />
                          <text y="-12" textAnchor="middle" className="text-[8px] font-bold fill-slate-700 bg-white/85 px-1 py-0.5 rounded leading-none border border-slate-100 shadow-3xs">
                            {idx === 1 ? "Phronesis Foods" : "Lady Pee Beauty"}
                          </text>
                        </>
                      )}
                    </g>
                  );
                })}

                {/* 4. Active Simulator Pulsing Vehicle Indicator Pin */}
                {simulatedProgress >= 0 && (
                  <g transform={`translate(${currentSvgPos.x}, ${currentSvgPos.y})`} className="transition-all duration-300">
                    <circle r="20" className="fill-blue-500/30 animate-ping pointer-events-none" />
                    <circle r="13" className="fill-blue-600 stroke-white stroke-[2.5] shadow-lg" />
                    <polygon points="-3.5,2 0,-6.5 3.5,2 0,0" fill="#ffffff" transform="scale(1.4) rotate(45)" />
                  </g>
                )}
              </svg>
            </div>

            </div> {/* Close scaled map canvas */}
            
          </div>
        )}

        {/* 3. Modernized Floating Overlay Buttons Stacked on Right (Matches Screenshot) */}
        <div className="absolute right-4.5 top-5 z-10 flex flex-col gap-3 items-center">
          {/* Compass Needle Tool */}
          <button
            type="button"
            onClick={() => {
              setRecenterCount(c => c + 1);
              setMapHeading(0); // Align back to pure North
              setZoomLevel(17);
            }}
            className="w-11 h-11 bg-white hover:bg-slate-50 text-slate-700 rounded-full flex items-center justify-center shadow-lg border border-slate-200/50 cursor-pointer transition-all active:scale-90 relative group"
            title="Align to North orientation"
          >
            <div 
              className="relative flex items-center justify-center w-full h-full transition-transform duration-200"
              style={{ transform: `rotate(${-mapHeading}deg)` }}
            >
              <Compass size={19} className="text-red-500 stroke-[2.2]" />
              <span className="absolute top-[3px] text-[7.5px] font-black text-rose-600 tracking-tight select-none">N</span>
            </div>
          </button>

          {/* 3D Perspective Toggle Button */}
          <button
            type="button"
            onClick={() => {
              setMapTilt(prev => prev > 0 ? 0 : 45);
            }}
            className={`w-11 h-11 rounded-full flex flex-col items-center justify-center shadow-lg border cursor-pointer transition-all active:scale-90 ${
              mapTilt > 0 
                ? 'bg-[#004D40] border-[#004D40] text-teal-300 font-extrabold' 
                : 'bg-white border-slate-200/50 text-slate-700 hover:bg-slate-50 font-bold'
            }`}
            title="Toggle 3D perspective tilt view"
          >
            <span className="text-[10px] leading-none tracking-tight">3D</span>
            <span className="text-[7.5px] mt-[1.5px] leading-none opacity-90">{mapTilt > 0 ? 'ON' : 'OFF'}</span>
          </button>

          {/* Map Layer Toggle Tool */}
          <button
            type="button"
            onClick={() => {
              setMapType(prev => prev === 'roadmap' ? 'hybrid' : 'roadmap');
            }}
            className="w-11 h-11 bg-white hover:bg-slate-50 text-slate-700 rounded-full flex items-center justify-center shadow-lg border border-slate-200/50 cursor-pointer transition-all active:scale-95"
            title="Toggle Satellite / Roadmap view"
          >
            <Layers size={19} className="text-[#1a73e8] stroke-[2.2]" />
          </button>

          {/* High-Fidelity Custom Zoom In (+) and Zoom Out (-) buttons widget */}
          <div className="flex flex-col bg-white rounded-2xl shadow-lg border border-slate-200/50 p-1 gap-1">
            <button
              type="button"
              onClick={() => setZoomLevel(prev => Math.min(prev + 1, 21))}
              className="w-9 h-9 hover:bg-slate-50 text-[#004D40] rounded-xl flex items-center justify-center font-bold text-lg active:scale-90 cursor-pointer border-none bg-transparent"
              title="Zoom In"
            >
              +
            </button>
            <div className="h-[1px] bg-slate-100 mx-1.5" />
            <button
              type="button"
              onClick={() => setZoomLevel(prev => Math.max(prev - 1, 10))}
              className="w-9 h-9 hover:bg-slate-50 text-[#004D40] rounded-xl flex items-center justify-center font-bold text-lg active:scale-90 cursor-pointer border-none bg-transparent"
              title="Zoom Out"
            >
              −
            </button>
          </div>
        </div>

        {/* 4. "Re-center" Button Overlay on Bottom Left (Matches Screenshot) */}
        <div className="absolute left-4.5 bottom-5 z-10">
          <button
            type="button"
            onClick={() => {
              setRecenterCount(c => c + 1);
              setZoomLevel(17); // automatically zoom in closer to location
              setIsNavigating(true); // resume or centers simulated pilot
            }}
            className="bg-white hover:bg-slate-50 rounded-full py-2.5 px-4.5 shadow-lg border border-slate-200/80 flex items-center gap-2 text-xs text-[#006E74] font-bold active:scale-95 transition-all cursor-pointer select-none"
          >
            <Navigation size={12} className="text-[#006E74] fill-[#006e74]/20 transform -rotate-45" />
            <span>Re-center</span>
          </button>
        </div>

        {/* Inline animated Search Box panel tool */}
        {showSearchBox && (
          <div className="absolute top-4 left-4 right-20 z-10 bg-white p-2.5 rounded-2xl shadow-xl border border-slate-200/80 flex items-center gap-2 animate-in slide-in-from-top-6 duration-200">
            <input 
              type="text" 
              placeholder={`Search around ${destination.name || 'Olalekan St'}...`}
              className="flex-1 bg-slate-100/70 border-none outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-medium"
              onKeyDown={e => {
                if (e.key === 'Enter') setShowSearchBox(false);
              }}
            />
            <button 
              onClick={() => setShowSearchBox(false)} 
              className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer border-none bg-transparent"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* 5. Cozy Curved Bottom HUD Drawer Sheet (Matches Screenshot) */}
      <div className="rounded-none bg-white border-t border-slate-100 px-5 pt-3 relative z-10 transition-all duration-300">
        
        {/* Top-center dragging handle bar (decoration widget) */}
        <div 
          onClick={() => setIsStepsExpanded(!isStepsExpanded)} 
          className="w-11 h-1 bg-slate-300 hover:bg-slate-400 rounded-full mx-auto mb-3.5 cursor-pointer transition-colors" 
        />

        {/* Primary Row HUD Stats Column */}
        <div className="flex items-center justify-between py-2 mb-3 select-none">
          {/* A. X CLOSE BUTTON on far left */}
          <button
            type="button"
            onClick={togglePilotMode}
            className={`w-11 h-11 rounded-full border border-slate-200 bg-white flex items-center justify-center hover:bg-slate-50 active:scale-95 transition-all text-slate-800 cursor-pointer shadow-xs shrink-0 ${isNavigating ? 'border-rose-200 hover:bg-rose-50/50' : ''}`}
            title={isNavigating ? "Pause navigation simulation" : "Start Navigation Pilot (Simulated)"}
          >
            {isNavigating ? (
              <X size={18} className="text-rose-600 stroke-[2.5]" />
            ) : (
              <Play size={16} className="text-teal-600 fill-teal-600" />
            )}
          </button>

          {/* B. MIDDLE DURATION STATS (Generous spacing and typography) */}
          <div 
            onClick={() => setIsStepsExpanded(!isStepsExpanded)}
            className="flex-1 px-4 cursor-pointer flex flex-col justify-center text-center sm:text-left"
          >
            <div className="flex items-center justify-center sm:justify-start gap-1.5">
              <span className="text-[26px] sm:text-[28px] font-black text-slate-900 tracking-tight leading-none mb-1">
                {routeInfo?.duration || "5 min"}
              </span>
              <div className="flex items-center justify-center leading-none text-emerald-500" title="Eco-friendly route calculated">
                <Leaf size={16} className="fill-emerald-500/10 shrink-0" />
              </div>
            </div>
            
            <div className="text-slate-500 text-xs sm:text-sm font-semibold tracking-tight">
              {routeInfo?.distance || "1.2 km"} • Arrival at {arrivalTime}
            </div>
          </div>

          {/* C. GITFORK BRANCHES BUTTON on far right (Toggles alternate travel mode picker tray) */}
          <button
            type="button"
            onClick={() => setShowAltModes(!showAltModes)}
            className={`w-11 h-11 rounded-full border bg-white flex items-center justify-center hover:bg-slate-50 active:scale-95 transition-all text-slate-800 cursor-pointer shadow-xs shrink-0 ${showAltModes ? 'border-blue-500 text-blue-600 bg-blue-50/40' : 'border-slate-200'}`}
            title="Toggle travel modes and alternative routing"
          >
            <GitFork size={17} className="transform rotate-90" />
          </button>
        </div>

        {/* Expandable alternative modes selector tray (Toggled via alternate routes branch key) */}
        {showAltModes && (
          <div className="border-t border-slate-100 py-3.5 mb-3 select-none flex items-center justify-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <button
              type="button"
              onClick={() => { setTravelMode('DRIVING'); setIsNavigating(false); setShowAltModes(false); }}
              className={`flex items-center gap-2 py-2 px-4 rounded-full text-xs font-bold transition-all border cursor-pointer ${travelMode === 'DRIVING' ? 'bg-[#e8edff] text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
            >
              <Car size={13} />
              <span>Drive Mode</span>
            </button>
            <button
              type="button"
              onClick={() => { setTravelMode('WALKING'); setIsNavigating(false); setShowAltModes(false); }}
              className={`flex items-center gap-2 py-2 px-4 rounded-full text-xs font-bold transition-all border cursor-pointer ${travelMode === 'WALKING' ? 'bg-[#e2fbf0] text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
            >
              <Footprints size={13} />
              <span>Walk Mode</span>
            </button>
            <button
              type="button"
              onClick={() => { setTravelMode('BICYCLING'); setIsNavigating(false); setShowAltModes(false); }}
              className={`flex items-center gap-2 py-2 px-4 rounded-full text-xs font-bold transition-all border cursor-pointer ${travelMode === 'BICYCLING' ? 'bg-[#fff4e2] text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
            >
              <Bike size={13} />
              <span>Cycle Mode</span>
            </button>
          </div>
        )}

        {/* 6. Expandable Step Directions Tray: Hidden by default for elegant simplicity, opens toggled by user */}
        <div className="border-t border-slate-100/70 mt-1">
          <button
            type="button"
            onClick={() => setIsStepsExpanded(!isStepsExpanded)}
            className="w-full flex items-center justify-between py-3.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer border-none bg-transparent"
          >
            <span className="flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
              <span>Real-time Guidance System ({travelMode.toLowerCase()})</span>
            </span>
            <span className="flex items-center gap-1 text-slate-400 font-normal">
              <span>{isStepsExpanded ? 'Close list' : 'View active turns'}</span>
              {isStepsExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </span>
          </button>

          {isStepsExpanded && (
            <div className="pb-5 max-h-[190px] overflow-y-auto scrollbar-none space-y-3 animate-in slide-in-from-top-3 duration-250">
              {routeInfo?.steps && routeInfo.steps.length > 0 ? (
                <div className="space-y-2 pl-0.5">
                  {routeInfo.steps.map((step, idx) => {
                    const isPassed = idx < currentStepIndex;
                    const isActive = idx === currentStepIndex;
                    
                    return (
                      <div 
                        key={idx} 
                        className={`flex gap-3 text-xs transition-all p-2 rounded-xl border ${
                          isActive 
                            ? 'text-slate-900 font-bold bg-[#f1f5f9] border-[#e2e8f0]' 
                            : isPassed 
                              ? 'text-slate-400 line-through opacity-50 border-transparent' 
                              : 'text-slate-500 border-transparent'
                        }`}
                      >
                        <div className="flex flex-col items-center shrink-0 mt-0.5">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            isActive 
                              ? 'bg-blue-600 text-white' 
                              : isPassed 
                                ? 'bg-slate-200 text-slate-500' 
                                : 'bg-slate-100 text-slate-400'
                          }`}>
                            {idx + 1}
                          </div>
                      </div>
                      <div className="flex-1 font-medium leading-snug" dangerouslySetInnerHTML={{ __html: step }} />
                      {isActive && <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic text-center py-2">Finding steps and route indicators...</p>
            )}
          </div>
        )}
      </div>

      </div>
    </div>
  );
}
