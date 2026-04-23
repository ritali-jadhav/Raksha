import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { locationApi, guardianApi } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

export default function Tracking() {
  const { } = useAuth();
  const { showToast } = useToast();
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const path = useRef<L.Polyline | null>(null);
  const [tracking, setTracking] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [steps, setSteps] = useState(0);
  const [sharingWith, setSharingWith] = useState(0);
  const [autoCheckin, setAutoCheckin] = useState(true);
  const [checkpoints, setCheckpoints] = useState<{ lat: number; lng: number; time: string }[]>([]);
  const watchId = useRef<number | null>(null);
  const positions = useRef<[number, number][]>([]);
  const startTime = useRef<number | null>(null);
  const durationInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const checkinInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const prevPos = useRef<[number, number] | null>(null);

  const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371000, toR = (d: number) => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Estimate steps from distance (~0.75m per step average)
  useEffect(() => {
    setSteps(Math.round(distance / 0.75));
  }, [distance]);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    leafletMap.current = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap.current);
    L.control.zoom({ position: 'topright' }).addTo(leafletMap.current);
    setTimeout(() => leafletMap.current?.invalidateSize(), 100);

    navigator.geolocation?.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        leafletMap.current?.setView([latitude, longitude], 15);
        setCoords({ lat: latitude, lng: longitude });
      },
      () => { },
      { enableHighAccuracy: true }
    );

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      clearInterval(durationInterval.current);
      clearInterval(checkinInterval.current);
    };
  }, []);

  const addCheckpoint = useCallback((lat: number, lng: number) => {
    const cp = { lat, lng, time: new Date().toLocaleTimeString() };
    setCheckpoints(prev => [...prev, cp]);
    if (leafletMap.current) {
      L.circleMarker([lat, lng], {
        radius: 6, fillColor: '#3b82f6', fillOpacity: 1, color: '#fff', weight: 2,
      }).addTo(leafletMap.current).bindPopup(`📍 Checkpoint • ${cp.time}`);
    }
    showToast(`Checkpoint marked at ${cp.time}`);
  }, [showToast]);

  const startTracking = async () => {
    if (!navigator.geolocation) return;
    setTracking(true);
    setDistance(0);
    setDuration(0);
    setSpeed(0);
    setSteps(0);
    setCheckpoints([]);
    positions.current = [];
    prevPos.current = null;
    startTime.current = Date.now();

    // Count how many guardians will receive updates
    try {
      const [g, pg] = await Promise.all([
        guardianApi.myGuardians().catch(() => ({ guardians: [] })),
        guardianApi.phoneGuardians().catch(() => ({ guardians: [] })),
      ]);
      setSharingWith((g.guardians?.length || 0) + (pg.guardians?.length || 0));
    } catch {
      setSharingWith(0);
    }

    durationInterval.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - (startTime.current || Date.now())) / 1000));
    }, 1000);

    // Auto heartbeat every 2 minutes
    if (autoCheckin) {
      checkinInterval.current = setInterval(() => {
        locationApi.heartbeat().catch(() => { });
      }, 120000);
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const latlng: [number, number] = [latitude, longitude];
        setCoords({ lat: latitude, lng: longitude });
        positions.current.push(latlng);

        if (prevPos.current) {
          const d = haversineM(prevPos.current[0], prevPos.current[1], latitude, longitude);
          setDistance(prev => prev + d);
          setSpeed(Math.round((pos.coords.speed || 0) * 3.6));
        }
        prevPos.current = latlng;

        // Update backend location
        locationApi.update(latitude, longitude).catch(() => { });

        if (leafletMap.current) {
          leafletMap.current.setView(latlng, 16);
          if (marker.current) {
            marker.current.setLatLng(latlng);
          } else {
            marker.current = L.circleMarker(latlng, {
              radius: 9, fillColor: '#ff4757', fillOpacity: 1, color: '#fff', weight: 3,
            }).addTo(leafletMap.current);
          }
          if (path.current) {
            path.current.setLatLngs(positions.current);
          } else {
            path.current = L.polyline(positions.current, {
              color: '#ff4757', weight: 4, opacity: 0.8, dashArray: '10, 6',
            }).addTo(leafletMap.current);
          }
        }
      },
      () => { },
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
    showToast('Safety walk started — guardians can track you');
  };

  const stopTracking = () => {
    if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
    clearInterval(durationInterval.current);
    clearInterval(checkinInterval.current);
    setTracking(false);
    showToast('Safety walk ended');
  };

  const shareLocation = () => {
    if (!coords) return;
    const url = `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
    const text = `📍 My live location: ${url}\n— Sent via Raksha Safety App`;
    if (navigator.share) {
      navigator.share({ title: 'My Location', text }).catch(() => { });
    } else {
      navigator.clipboard.writeText(text).then(() => showToast('Location copied!')).catch(() => { });
    }
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Calories estimate (~0.04 kcal per step)
  const calories = Math.round(steps * 0.04);

  return (
    <div className="page" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 16px 0' }}>
        <h1 className="page-header" style={{ marginBottom: 4 }}>🚶 Safety Walk</h1>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          Track your walk in real-time. Guardians see your live location.
        </p>
      </div>

      <div
        ref={mapRef}
        style={{ flex: 1, minHeight: 300, margin: '0 16px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)' }}
      />

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '12px 16px 0' }}>
        <div className="stat-card" style={{ padding: '8px 4px' }}>
          <div className="stat-value" style={{ color: 'var(--accent)', fontSize: 16 }}>{(distance / 1000).toFixed(2)}</div>
          <div className="stat-label" style={{ fontSize: 9 }}>km</div>
        </div>
        <div className="stat-card" style={{ padding: '8px 4px' }}>
          <div className="stat-value" style={{ color: 'var(--info)', fontSize: 16 }}>{formatDuration(duration)}</div>
          <div className="stat-label" style={{ fontSize: 9 }}>time</div>
        </div>
        <div className="stat-card" style={{ padding: '8px 4px' }}>
          <div className="stat-value" style={{ color: 'var(--safe)', fontSize: 16 }}>{steps}</div>
          <div className="stat-label" style={{ fontSize: 9 }}>steps</div>
        </div>
        <div className="stat-card" style={{ padding: '8px 4px' }}>
          <div className="stat-value" style={{ color: 'var(--warning)', fontSize: 16 }}>{calories}</div>
          <div className="stat-label" style={{ fontSize: 9 }}>kcal</div>
        </div>
      </div>

      <div style={{ padding: '8px 16px 16px' }}>
        {/* Current location */}
        {coords && (
          <div className="card" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
            <span style={{ fontSize: 18 }}>📍</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Current Location</div>
              <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
              </div>
            </div>
            <button className="guardian-action-btn" onClick={shareLocation} title="Share location">📤</button>
            <a
              href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
              target="_blank" rel="noopener"
              className="guardian-action-btn"
            >🗺️</a>
          </div>
        )}

        {/* Guardian sharing status */}
        {tracking && sharingWith > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            background: 'rgba(46, 213, 115, 0.08)', border: '1px solid rgba(46, 213, 115, 0.2)',
          }}>
            <div className="live-dot" style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: 'var(--safe)', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 12, color: 'var(--safe)' }}>
              📡 Sharing live with <strong>{sharingWith}</strong> guardian{sharingWith !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Checkpoints */}
        {tracking && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1 }}
              onClick={() => coords && addCheckpoint(coords.lat, coords.lng)}
              disabled={!coords}
            >
              📌 Mark Checkpoint ({checkpoints.length})
            </button>
            <button
              className={`btn btn-sm ${autoCheckin ? 'btn-safe' : 'btn-secondary'}`}
              style={{ flex: 1 }}
              onClick={() => {
                setAutoCheckin(v => !v);
                showToast(autoCheckin ? 'Auto check-in OFF' : 'Auto check-in ON (every 2 min)');
              }}
            >
              {autoCheckin ? '✅ Auto Check-in' : '⏸️ Auto Check-in'}
            </button>
          </div>
        )}

        {/* Checkpoint log */}
        {checkpoints.length > 0 && (
          <div className="card" style={{ marginBottom: 10, padding: '8px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--text-muted)' }}>CHECKPOINTS</div>
            {checkpoints.map((cp, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: 'var(--info)', fontWeight: 700 }}>#{i + 1}</span>
                <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{cp.lat.toFixed(4)}, {cp.lng.toFixed(4)}</span>
                <span style={{ color: 'var(--text-muted)' }}>{cp.time}</span>
              </div>
            ))}
          </div>
        )}

        {/* Start/Stop button */}
        {tracking ? (
          <button className="btn btn-secondary btn-block" onClick={stopTracking}>
            ⏹️ End Safety Walk
          </button>
        ) : (
          <button className="btn btn-primary btn-block" onClick={startTracking}>
            🚶 Start Safety Walk
          </button>
        )}

        {/* Speed indicator */}
        {tracking && speed > 0 && (
          <div style={{ textAlign: 'center', marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            Speed: <strong style={{ color: speed > 15 ? 'var(--warning)' : 'var(--safe)' }}>{speed} km/h</strong>
            {speed > 15 && ' ⚡ Looks like you may be in a vehicle'}
          </div>
        )}
      </div>
    </div>
  );
}
