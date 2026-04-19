import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import { guardianApi, locationApi } from '../api/client';
import { useSocket } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { SkeletonList } from '../components/Skeleton';

export default function GuardianHub() {
  const [tab, setTab] = useState<'guardians' | 'pending' | 'notifications' | 'dashboard'>('guardians');
  const [guardians, setGuardians] = useState<any[]>([]);
  const [pending, setPending] = useState<{ incoming: any[]; outgoing: any[] }>({ incoming: [], outgoing: [] });
  const [notifications, setNotifications] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any[]>([]);
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [trackingUser, setTrackingUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);

  const { socket } = useSocket();
  const { showToast } = useToast();

  const loadData = async () => {
    try {
      const [g, p, n, d] = await Promise.all([
        guardianApi.myGuardians(),
        guardianApi.pending(),
        guardianApi.notifications(),
        guardianApi.dashboard().catch(() => ({ dashboard: [] })),
      ]);
      setGuardians(g.guardians || []);
      setPending({ incoming: p.incoming || [], outgoing: p.outgoing || [] });
      setNotifications(n.notifications || []);
      setDashboard(d.dashboard || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  // Real-time updates via WebSocket (replaces 15s polling)
  useEffect(() => {
    if (!socket) return;

    const handleSOSTriggered = () => {
      // Refresh dashboard immediately when SOS is triggered
      guardianApi.dashboard().then(d => setDashboard(d.dashboard || [])).catch(() => {});
      guardianApi.notifications().then(n => setNotifications(n.notifications || [])).catch(() => {});
    };

    const handleSOSResolved = () => {
      guardianApi.dashboard().then(d => setDashboard(d.dashboard || [])).catch(() => {});
      guardianApi.notifications().then(n => setNotifications(n.notifications || [])).catch(() => {});
    };

    const handleLocationUpdate = (data: any) => {
      // Update tracking map in real-time
      if (trackingUser && data.userId === trackingUser.userId) {
        setTrackingUser((prev: any) => prev ? ({
          ...prev,
          lat: data.lat,
          lng: data.lng,
          updatedAt: data.timestamp,
        }) : prev);
      }

      // Update dashboard location
      setDashboard(prev =>
        prev.map(u =>
          u.protectedId === data.userId
            ? { ...u, location: { lat: data.lat, lng: data.lng, updatedAt: data.timestamp } }
            : u
        )
      );
    };

    socket.on('sos:triggered', handleSOSTriggered);
    socket.on('sos:cancelled', handleSOSResolved);
    socket.on('sos:resolved', handleSOSResolved);
    socket.on('location:update', handleLocationUpdate);

    return () => {
      socket.off('sos:triggered', handleSOSTriggered);
      socket.off('sos:cancelled', handleSOSResolved);
      socket.off('sos:resolved', handleSOSResolved);
      socket.off('location:update', handleLocationUpdate);
    };
  }, [socket, trackingUser]);

  // Fallback polling every 30s (in case WebSocket is disconnected)
  useEffect(() => {
    const interval = setInterval(() => {
      guardianApi.notifications().then(n => setNotifications(n.notifications || [])).catch(() => {});
      guardianApi.dashboard().then(d => setDashboard(d.dashboard || [])).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleInvite = async () => {
    if (!email.trim()) return;
    setInviting(true);
    try {
      const res = await guardianApi.inviteByEmail(email.trim());
      if (res.success) {
        showToast(`Invited ${res.guardianName || email}!`);
        setEmail('');
        loadData();
      } else {
        showToast(res.message || 'Failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to invite', 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleConfirm = async (linkId: string) => {
    try { await guardianApi.confirm(linkId); showToast('Guardian confirmed!'); loadData(); } catch { showToast('Failed', 'error'); }
  };
  const handleReject = async (linkId: string) => {
    try { await guardianApi.reject(linkId); showToast('Rejected'); loadData(); } catch { showToast('Failed', 'error'); }
  };
  const handleRemove = async (linkId: string) => {
    try { await guardianApi.remove(linkId); showToast('Removed'); loadData(); } catch { showToast('Failed', 'error'); }
  };

  // Open tracking map for a protected user
  const openTracking = async (userId: string, name: string) => {
    try {
      const loc = await locationApi.live(userId);
      setTrackingUser({ userId, name, lat: loc.lat, lng: loc.lng, updatedAt: loc.updatedAt });
    } catch {
      showToast('Location not available', 'error');
    }
  };

  // Init tracking map
  useEffect(() => {
    if (!trackingUser || !mapRef.current) return;
    if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }

    leafletMap.current = L.map(mapRef.current, {
      zoomControl: false, attributionControl: false,
    }).setView([trackingUser.lat || 20.5937, trackingUser.lng || 78.9629], trackingUser.lat ? 15 : 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap.current);
    // Force layout recalc after WebView renders the modal
    setTimeout(() => leafletMap.current?.invalidateSize(), 150);

    if (trackingUser.lat && trackingUser.lng) {
      markerRef.current = L.circleMarker([trackingUser.lat, trackingUser.lng], {
        radius: 8, fillColor: '#ff4757', fillOpacity: 1, color: '#fff', weight: 3,
      }).addTo(leafletMap.current).bindPopup(`${trackingUser.name}'s location`).openPopup();
    }
  }, [trackingUser?.userId]);

  // Update tracking map marker in real-time
  useEffect(() => {
    if (!trackingUser?.lat || !trackingUser?.lng || !leafletMap.current) return;
    const latlng: [number, number] = [trackingUser.lat, trackingUser.lng];
    leafletMap.current.setView(latlng, 16);
    if (markerRef.current) {
      markerRef.current.setLatLng(latlng);
    } else {
      markerRef.current = L.circleMarker(latlng, {
        radius: 8, fillColor: '#ff4757', fillOpacity: 1, color: '#fff', weight: 3,
      }).addTo(leafletMap.current);
    }
  }, [trackingUser?.lat, trackingUser?.lng]);

  const dangerUsers = dashboard.filter((d: any) => d.hasActiveIncident);
  const unreadCount = notifications.filter((n: any) => !n.read).length;

  return (
    <div className="page">
      {/* Tracking modal */}
      {trackingUser && (
        <div className="sos-active-overlay" style={{ zIndex: 250 }}>
          <div style={{ padding: '16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>📍 {trackingUser.name}'s Location</h2>
            <button className="btn btn-secondary btn-sm" onClick={() => { setTrackingUser(null); if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; } }}>
              Close
            </button>
          </div>
          <div ref={mapRef} style={{ flex: 1, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)' }} />
          {trackingUser.updatedAt && (
            <div style={{ padding: '8px 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              Last updated: {new Date(trackingUser.updatedAt).toLocaleTimeString()}
              {trackingUser.lat && ` • ${trackingUser.lat.toFixed(4)}, ${trackingUser.lng?.toFixed(4)}`}
            </div>
          )}
          {/* Quick actions in tracking */}
          <div style={{ display: 'flex', gap: 8, paddingBottom: 16 }}>
            <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => {
              if (trackingUser.lat) window.open(`https://www.google.com/maps?q=${trackingUser.lat},${trackingUser.lng}`, '_blank');
            }}>
              🗺️ Open in Maps
            </button>
            <button className="btn btn-safe btn-sm" style={{ flex: 1 }} onClick={() => {
              window.location.href = 'tel:112';
            }}>
              📞 Call User
            </button>
          </div>
        </div>
      )}

      <h1 className="page-header">🛡️ Guardian Hub</h1>

      {/* Danger Alert Banner */}
      {dangerUsers.length > 0 && (
        <div className="guardian-danger-banner">
          <div className="guardian-danger-header">
            <span>🚨</span> DANGER ALERT
            <div className="live-indicator">
              <span className="live-dot" /> LIVE
            </div>
          </div>
          {dangerUsers.map((u: any) => (
            <div key={u.linkId} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div className="guardian-avatar" style={{ width: 32, height: 32, fontSize: 13, background: 'linear-gradient(135deg, #ff4757, #c0392b)' }}>
                {u.name?.[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name} is in danger!</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {u.activeIncidents?.[0]?.triggerType || 'SOS'} — Active
                </div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => openTracking(u.protectedId, u.name)}>
                📍 Track
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Invite */}
      <div className="invite-row">
        <input className="input" placeholder="Enter guardian's email" value={email}
          onChange={e => setEmail(e.target.value)} type="email" />
        <button className="btn btn-primary btn-sm" onClick={handleInvite} disabled={inviting}>
          {inviting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Invite'}
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab === 'guardians' ? 'active' : ''}`} onClick={() => setTab('guardians')}>
          Guardians ({guardians.length})
        </button>
        <button className={`tab ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
          Dashboard ({dashboard.length})
        </button>
        <button className={`tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
          Pending ({pending.incoming.length + pending.outgoing.length})
        </button>
        <button className={`tab ${tab === 'notifications' ? 'active' : ''}`} onClick={() => setTab('notifications')}>
          Alerts {unreadCount > 0 && <span className="tab-badge">{unreadCount}</span>}
        </button>
      </div>

      {/* Loading state */}
      {loading ? (
        <SkeletonList count={3} />
      ) : (
        <>
          {/* Guardians Tab */}
          {tab === 'guardians' && (
            <div className="guardian-list">
              {guardians.length === 0 ? (
                <div className="empty-state">
                  <div className="emoji">🤝</div>
                  <p>No guardians yet.<br />Enter an email above to invite someone!</p>
                </div>
              ) : guardians.map((g: any) => (
                <div key={g.linkId} className="guardian-card">
                  <div className="guardian-avatar">{g.name?.[0]?.toUpperCase() || '?'}</div>
                  <div className="guardian-info">
                    <div className="guardian-name">{g.name}</div>
                    <div className="guardian-email">{g.email || g.phone || ''}</div>
                  </div>
                  <div className="guardian-actions">
                    {g.phone && <a href={`tel:${g.phone}`} className="guardian-action-btn">📞</a>}
                    <button className="guardian-action-btn" onClick={() => handleRemove(g.linkId)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Dashboard Tab */}
          {tab === 'dashboard' && (
            <div className="guardian-list">
              {dashboard.length === 0 ? (
                <div className="empty-state">
                  <div className="emoji">👁️</div>
                  <p>No users you are guarding yet.</p>
                </div>
              ) : dashboard.map((u: any) => (
                <div key={u.linkId} className="guardian-card" style={{
                  borderColor: u.hasActiveIncident ? 'var(--accent)' : 'var(--border)',
                  background: u.hasActiveIncident ? 'var(--accent-soft)' : 'var(--bg-card)',
                  flexDirection: 'column', alignItems: 'stretch',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className="guardian-avatar" style={{
                      background: u.hasActiveIncident
                        ? 'linear-gradient(135deg, #ff4757, #c0392b)'
                        : 'linear-gradient(135deg, #2ed573, #7bed9f)',
                    }}>
                      {u.hasActiveIncident ? '🚨' : '✓'}
                    </div>
                    <div className="guardian-info">
                      <div className="guardian-name">{u.name}</div>
                      <div className="guardian-email">
                        {u.hasActiveIncident
                          ? '⚠️ IN DANGER — Active SOS'
                          : u.lastHeartbeat
                            ? `Last seen: ${new Date(u.lastHeartbeat).toLocaleTimeString()}`
                            : 'Status: Safe'}
                      </div>
                    </div>
                    <button className="guardian-action-btn" onClick={() => openTracking(u.protectedId, u.name)}>📍</button>
                  </div>
                  {/* Show captured media if available on active incident */}
                  {u.hasActiveIncident && u.activeIncidents?.[0]?.mediaUrl && (
                    <div style={{ marginTop: 8, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                      {u.activeIncidents[0].mediaType === 'video' ? (
                        <video
                          src={u.activeIncidents[0].mediaUrl}
                          controls
                          playsInline
                          style={{ width: '100%', maxHeight: 140, objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <img
                          src={u.activeIncidents[0].mediaUrl}
                          alt="Captured evidence"
                          style={{ width: '100%', maxHeight: 140, objectFit: 'cover', display: 'block' }}
                        />
                      )}
                      <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-card)' }}>
                        📎 Evidence captured
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pending Tab */}
          {tab === 'pending' && (
            <div className="guardian-list">
              {pending.incoming.length > 0 && (
                <>
                  <div className="section-title" style={{ marginTop: 0 }}>Incoming Requests</div>
                  {pending.incoming.map((p: any) => (
                    <div key={p.linkId} className="guardian-card">
                      <div className="guardian-avatar" style={{ background: 'linear-gradient(135deg, #ffa502, #ff6348)' }}>📩</div>
                      <div className="guardian-info">
                        <div className="guardian-name">Guardian Request</div>
                        <div className="guardian-email">Tap to accept or reject</div>
                      </div>
                      <div className="guardian-actions">
                        <button className="guardian-action-btn" style={{ background: 'var(--safe-glow)' }} onClick={() => handleConfirm(p.linkId)}>✓</button>
                        <button className="guardian-action-btn" style={{ background: 'var(--accent-soft)' }} onClick={() => handleReject(p.linkId)}>✕</button>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {pending.outgoing.length > 0 && (
                <>
                  <div className="section-title">Sent Requests</div>
                  {pending.outgoing.map((p: any) => (
                    <div key={p.linkId} className="guardian-card" style={{ opacity: 0.6 }}>
                      <div className="guardian-avatar" style={{ background: 'linear-gradient(135deg, #3b82f6, #667eea)' }}>📤</div>
                      <div className="guardian-info">
                        <div className="guardian-name">Pending</div>
                        <div className="guardian-email">Waiting for confirmation</div>
                      </div>
                      <button className="guardian-action-btn" onClick={() => handleReject(p.linkId)}>✕</button>
                    </div>
                  ))}
                </>
              )}
              {pending.incoming.length === 0 && pending.outgoing.length === 0 && (
                <div className="empty-state"><div className="emoji">📭</div><p>No pending requests</p></div>
              )}
            </div>
          )}

          {/* Notifications Tab */}
          {tab === 'notifications' && (
            <div className="guardian-list">
              {notifications.length > 0 && (
                <button className="btn btn-secondary btn-sm btn-block" style={{ marginBottom: 12 }}
                  onClick={async () => { await guardianApi.markAllRead(); loadData(); }}>
                  Mark all as read
                </button>
              )}
              {notifications.length === 0 ? (
                <div className="empty-state"><div className="emoji">🔔</div><p>No notifications yet</p></div>
              ) : notifications.map((n: any) => (
                <div key={n.id} className="card" style={{
                  marginBottom: 8,
                  borderLeft: n.read ? 'none' : '3px solid var(--accent)',
                  background: n.read ? 'var(--bg-card)' : 'var(--accent-soft)',
                }}
                  onClick={async () => { if (!n.read) { await guardianApi.markRead(n.id); loadData(); } }}>
                  <div style={{ fontSize: 14, fontWeight: n.read ? 400 : 600 }}>{n.message}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
