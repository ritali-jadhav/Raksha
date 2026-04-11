import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';

interface Place {
  name: string;
  type: 'hospital' | 'police';
  lat: number;
  lng: number;
  distance?: number;
}

export default function Awareness() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'hospital' | 'police'>('all');
  const [_userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    leafletMap.current = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([20.5937, 78.9629], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(leafletMap.current);

    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ lat: latitude, lng: longitude });
        leafletMap.current?.setView([latitude, longitude], 14);

        // User marker
        L.circleMarker([latitude, longitude], {
          radius: 8, fillColor: '#3b82f6', fillOpacity: 1, color: '#fff', weight: 2,
        }).addTo(leafletMap.current!).bindPopup('You are here');

        // Fetch nearby places from Overpass API
        fetchNearbyPlaces(latitude, longitude);
      },
      () => {
        setLoading(false);
        // Fallback: show sample data
        setPlaces([
          { name: 'City Hospital', type: 'hospital', lat: 20.5937, lng: 78.9629 },
          { name: 'Police Station', type: 'police', lat: 20.5900, lng: 78.9600 },
        ]);
      },
      { enableHighAccuracy: true }
    );
  }, []);

  const fetchNearbyPlaces = async (lat: number, lng: number) => {
    try {
      const radius = 5000; // 5km
      const query = `
        [out:json][timeout:10];
        (
          node["amenity"="hospital"](around:${radius},${lat},${lng});
          node["amenity"="police"](around:${radius},${lat},${lng});
        );
        out body 20;
      `;

      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const data = await res.json();

      const results: Place[] = (data.elements || []).map((el: any) => {
        const dist = getDistance(lat, lng, el.lat, el.lon);
        const place: Place = {
          name: el.tags?.name || (el.tags?.amenity === 'hospital' ? 'Hospital' : 'Police Station'),
          type: el.tags?.amenity === 'hospital' ? 'hospital' : 'police',
          lat: el.lat,
          lng: el.lon,
          distance: dist,
        };

        // Add markers to map
        if (leafletMap.current) {
          const icon = place.type === 'hospital' ? '🏥' : '🚔';
          const div = L.divIcon({
            html: `<span style="font-size:24px">${icon}</span>`,
            className: '',
            iconSize: [28, 28],
          });
          L.marker([el.lat, el.lon], { icon: div })
            .addTo(leafletMap.current)
            .bindPopup(`<b>${place.name}</b><br>${(dist / 1000).toFixed(1)} km`);
        }

        return place;
      });

      results.sort((a, b) => (a.distance || 0) - (b.distance || 0));
      setPlaces(results);
    } catch {
      setPlaces([]);
    } finally {
      setLoading(false);
    }
  };

  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3;
    const toRad = (d: number) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const filtered = filter === 'all' ? places : places.filter(p => p.type === filter);

  return (
    <div className="page" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 16px 0' }}>
        <h1 className="page-header" style={{ marginBottom: 12 }}>🏥 Nearby Help</h1>
        <div className="tabs">
          <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
          <button className={`tab ${filter === 'hospital' ? 'active' : ''}`} onClick={() => setFilter('hospital')}>🏥 Hospitals</button>
          <button className={`tab ${filter === 'police' ? 'active' : ''}`} onClick={() => setFilter('police')}>🚔 Police</button>
        </div>
      </div>

      <div
        ref={mapRef}
        style={{ height: 220, margin: '0 16px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)' }}
      />

      <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
            <div className="spinner" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="emoji">📍</div>
            <p>No nearby places found. Enable location access.</p>
          </div>
        ) : (
          filtered.map((p, i) => (
            <div key={i} className="card" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 28 }}>{p.type === 'hospital' ? '🏥' : '🚔'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {p.distance ? `${(p.distance / 1000).toFixed(1)} km away` : ''}
                </div>
              </div>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`}
                target="_blank"
                rel="noopener"
                className="guardian-action-btn"
              >🗺️</a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
