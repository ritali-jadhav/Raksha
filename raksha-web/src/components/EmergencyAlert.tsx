import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import type { SOSAlert } from '../context/SocketContext';
import L from 'leaflet';

/**
 * Full-screen emergency alert overlay for guardians.
 * Triggered when a protected user activates SOS via WebSocket.
 * Shows live location, quick actions, and alarm feedback.
 */
export default function EmergencyAlert() {
  const { sosAlerts, dismissAlert, socket } = useSocket();
  const [activeAlert, setActiveAlert] = useState<SOSAlert | null>(null);
  const [timer, setTimer] = useState(0);
  const [responded, setResponded] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Pick the most recent active alert
  useEffect(() => {
    const active = sosAlerts.filter(a => a.status === 'active');
    if (active.length > 0 && !activeAlert) {
      setActiveAlert(active[active.length - 1]);
      setTimer(0);
      setResponded(false);
    } else if (activeAlert && activeAlert.status !== 'active') {
      // Alert was cancelled/resolved
      const updated = sosAlerts.find(a => a.incidentId === activeAlert.incidentId);
      if (updated && updated.status !== 'active') {
        stopAlarm();
        // Keep showing for 3 seconds with resolved status
        setTimeout(() => {
          setActiveAlert(null);
          if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }
        }, 3000);
      }
    }
  }, [sosAlerts]);

  // Timer
  useEffect(() => {
    if (!activeAlert || activeAlert.status !== 'active') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => setTimer(s => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeAlert]);

  // Alarm sound
  useEffect(() => {
    if (!activeAlert || activeAlert.status !== 'active') return;
    startAlarm();

    // Vibrate
    if (navigator.vibrate) {
      const vibratePattern = () => navigator.vibrate([300, 200, 300, 200, 600]);
      vibratePattern();
      const vib = setInterval(vibratePattern, 2000);
      return () => { clearInterval(vib); navigator.vibrate(0); };
    }
  }, [activeAlert?.incidentId]);

  // Map initialization + live location updates
  useEffect(() => {
    if (!activeAlert || !mapRef.current) return;
    if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }

    leafletMap.current = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([activeAlert.lat || 20.5937, activeAlert.lng || 78.9629], activeAlert.lat ? 15 : 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
      .addTo(leafletMap.current);
    // Force layout recalc in WebView/APK
    setTimeout(() => leafletMap.current?.invalidateSize(), 150);

    if (activeAlert.lat && activeAlert.lng) {
      markerRef.current = L.circleMarker([activeAlert.lat, activeAlert.lng], {
        radius: 10, fillColor: '#ff4757', fillOpacity: 1, color: '#fff', weight: 3,
      }).addTo(leafletMap.current);
    }
  }, [activeAlert?.incidentId]);

  // Update marker on location changes
  useEffect(() => {
    if (!activeAlert?.lat || !activeAlert?.lng || !leafletMap.current) return;
    const latlng: [number, number] = [activeAlert.lat, activeAlert.lng];
    leafletMap.current.setView(latlng, 16);
    if (markerRef.current) {
      markerRef.current.setLatLng(latlng);
    } else {
      markerRef.current = L.circleMarker(latlng, {
        radius: 10, fillColor: '#ff4757', fillOpacity: 1, color: '#fff', weight: 3,
      }).addTo(leafletMap.current);
    }
  }, [activeAlert?.lat, activeAlert?.lng]);

  const startAlarm = () => {
    try {
      if (audioRef.current) return;
      const ctx = new AudioContext();
      audioRef.current = ctx;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);

      // Siren effect
      const now = ctx.currentTime;
      for (let i = 0; i < 60; i++) {
        osc.frequency.setValueAtTime(800, now + i * 0.5);
        osc.frequency.linearRampToValueAtTime(1200, now + i * 0.5 + 0.25);
        osc.frequency.linearRampToValueAtTime(800, now + i * 0.5 + 0.5);
      }

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscillatorRef.current = osc;
    } catch {}
  };

  const stopAlarm = () => {
    try {
      oscillatorRef.current?.stop();
      audioRef.current?.close();
      oscillatorRef.current = null;
      audioRef.current = null;
    } catch {}
  };

  const handleRespond = () => {
    if (!activeAlert || !socket) return;
    socket.emit('sos:respond', {
      incidentId: activeAlert.incidentId,
      protectedUserId: activeAlert.protectedUserId,
    });
    setResponded(true);
    stopAlarm();
    navigator.vibrate?.(0);
  };

  const handleDismiss = () => {
    if (!activeAlert) return;
    stopAlarm();
    navigator.vibrate?.(0);
    dismissAlert(activeAlert.incidentId);
    setActiveAlert(null);
    if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  if (!activeAlert) return null;

  const isResolved = activeAlert.status !== 'active';

  return (
    <div className={`emergency-overlay ${isResolved ? 'resolved' : ''}`}>
      {/* Flashing danger stripes */}
      {!isResolved && <div className="emergency-stripes" />}

      {/* Header */}
      <div className="emergency-header">
        <div className={`emergency-icon ${isResolved ? 'safe' : ''}`}>
          {isResolved ? '✅' : '🚨'}
        </div>
        <h1 className="emergency-title">
          {isResolved ? 'User is Safe' : 'EMERGENCY SOS'}
        </h1>
        <div className="emergency-timer">{formatTime(timer)}</div>
      </div>

      {/* User info */}
      <div className="emergency-user-card">
        <div className="emergency-avatar">
          {activeAlert.userName?.[0]?.toUpperCase() || '?'}
        </div>
        <div>
          <div className="emergency-user-name">{activeAlert.userName}</div>
          <div className="emergency-user-status">
            {isResolved
              ? `SOS ${activeAlert.status}`
              : `${activeAlert.triggerType || 'Manual'} SOS — Active`}
          </div>
        </div>
      </div>

      {/* Live Map */}
      <div
        ref={mapRef}
        className="emergency-map"
        style={{ height: 220 }}
      />

      {activeAlert.lat && (
        <div className="emergency-coords">
          📍 {activeAlert.lat.toFixed(4)}, {activeAlert.lng?.toFixed(4)}
        </div>
      )}

      {/* Captured Media (image/video from Cloudinary) */}
      {activeAlert.mediaUrl && (
        <div style={{ margin: '8px 0', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border)' }}>
          {activeAlert.mediaType === 'video' ? (
            <video
              src={activeAlert.mediaUrl}
              controls
              playsInline
              style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <img
              src={activeAlert.mediaUrl}
              alt="Captured evidence"
              style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }}
            />
          )}
          <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-card)' }}>
            📎 Evidence captured
          </div>
        </div>
      )}

      {/* Quick Actions */}
      {!isResolved && (
        <div className="emergency-actions">
          <button
            className="emergency-action-btn track"
            onClick={() => {
              if (activeAlert.lat && activeAlert.lng) {
                window.open(
                  `https://www.google.com/maps?q=${activeAlert.lat},${activeAlert.lng}`,
                  '_blank'
                );
              }
            }}
          >
            <span>📍</span>
            <span>Track</span>
          </button>

          <button
            className="emergency-action-btn call"
            onClick={() => {
              // Use real phone number from alert if available, fallback to emergency
              const phone = (activeAlert as any).userPhone || '112';
              window.location.href = `tel:${phone}`;
            }}
          >
            <span>📞</span>
            <span>Call</span>
          </button>

          <button
            className={`emergency-action-btn respond ${responded ? 'responded' : ''}`}
            onClick={handleRespond}
            disabled={responded}
          >
            <span>{responded ? '✅' : '💬'}</span>
            <span>{responded ? 'Sent' : 'Respond'}</span>
          </button>
        </div>
      )}

      {/* Dismiss */}
      <button className="emergency-dismiss" onClick={handleDismiss}>
        {isResolved ? 'Close' : 'Dismiss Alert'}
      </button>
    </div>
  );
}
