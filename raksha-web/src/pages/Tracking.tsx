import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import { locationApi } from '../api/client';
import { useToast } from '../context/ToastContext';

export default function Tracking() {
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
  const watchId = useRef<number | null>(null);
  const positions = useRef<[number, number][]>([]);
  const startTime = useRef<number | null>(null);
  const durationInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const prevPos = useRef<[number, number] | null>(null);

  const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371000, toR = (d: number) => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    leafletMap.current = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap.current);
    L.control.zoom({ position: 'topright' }).addTo(leafletMap.current);

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
    };
  }, []);

  const startTracking = () => {
    if (!navigator.geolocation) return;
    setTracking(true);
    setDistance(0);
    setDuration(0);
    setSpeed(0);
    positions.current = [];
    prevPos.current = null;
    startTime.current = Date.now();

    durationInterval.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - (startTime.current || Date.now())) / 1000));
    }, 1000);

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const latlng: [number, number] = [latitude, longitude];
        setCoords({ lat: latitude, lng: longitude });
        positions.current.push(latlng);

        if (prevPos.current) {
          const d = haversineM(prevPos.current[0], prevPos.current[1], latitude, longitude);
          setDistance(prev => prev + d);
          setSpeed(Math.round((pos.coords.speed || 0) * 3.6)); // m/s to km/h
        }
        prevPos.current = latlng;

        // Update backend
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
            path.current = L.polyline(positions.current, { color: '#ff4757', weight: 4, opacity: 0.8 }).addTo(leafletMap.current);
          }
        }
      },
      () => { },
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
    showToast('Tracking started — guardians can see you');
  };

  const stopTracking = () => {
    if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
    clearInterval(durationInterval.current);
    setTracking(false);
    showToast('Tracking stopped');
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="page" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 16px 0' }}>
        <h1 className="page-header" style={{ marginBottom: 12 }}>Live Tracking</h1>
      </div>

      <div
        ref={mapRef}
        style={{ flex: 1, minHeight: 360, margin: '0 16px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)' }}
      />

      {/* Stats bar */}
      <div className="tracking-info-bar">
        <div className="tracking-stat">
          <div className="tracking-stat-val" style={{ color: 'var(--accent)' }}>{(distance / 1000).toFixed(2)}</div>
          <div className="tracking-stat-lbl">km</div>
        </div>
        <div className="tracking-stat">
          <div className="tracking-stat-val" style={{ color: 'var(--info)' }}>{formatDuration(duration)}</div>
          <div className="tracking-stat-lbl">time</div>
        </div>
        <div className="tracking-stat">
          <div className="tracking-stat-val" style={{ color: 'var(--safe)' }}>{speed}</div>
          <div className="tracking-stat-lbl">km/h</div>
        </div>
      </div>

      <div style={{ padding: '12px 16px 16px' }}>
        {coords && (
          <div className="card" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>📍</span>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Current Location</div>
              <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
              </div>
            </div>
            <a
              href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
              target="_blank" rel="noopener"
              className="guardian-action-btn"
              style={{ marginLeft: 'auto' }}
            >🗺️</a>
          </div>
        )}

        {tracking ? (
          <button className="btn btn-secondary btn-block" onClick={stopTracking}>
            Stop Tracking
          </button>
        ) : (
          <button className="btn btn-primary btn-block" onClick={startTracking}>
            Start Tracking
          </button>
        )}
      </div>
    </div>
  );
}
