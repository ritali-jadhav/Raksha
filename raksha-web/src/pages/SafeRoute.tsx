import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

interface Route {
    route_id: number;
    distance_km: number;
    duration_min: number;
    safety_score: number;
    coords: [number, number][];
}

interface RiskCell {
    lat: number;
    lon: number;
    risk: number;
    is_hotspot: boolean;
}

const SAFE_ROUTE_BASE = (import.meta as any)?.env?.VITE_SAFE_ROUTE_URL || 'http://127.0.0.1:8000';
const MUMBAI: [number, number] = [19.07, 72.87];
const UPDATE_THRESHOLD_M = 50;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toR = (d: number) => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function safetyScoreToColor(score: number): string {
    if (score <= 0.3) return '#2ed573';
    if (score <= 0.6) return '#ffa502';
    return '#ff4757';
}

function isLocationInHotspot(lat: number, lng: number, cells: RiskCell[]): boolean {
    const HALF = 0.003;
    return cells.some(c => c.is_hotspot && Math.abs(lat - c.lat) <= HALF && Math.abs(lng - c.lon) <= HALF);
}

export default function SafeRoute() {
    const { showToast } = useToast();
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletMap = useRef<L.Map | null>(null);
    const userMarker = useRef<L.CircleMarker | null>(null);
    const routeLayers = useRef<L.Polyline[]>([]);
    const hotspotMarkers = useRef<L.CircleMarker[]>([]);
    const heatLayer = useRef<any>(null);
    const watchId = useRef<number | null>(null);
    const prevPos = useRef<[number, number] | null>(null);

    const [currentPos, setCurrentPos] = useState<[number, number] | null>(null);
    const [source, setSource] = useState('');
    const [destination, setDestination] = useState('');
    const [hour, setHour] = useState<number>(new Date().getHours());
    const [routes, setRoutes] = useState<Route[]>([]);
    const [hotspotCells, setHotspotCells] = useState<RiskCell[]>([]);
    const [inHighRisk, setInHighRisk] = useState(false);
    const [loadingRoutes, setLoadingRoutes] = useState(false);
    const [loadingHeat, setLoadingHeat] = useState(false);
    const [geoError, setGeoError] = useState(false);
    const [showPanel, setShowPanel] = useState(true);

    // Init map
    useEffect(() => {
        if (!mapRef.current || leafletMap.current) return;
        leafletMap.current = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView(MUMBAI, 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap.current);

        // Zoom controls top-right
        L.control.zoom({ position: 'topright' }).addTo(leafletMap.current);

        return () => {
            if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
        };
    }, []);

    // Geolocation
    useEffect(() => {
        if (!navigator.geolocation) { setGeoError(true); return; }

        navigator.geolocation.getCurrentPosition(
            pos => {
                const latlng: [number, number] = [pos.coords.latitude, pos.coords.longitude];
                setCurrentPos(latlng);
                prevPos.current = latlng;
                setSource(`${latlng[0].toFixed(5)},${latlng[1].toFixed(5)}`);
                leafletMap.current?.setView(latlng, 14);
                placeUserMarker(latlng);
            },
            () => { setGeoError(true); },
            { enableHighAccuracy: true }
        );

        watchId.current = navigator.geolocation.watchPosition(
            pos => {
                const latlng: [number, number] = [pos.coords.latitude, pos.coords.longitude];
                if (prevPos.current && haversineM(prevPos.current[0], prevPos.current[1], latlng[0], latlng[1]) < UPDATE_THRESHOLD_M) return;
                prevPos.current = latlng;
                setCurrentPos(latlng);
                leafletMap.current?.setView(latlng, 15);
                placeUserMarker(latlng);
            },
            () => { },
            { enableHighAccuracy: true, maximumAge: 5000 }
        );
    }, []);

    const placeUserMarker = (latlng: [number, number]) => {
        if (!leafletMap.current) return;
        if (userMarker.current) {
            userMarker.current.setLatLng(latlng);
        } else {
            userMarker.current = L.circleMarker(latlng, {
                radius: 9, fillColor: '#3b82f6', fillOpacity: 1, color: '#fff', weight: 3,
            }).addTo(leafletMap.current).bindPopup('You are here');
        }
    };

    // Load heatmap
    const loadHeatmap = useCallback(async (h: number) => {
        setLoadingHeat(true);
        try {
            const data = await fetch(`${SAFE_ROUTE_BASE}/risk-map?hour=${h}`).then(r => r.json());
            const cells: RiskCell[] = data.data || [];
            setHotspotCells(cells);

            if (!leafletMap.current) return;

            // Remove old heat layer
            if (heatLayer.current) { leafletMap.current.removeLayer(heatLayer.current); heatLayer.current = null; }
            hotspotMarkers.current.forEach(m => leafletMap.current!.removeLayer(m));
            hotspotMarkers.current = [];

            // Add heatmap if plugin available
            const L_any = L as any;
            if (L_any.heatLayer) {
                const points = cells.map(c => [c.lat, c.lon, c.risk * 1.2]);
                heatLayer.current = L_any.heatLayer(points, {
                    radius: 22, blur: 16, maxZoom: 17, max: 1.2,
                    gradient: { 0.1: '#2ed573', 0.3: '#ffa502', 0.6: '#ff6348', 1.0: '#c0392b' },
                }).addTo(leafletMap.current);
            }

            // Hotspot markers
            cells.filter(c => c.is_hotspot).forEach(c => {
                const m = L.circleMarker([c.lat, c.lon], {
                    radius: 7, color: '#ff4757', fillColor: '#ff4757', fillOpacity: 0.35, weight: 2,
                }).addTo(leafletMap.current!);
                m.bindPopup(`<div style="font-family:sans-serif;font-size:13px"><b style="color:#ff4757">High Risk Zone</b><br>Risk score: <b>${(c.risk * 100).toFixed(0)}%</b></div>`);
                hotspotMarkers.current.push(m);
            });
        } catch {
            showToast('Could not load risk map', 'error');
        } finally {
            setLoadingHeat(false);
        }
    }, [showToast]);

    useEffect(() => { loadHeatmap(hour); }, [hour]);

    // Check hotspot on position change
    useEffect(() => {
        if (!currentPos || hotspotCells.length === 0) return;
        setInHighRisk(isLocationInHotspot(currentPos[0], currentPos[1], hotspotCells));
    }, [currentPos, hotspotCells]);

    // Fetch routes
    const fetchRoutes = async () => {
        if (!source.trim() || !destination.trim()) { showToast('Enter source and destination', 'error'); return; }
        setLoadingRoutes(true);
        setRoutes([]);
        routeLayers.current.forEach(l => leafletMap.current?.removeLayer(l));
        routeLayers.current = [];

        try {
            const params = new URLSearchParams({ source: source.trim(), destination: destination.trim(), hour: String(hour) });
            const data = await fetch(`${SAFE_ROUTE_BASE}/routes?${params}`).then(r => r.json());

            if (data.error) { showToast(data.error, 'error'); return; }
            if (!data.routes?.length) { showToast('No routes found', 'error'); return; }

            setRoutes(data.routes);

            data.routes.forEach((route: Route, idx: number) => {
                const color = safetyScoreToColor(route.safety_score);
                const poly = L.polyline(route.coords, {
                    color, weight: idx === 0 ? 7 : 5, opacity: idx === 0 ? 0.95 : 0.55,
                    dashArray: idx === 0 ? undefined : '8 6',
                }).addTo(leafletMap.current!);
                routeLayers.current.push(poly);
                if (idx === 0) leafletMap.current?.fitBounds(poly.getBounds(), { padding: [40, 40] });
            });
        } catch {
            showToast('Route service unavailable', 'error');
        } finally {
            setLoadingRoutes(false);
        }
    };

    const useMyLocation = () => {
        if (currentPos) setSource(`${currentPos[0].toFixed(5)},${currentPos[1].toFixed(5)}`);
        else showToast('Location not available yet', 'error');
    };

    const scoreClass = (s: number) => s <= 0.3 ? 'safe' : s <= 0.6 ? 'medium' : 'danger';
    const scoreLabel = (s: number) => s <= 0.3 ? 'Safe' : s <= 0.6 ? 'Moderate' : 'Risky';

    return (
        <div className="safe-route-page" style={{ paddingBottom: 'calc(var(--nav-height) + var(--safe-bottom))' }}>
            {/* Map */}
            <div className="safe-route-map-wrap" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 300 }} />

                {/* FABs */}
                <button className="map-fab locate" onClick={() => {
                    if (currentPos) leafletMap.current?.setView(currentPos, 15);
                    else showToast('Location not available', 'error');
                }}>📍</button>
                <button className="map-fab layers" onClick={() => loadHeatmap(hour)} title="Refresh heatmap">
                    {loadingHeat ? <span className="spinner" style={{ width: 18, height: 18 }} /> : '🔥'}
                </button>

                {/* Geo error */}
                {geoError && (
                    <div style={{ position: 'absolute', top: 12, left: 12, right: 60, background: 'rgba(255,71,87,0.9)', color: '#fff', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12, fontWeight: 600, zIndex: 500 }}>
                        Location unavailable — showing Mumbai
                    </div>
                )}

                {/* High risk banner */}
                {inHighRisk && (
                    <div className="hotspot-warning" style={{ position: 'absolute', bottom: 12, left: 12, right: 60, zIndex: 500, margin: 0 }}>
                        <span className="hotspot-warning-icon">⚠️</span>
                        <span className="hotspot-warning-text">You are in a high-risk zone!</span>
                    </div>
                )}
            </div>

            {/* Panel toggle */}
            <button
                onClick={() => setShowPanel(p => !p)}
                style={{ width: '100%', padding: '8px', background: 'var(--bg-secondary)', border: 'none', borderTop: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
                {showPanel ? '▼ Hide panel' : '▲ Show panel'}
            </button>

            {/* Bottom panel */}
            {showPanel && (
                <div className="safe-route-panel">
                    {/* Hour chips */}
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 10, paddingBottom: 2 }}>
                        {[6, 9, 12, 15, 18, 21, 0].map(h => (
                            <button key={h} className={`hour-chip ${hour === h ? 'active' : ''}`} onClick={() => setHour(h)}>
                                {h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`}
                            </button>
                        ))}
                    </div>

                    {/* Inputs */}
                    <div className="safe-route-inputs">
                        <div className="safe-route-input-row">
                            <span className="input-icon">🟢</span>
                            <input className="input" placeholder="Source (address or lat,lng)" value={source} onChange={e => setSource(e.target.value)} />
                            <button style={{ fontSize: 18, padding: '0 6px', color: 'var(--info)' }} onClick={useMyLocation} title="Use my location">📍</button>
                        </div>
                        <div className="safe-route-input-row">
                            <span className="input-icon">🔴</span>
                            <input className="input" placeholder="Destination" value={destination} onChange={e => setDestination(e.target.value)} />
                        </div>
                    </div>

                    <button className="btn btn-primary btn-block btn-sm" onClick={fetchRoutes} disabled={loadingRoutes}>
                        {loadingRoutes ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Finding routes...</> : '🔍 Find Safe Routes'}
                    </button>

                    {/* Route cards */}
                    {routes.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>
                                {routes.length} route{routes.length > 1 ? 's' : ''} found — sorted by safety
                            </div>
                            {routes.map((r, i) => (
                                <div key={r.route_id} className={`route-card ${i === 0 ? 'best' : ''}`}>
                                    <div className={`route-score-badge ${scoreClass(r.safety_score)}`}>
                                        {(r.safety_score * 100).toFixed(0)}%
                                    </div>
                                    <div className="route-info-row">
                                        <div className="route-info-title">
                                            Route {r.route_id} {i === 0 && <span style={{ fontSize: 10, background: 'var(--safe)', color: '#0a0f1a', borderRadius: 4, padding: '1px 5px', marginLeft: 4 }}>BEST</span>}
                                        </div>
                                        <div className="route-info-meta">
                                            {r.distance_km} km • {r.duration_min} min • {scoreLabel(r.safety_score)}
                                        </div>
                                    </div>
                                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: safetyScoreToColor(r.safety_score), flexShrink: 0 }} />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Legend */}
                    <div style={{ display: 'flex', gap: 12, marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                        {[['#2ed573', 'Safe (0–30%)'], ['#ffa502', 'Moderate (31–60%)'], ['#ff4757', 'Risky (61–100%)']].map(([c, l]) => (
                            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block' }} />
                                {l}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
