import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { sosApi, locationApi, guardianApi } from '../api/client';
import { useToast } from '../context/ToastContext';
import { SkeletonList } from '../components/Skeleton';
import { useBluetooth } from '../hooks/useBluetooth';
import type { BLESOSData } from '../hooks/useBluetooth';
import { useShakeDetection } from '../hooks/useShakeDetection';
import { useVoiceSOS } from '../hooks/useVoiceSOS';
import SOSActive from './SOSActive';

const SOS_COUNTDOWN = 3;

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [sosActive, setSosActive] = useState(false);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [guardians, setGuardians] = useState<any[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [showFakeCall, setShowFakeCall] = useState(false);
  const [loading, setLoading] = useState(true);
  const [triggerSource, setTriggerSource] = useState<'manual' | 'ble_device'>('manual');
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [shakeEnabled, setShakeEnabled] = useState(() => localStorage.getItem('shake_sos') !== 'false');
  const [voiceEnabled, setVoiceEnabled] = useState(() => localStorage.getItem('voice_sos') === 'true');

  useEffect(() => {
    // Load both in-app guardians AND phone-only guardians for accurate count + SOS coverage
    Promise.all([
      guardianApi.myGuardians().catch(() => ({ guardians: [] })),
      guardianApi.phoneGuardians().catch(() => ({ guardians: [] })),
    ]).then(([inApp, phones]) => {
      // Merge: in-app guardians have linkId, phone guardians have id
      const allGuardians = [
        ...(inApp.guardians || []),
        ...(phones.guardians || []).map((g: any) => ({ ...g, linkId: g.id, isPhoneOnly: true })),
      ];
      setGuardians(allGuardians);
    }).finally(() => setLoading(false));
  }, []);

  const startSOSCountdown = useCallback(() => {
    if (triggering || sosCountdown !== null) return;
    navigator.vibrate?.([50, 30, 50]);
    setSosCountdown(SOS_COUNTDOWN);
    let count = SOS_COUNTDOWN;
    countdownRef.current = setInterval(() => {
      count--;
      setSosCountdown(count);
      navigator.vibrate?.([100]);
      if (count <= 0) {
        clearInterval(countdownRef.current);
        setSosCountdown(null);
        triggerSOS();
      }
    }, 1000);
  }, [triggering, sosCountdown]);

  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = undefined; }
    setSosCountdown(null);
    navigator.vibrate?.(0);
    showToast('SOS cancelled', 'info');
  }, [showToast]);

  const triggerSOS = useCallback(async (type: 'manual' | 'ble_device' = 'manual', bleCoords?: BLESOSData) => {
    if (triggering) return;
    setTriggering(true);
    setTriggerSource(type);
    try {
      let lat: number | undefined, lng: number | undefined;
      if (bleCoords) {
        lat = bleCoords.lat; lng = bleCoords.lng;
        await locationApi.update(lat, lng).catch(() => { });
        await sosApi.locationUpdate(lat, lng).catch(() => { });
      } else if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000 })
          );
          lat = pos.coords.latitude; lng = pos.coords.longitude;
          locationApi.update(lat, lng).catch(() => { });
          sosApi.locationUpdate(lat, lng).catch(() => { });
        } catch { }
      }
      const res = await sosApi.trigger(type, lat, lng);
      setIncidentId(res.incidentId);
      setSosActive(true);
      navigator.vibrate?.([200, 100, 200, 100, 400]);
      captureAndUploadMedia(res.incidentId).catch(() => { });
    } catch {
      showToast('Failed to trigger SOS', 'error');
    } finally {
      setTriggering(false);
    }
  }, [triggering, showToast]);

  const captureAndUploadMedia = async (incidentId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 1280, height: 720 },
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;

      // Wait for video to have decoded at least one frame before capturing
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(), 3000); // fallback after 3s
        video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
        video.onerror = () => { clearTimeout(timeout); reject(new Error('Video load failed')); };
        video.play().catch(reject);
      });

      // Wait one extra animation frame to ensure frame is painted
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Cleanup stream
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;

      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas empty')), 'image/jpeg', 0.85)
      );

      if (blob && blob.size > 1000) { // sanity check: ignore tiny/black blobs
        await sosApi.attachMedia(incidentId, blob, 'image');
      }
    } catch (err) {
      console.warn('[MEDIA] Capture failed:', err);
    }
  };

  const handleBLESOS = useCallback((data: BLESOSData) => {
    if (sosActive || triggering) return;
    showToast('SOS from safety device!', 'warning', 4000);
    triggerSOS('ble_device', data);
  }, [sosActive, triggering, triggerSOS, showToast]);

  const ble = useBluetooth(handleBLESOS);

  // Shake-to-SOS
  useShakeDetection(useCallback(() => {
    if (sosActive || triggering) return;
    showToast('Shake detected — triggering SOS!', 'warning', 3000);
    triggerSOS('manual');
  }, [sosActive, triggering, triggerSOS, showToast]), shakeEnabled && !sosActive);

  // Voice SOS
  const voice = useVoiceSOS(useCallback(() => {
    if (sosActive || triggering) return;
    showToast('Voice SOS detected!', 'warning', 3000);
    triggerSOS('manual');
  }, [sosActive, triggering, triggerSOS, showToast]), voiceEnabled && !sosActive);

  const handleSOSCancelled = () => {
    setSosActive(false);
    setIncidentId(null);
    setTriggerSource('manual');
    showToast('SOS cancelled — you are safe', 'success');
  };

  if (sosActive && incidentId) {
    return <SOSActive incidentId={incidentId} guardians={guardians} onCancelled={handleSOSCancelled} triggerSource={triggerSource} />;
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      {sosCountdown !== null && (
        <div className="sos-countdown-overlay">
          <div className="sos-countdown-content">
            <div className="sos-countdown-number">{sosCountdown}</div>
            <div className="sos-countdown-label">SOS triggering in...</div>
            <button className="btn btn-secondary" onClick={cancelCountdown} style={{ marginTop: 24 }}>Cancel</button>
          </div>
        </div>
      )}

      {showFakeCall && (
        <div className="fake-call-overlay">
          <div className="fake-call-avatar">👨</div>
          <div className="fake-call-name">Dad</div>
          <div className="fake-call-status">Incoming call...</div>
          <div className="fake-call-actions">
            <button className="fake-call-btn fake-call-decline" onClick={() => setShowFakeCall(false)}>📵</button>
            <button className="fake-call-btn fake-call-accept" onClick={() => setShowFakeCall(false)}>📞</button>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="home-hero">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="home-greeting">{greeting}</div>
            <div className="home-name">{user?.name?.split(' ')[0]} 👋</div>
            <div className="home-tagline">Stay safe, stay protected</div>
          </div>
          <div className="status-badge status-safe">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--safe)', display: 'inline-block' }} />
            Safe
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {[
            { val: guardians.length, lbl: 'Guardians', color: 'var(--safe)' },
            { val: ble.connected ? '1' : '0', lbl: 'Device', color: 'var(--info)' },
            { val: '24/7', lbl: 'Active', color: 'var(--warning)' },
          ].map(s => (
            <div key={s.lbl} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* SOS */}
      <div className="sos-wrapper">
        <div className="sos-outer" style={{ position: 'relative' }}>
          <span className="sos-pulse-ring" />
          <span className="sos-pulse-ring" />
          <span className="sos-pulse-ring" />
          <button className="sos-btn" onClick={startSOSCountdown} disabled={triggering} id="sos-trigger-btn">
            {triggering
              ? <div className="spinner" style={{ width: 36, height: 36, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
              : 'SOS'}
          </button>
        </div>
      </div>
      <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
        Tap for {SOS_COUNTDOWN}s countdown • Alerts all guardians
        {ble.connected && <span style={{ color: 'var(--safe)' }}> • Device linked</span>}
      </p>

      {/* Shake & Voice toggles */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, justifyContent: 'center' }}>
        <button
          className={`hour-chip ${shakeEnabled ? 'active' : ''}`}
          onClick={() => { const v = !shakeEnabled; setShakeEnabled(v); localStorage.setItem('shake_sos', String(v)); showToast(v ? 'Shake-to-SOS ON' : 'Shake-to-SOS OFF'); }}
        >
          📳 Shake SOS
        </button>
        <button
          className={`hour-chip ${voiceEnabled ? 'active' : ''}`}
          onClick={() => { const v = !voiceEnabled; setVoiceEnabled(v); localStorage.setItem('voice_sos', String(v)); showToast(v ? 'Voice SOS ON — say "help"' : 'Voice SOS OFF'); }}
        >
          {voice.listening ? '🎙️ Listening' : '🎤 Voice SOS'}
        </button>
      </div>

      {/* Quick Actions */}
      <div className="section-title">Quick Actions</div>
      {loading ? (
        <div className="actions-grid">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton" style={{ height: 88, borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div className="actions-grid">
          <button className="action-card-v2 accent" onClick={() => {
            navigator.geolocation?.getCurrentPosition(pos => {
              const url = `https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;
              const text = `I need help! My location: ${url}`;
              if (navigator.share) navigator.share({ title: 'My Location', text });
              else { navigator.clipboard.writeText(text); showToast('Location copied!'); }
            }, () => showToast('Location access denied', 'error'));
          }}>
            <div className="action-card-icon-wrap">📍</div>
            <div className="action-card-label">Share Location</div>
            <div className="action-card-sub">Send to contacts</div>
          </button>

          <button className="action-card-v2 warning" onClick={() => setShowFakeCall(true)}>
            <div className="action-card-icon-wrap">📞</div>
            <div className="action-card-label">Fake Call</div>
            <div className="action-card-sub">Escape situations</div>
          </button>

          <button className="action-card-v2 safe" onClick={() => {
            navigator.geolocation?.getCurrentPosition(pos => {
              locationApi.update(pos.coords.latitude, pos.coords.longitude).catch(() => { });
            });
            locationApi.heartbeat().catch(() => { });
            showToast('Heartbeat sent');
          }}>
            <div className="action-card-icon-wrap">❤️</div>
            <div className="action-card-label">I'm Safe</div>
            <div className="action-card-sub">Update guardians</div>
          </button>

          <button className="action-card-v2 info" onClick={() => navigate('/safe-route')}>
            <div className="action-card-icon-wrap">🗺️</div>
            <div className="action-card-label">Safe Route</div>
            <div className="action-card-sub">Find safe paths</div>
          </button>

          <button className="action-card-v2" onClick={() => navigate('/history')}>
            <div className="action-card-icon-wrap">📋</div>
            <div className="action-card-label">History</div>
            <div className="action-card-sub">Past incidents</div>
          </button>

          <button className="action-card-v2 info" onClick={() => navigate('/community')}>
            <div className="action-card-icon-wrap">🗣️</div>
            <div className="action-card-label">Community</div>
            <div className="action-card-sub">Report incidents</div>
          </button>

          <button className="action-card-v2" onClick={() => navigate('/safety-tools')}>
            <div className="action-card-icon-wrap">⏱️</div>
            <div className="action-card-label">Safety Tools</div>
            <div className="action-card-sub">Timer & Journey</div>
          </button>

          <button className="action-card-v2" onClick={() => navigate('/analytics')}>
            <div className="action-card-icon-wrap">📊</div>
            <div className="action-card-label">Analytics</div>
            <div className="action-card-sub">Crime trends</div>
          </button>

          <button
            className={`action-card-v2 ${ble.connected ? 'safe' : ''}`}
            onClick={() => ble.connected ? ble.disconnect() : ble.connect()}
            disabled={ble.connecting}
          >
            <div className="action-card-icon-wrap">{ble.connecting ? '⏳' : ble.connected ? '📟' : '📡'}</div>
            <div className="action-card-label">{ble.connecting ? 'Pairing...' : ble.connected ? 'Device' : 'Pair Device'}</div>
            <div className="action-card-sub">{ble.connected ? 'BLE connected' : 'Safety wearable'}</div>
          </button>
        </div>
      )}

      {/* Guardians */}
      <div className="section-title">My Guardians</div>
      {loading ? (
        <SkeletonList count={2} />
      ) : guardians.length === 0 ? (
        <button className="card" style={{ textAlign: 'center', padding: 24, width: '100%' }} onClick={() => navigate('/guardians')}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🤝</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            No guardians yet. <span style={{ color: 'var(--accent)' }}>Tap to add one →</span>
          </p>
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
          {guardians.map((g: any, idx: number) => (
            <div key={g.linkId || g.id || idx} className="card" style={{ minWidth: 100, textAlign: 'center', flexShrink: 0, padding: '14px 10px' }}>
              <div className="guardian-avatar" style={{ width: 36, height: 36, fontSize: 14, margin: '0 auto 8px' }}>
                {g.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
              <div style={{ fontSize: 10, color: g.isPhoneOnly ? 'var(--info)' : 'var(--safe)', marginTop: 3 }}>
                {g.isPhoneOnly ? '📞 Phone' : 'Active'}
              </div>
            </div>
          ))}
          <button className="card" style={{ minWidth: 80, textAlign: 'center', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => navigate('/guardians')}>
            <span style={{ fontSize: 24, color: 'var(--text-muted)' }}>+</span>
          </button>
        </div>
      )}
    </div>
  );
}
