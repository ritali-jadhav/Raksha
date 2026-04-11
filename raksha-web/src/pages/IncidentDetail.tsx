import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { sosApi, evidenceApi } from '../api/client';

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [incident, setIncident] = useState<any>(null);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      sosApi.incident(id).catch(() => null),
      evidenceApi.list(id).catch(() => ({ evidence: [] })),
    ]).then(([inc, ev]) => {
      setIncident(inc?.incident || inc);
      setEvidence(ev?.evidence || []);
    }).finally(() => setLoading(false));
  }, [id]);

  // Init map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current || !incident) return;
    const lat = incident.lastLat || incident.lat;
    const lng = incident.lastLng || incident.lng;

    leafletMap.current = L.map(mapRef.current, {
      zoomControl: false, attributionControl: false,
    }).setView([lat || 20.5937, lng || 78.9629], lat ? 15 : 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap.current);

    if (lat && lng) {
      L.circleMarker([lat, lng], {
        radius: 8, fillColor: '#ff4757', fillOpacity: 1, color: '#fff', weight: 2,
      }).addTo(leafletMap.current).bindPopup('Incident location');
    }
  }, [incident]);

  const getStatusClass = (s: string) => s === 'active' ? 'active' : s === 'cancelled' ? 'cancelled' : 'resolved';

  const buildTimeline = () => {
    if (!incident) return [];
    const events: { time: string; text: string; type: string }[] = [];

    events.push({ time: incident.createdAt, text: `SOS triggered (${incident.triggerType || 'manual'})`, type: 'danger' });

    if (incident.escalationStage >= 1) {
      events.push({ time: incident.escalationStartedAt || incident.createdAt, text: 'Escalation started', type: 'warning' });
    }
    for (let i = 1; i <= (incident.escalationStage || 0); i++) {
      events.push({ time: '', text: `Escalation stage ${i} reached`, type: 'warning' });
    }

    if (incident.cancelledAt) {
      events.push({ time: incident.cancelledAt, text: 'SOS cancelled by user (PIN verified)', type: 'safe' });
    }
    if (incident.resolvedAt) {
      events.push({ time: incident.resolvedAt, text: 'Incident resolved', type: 'safe' });
    }

    return events;
  };

  if (loading) {
    return (
      <div className="page">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="page">
        <button className="detail-back" onClick={() => navigate('/history')}>← Back</button>
        <div className="empty-state">
          <div className="emoji">❌</div>
          <p>Incident not found</p>
        </div>
      </div>
    );
  }

  const timeline = buildTimeline();

  return (
    <div className="page">
      <button className="detail-back" onClick={() => navigate('/history')}>← Back to History</button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
            {incident.triggerType === 'geofence_breach' ? '📍 Geofence Breach' : '🚨 SOS Alert'}
          </h1>
          <div className="incident-date">{new Date(incident.createdAt).toLocaleString()}</div>
        </div>
        <span className={`incident-status ${getStatusClass(incident.status)}`}>
          {incident.status}
        </span>
      </div>

      {/* Map */}
      <div ref={mapRef} className="map-container" style={{ height: 200, marginBottom: 16 }} />

      {/* Details Card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Trigger</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{incident.triggerType || 'Manual'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Escalation</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: incident.escalationStage > 0 ? 'var(--warning)' : 'var(--text-secondary)' }}>
              Stage {incident.escalationStage || 0}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Started</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
              {new Date(incident.createdAt).toLocaleTimeString()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Duration</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
              {incident.cancelledAt || incident.resolvedAt
                ? `${Math.round((new Date(incident.cancelledAt || incident.resolvedAt).getTime() - new Date(incident.createdAt).getTime()) / 60000)} min`
                : 'Ongoing'}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="section-title">📋 Event Timeline</div>
      <div className="timeline">
        {timeline.map((ev, i) => (
          <div key={i} className={`timeline-item ${ev.type}`}>
            {ev.time && <div className="tl-time">{new Date(ev.time).toLocaleTimeString()}</div>}
            <div className="tl-text">{ev.text}</div>
          </div>
        ))}
      </div>

      {/* Primary Captured Media (from SOS trigger) */}
      {incident.mediaUrl && (
        <>
          <div className="section-title">📸 Captured Media</div>
          <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 16 }}>
            {incident.mediaType === 'video' ? (
              <video
                src={incident.mediaUrl}
                controls
                playsInline
                style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <a href={incident.mediaUrl} target="_blank" rel="noopener">
                <img
                  src={incident.mediaUrl}
                  alt="Captured evidence"
                  style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                />
              </a>
            )}
            <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-card)' }}>
              📎 Auto-captured at SOS trigger{incident.mediaUpdatedAt ? ` • ${new Date(incident.mediaUpdatedAt).toLocaleTimeString()}` : ''}
            </div>
          </div>
        </>
      )}

      {/* Evidence */}
      {evidence.length > 0 && (
        <>
          <div className="section-title">📎 Evidence ({evidence.length})</div>
          <div className="media-grid">
            {evidence.map((ev: any) => (
              <a key={ev.id} href={ev.url} target="_blank" rel="noopener" className="media-thumb">
                {ev.type === 'image' ? (
                  <img src={ev.url} alt="evidence" />
                ) : ev.type === 'video' ? (
                  <video src={ev.url} />
                ) : (
                  <span>🎵</span>
                )}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
