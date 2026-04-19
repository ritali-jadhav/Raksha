import { useState, useCallback } from 'react';
import L from 'leaflet';

export interface NearbyPlace {
  id: number;
  type: 'hospital' | 'police';
  name: string;
  lat: number;
  lng: number;
  distanceM?: number;
}

/**
 * Hook to fetch nearby hospitals and police stations via Overpass API.
 * Uses the free OpenStreetMap Overpass API — no API key required.
 * Returns places within ~2km of given coordinates.
 */
export function useNearbyPlaces() {
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markersRef = { current: [] as L.CircleMarker[] };

  const fetchNearby = useCallback(async (lat: number, lng: number, radiusM = 2000) => {
    setLoading(true);
    setError(null);

    const query = `
[out:json][timeout:15];
(
  node["amenity"="hospital"](around:${radiusM},${lat},${lng});
  node["amenity"="clinic"](around:${radiusM},${lat},${lng});
  node["amenity"="police"](around:${radiusM},${lat},${lng});
  node["amenity"="fire_station"](around:${radiusM},${lat},${lng});
);
out body;`;

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) throw new Error(`Overpass API error: ${response.status}`);

      const data = await response.json();
      const elements: any[] = data.elements || [];

      const parsed: NearbyPlace[] = elements
        .filter(el => el.lat && el.lon)
        .map(el => {
          const amenity = el.tags?.amenity || 'hospital';
          const type: NearbyPlace['type'] =
            amenity === 'police' ? 'police' :
            amenity === 'fire_station' ? 'police' : // treat as emergency service
            'hospital';

          const name = el.tags?.name ||
            (type === 'police' ? 'Police Station' :
             amenity === 'clinic' ? 'Clinic' : 'Hospital');

          // Calculate approx distance
          const dLat = (el.lat - lat) * Math.PI / 180;
          const dLng = (el.lon - lng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat * Math.PI / 180) * Math.cos(el.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
          const distanceM = Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

          return {
            id: el.id,
            type,
            name,
            lat: el.lat,
            lng: el.lon,
            distanceM,
          };
        })
        .sort((a, b) => (a.distanceM || 0) - (b.distanceM || 0))
        .slice(0, 20); // limit to 20 nearest

      setPlaces(parsed);
      return parsed;
    } catch (err: any) {
      console.error('[NEARBY] Overpass API failed:', err);
      setError('Could not load nearby safety resources');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Add nearby place markers to a Leaflet map.
   * Hospitals = green circles, Police = blue circles.
   * Returns the list of created markers for cleanup.
   */
  const addMarkersToMap = useCallback((
    map: L.Map,
    nearby: NearbyPlace[],
    existingMarkers: L.CircleMarker[] = []
  ): L.CircleMarker[] => {
    // Remove old markers
    existingMarkers.forEach(m => map.removeLayer(m));
    const newMarkers: L.CircleMarker[] = [];

    nearby.forEach(place => {
      const color = place.type === 'police' ? '#3b82f6' : '#2ed573';
      const icon = place.type === 'police' ? '🚔' : '🏥';
      const distText = place.distanceM
        ? place.distanceM < 1000
          ? `${place.distanceM}m away`
          : `${(place.distanceM / 1000).toFixed(1)}km away`
        : '';

      const marker = L.circleMarker([place.lat, place.lng], {
        radius: 7,
        fillColor: color,
        fillOpacity: 0.85,
        color: '#fff',
        weight: 2,
      }).addTo(map);

      marker.bindPopup(
        `<div style="font-family:sans-serif;font-size:13px;min-width:120px">
          <b>${icon} ${place.name}</b>
          ${distText ? `<br><span style="color:#888;font-size:11px">${distText}</span>` : ''}
          <br>
          <a href="https://www.google.com/maps/dir//${place.lat},${place.lng}" target="_blank"
             style="color:#3b82f6;font-size:11px">Get Directions →</a>
        </div>`
      );

      newMarkers.push(marker);
    });

    return newMarkers;
  }, []);

  return { places, loading, error, fetchNearby, addMarkersToMap, markersRef };
}
