import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import { communityApi } from '../api/client';
import { useToast } from '../context/ToastContext';

const INCIDENT_TYPES = [
    { value: 'harassment', label: 'Harassment', icon: '😡', color: '#ff4757' },
    { value: 'theft', label: 'Theft', icon: '🦹', color: '#ffa502' },
    { value: 'assault', label: 'Assault', icon: '⚠️', color: '#ff4757' },
    { value: 'suspicious', label: 'Suspicious', icon: '👁️', color: '#ffa502' },
    { value: 'accident', label: 'Accident', icon: '🚗', color: '#3b82f6' },
    { value: 'other', label: 'Other', icon: '📌', color: '#94a3b8' },
];

export default function Community() {
    const { showToast } = useToast();
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletMap = useRef<L.Map | null>(null);
    const markersRef = useRef<L.Marker[]>([]);
    const [currentPos, setCurrentPos] = useState<[number, number] | null>(null);
    const [incidents, setIncidents] = useState<any[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ type: 'suspicious', description: '' });
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!mapRef.current || leafletMap.current) return;
        leafletMap.current = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([19.07, 72.87], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap.current);
        L.control.zoom({ position: 'topright' }).addTo(leafletMap.current);

        navigator.geolocation?.getCurrentPosition(pos => {
            const latlng: [number, number] = [pos.coords.latitude, pos.coords.longitude];
            setCurrentPos(latlng);
            leafletMap.current?.setView(latlng, 14);
            L.circleMarker(latlng, { radius: 8, fillColor: '#3b82f6', fillOpacity: 1, color: '#fff', weight: 2 })
                .addTo(leafletMap.current!).bindPopup('You');
            loadNearby(latlng[0], latlng[1]);
        }, () => { loadNearby(19.07, 72.87); }, { enableHighAccuracy: true });
    }, []);

    const loadNearby = async (lat: number, lng: number) => {
        setLoading(true);
        try {
            const r = await communityApi.nearby(lat, lng, 5);
            setIncidents(r.incidents || []);
            renderMarkers(r.incidents || []);
        } catch { setIncidents([]); }
        setLoading(false);
    };

    const renderMarkers = (items: any[]) => {
        if (!leafletMap.current) return;
        markersRef.current.forEach(m => leafletMap.current!.removeLayer(m));
        markersRef.current = [];
        items.forEach(inc => {
            const t = INCIDENT_TYPES.find(x => x.value === inc.type) || INCIDENT_TYPES[5];
            const icon = L.divIcon({
                html: `<div style="background:${t.color};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3)">${t.icon}</div>`,
                className: '', iconSize: [28, 28], iconAnchor: [14, 14],
            });
            const m = L.marker([inc.lat, inc.lng], { icon }).addTo(leafletMap.current!);
            m.bindPopup(`<div style="font-family:sans-serif;font-size:13px"><b>${t.icon} ${t.label}</b><br>${inc.description || 'No description'}<br><small style="color:#888">${new Date(inc.createdAt).toLocaleTimeString()} • ${inc.upvotes || 0} upvotes</small></div>`);
            markersRef.current.push(m);
        });
    };

    const handleReport = async () => {
        if (!currentPos) { showToast('Location not available', 'error'); return; }
        setSubmitting(true);
        try {
            await communityApi.report({ lat: currentPos[0], lng: currentPos[1], type: form.type, description: form.description });
            showToast('Incident reported — thank you!', 'success');
            setShowForm(false);
            setForm({ type: 'suspicious', description: '' });
            loadNearby(currentPos[0], currentPos[1]);
        } catch { showToast('Failed to report', 'error'); }
        setSubmitting(false);
    };

    const handleUpvote = async (id: string) => {
        try {
            await communityApi.upvote(id);
            setIncidents(prev => prev.map(i => i.id === id ? { ...i, upvotes: (i.upvotes || 0) + 1 } : i));
        } catch { }
    };

    const timeAgo = (iso: string) => {
        const diff = Date.now() - new Date(iso).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m}m ago`;
        return `${Math.floor(m / 60)}h ago`;
    };

    return (
        <div className="page" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 16px 0' }}>
                <h1 className="page-header" style={{ marginBottom: 8 }}>🗣️ Community Reports</h1>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Real-time crowd-sourced safety incidents near you
                </p>
            </div>

            <div ref={mapRef} style={{ height: 240, margin: '0 16px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)' }} />

            <div style={{ padding: '12px 16px', flex: 1, overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{incidents.length} incidents nearby</div>
                    <button className="btn btn-primary btn-sm" onClick={() => setShowForm(f => !f)}>
                        {showForm ? 'Cancel' : '+ Report Incident'}
                    </button>
                </div>

                {showForm && (
                    <div className="card" style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Report an Incident</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                            {INCIDENT_TYPES.map(t => (
                                <button key={t.value}
                                    className={`hour-chip ${form.type === t.value ? 'active' : ''}`}
                                    onClick={() => setForm(f => ({ ...f, type: t.value }))}>
                                    {t.icon} {t.label}
                                </button>
                            ))}
                        </div>
                        <textarea
                            className="input"
                            placeholder="Brief description (optional)"
                            value={form.description}
                            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                            rows={2}
                            style={{ resize: 'none', marginBottom: 8 }}
                        />
                        <button className="btn btn-primary btn-block btn-sm" onClick={handleReport} disabled={submitting}>
                            {submitting ? 'Reporting...' : 'Submit Report'}
                        </button>
                    </div>
                )}

                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><div className="spinner" /></div>
                ) : incidents.length === 0 ? (
                    <div className="empty-state"><div className="emoji">✅</div><p>No incidents reported nearby. Stay safe!</p></div>
                ) : (
                    incidents.map(inc => {
                        const t = INCIDENT_TYPES.find(x => x.value === inc.type) || INCIDENT_TYPES[5];
                        return (
                            <div key={inc.id} className="card" style={{ marginBottom: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${t.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                                    {t.icon}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: 13, color: t.color }}>{t.label}</div>
                                    {inc.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{inc.description}</div>}
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{timeAgo(inc.createdAt)}</div>
                                </div>
                                <button
                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}
                                    onClick={() => handleUpvote(inc.id)}
                                >
                                    <span>👍</span>
                                    <span>{inc.upvotes || 0}</span>
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
