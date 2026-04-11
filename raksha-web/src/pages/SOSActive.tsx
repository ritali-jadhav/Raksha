import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import { sosApi } from '../api/client';
import { useBackgroundLocation } from '../hooks/useBackgroundLocation';
import PinPad from '../components/PinPad';

interface SOSActiveProps {
  incidentId: string;
  guardians: any[];
  onCancelled: () => void;
  triggerSource?: 'manual' | 'ble_device';
}

const CALL_TIMEOUT = 10; // seconds per guardian

export default function SOSActive({ incidentId, guardians, onCancelled, triggerSource = 'manual' }: SOSActiveProps) {
  const [seconds, setSeconds] = useState(0);
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [, setCallingIdx] = useState(0);
  const [callCountdown, setCallCountdown] = useState(CALL_TIMEOUT);
  const [callStatus, setCallStatus] = useState<string[]>([]);
  const [guardianResponded] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);

  // Background location tracking
  const location = useBackgroundLocation(true);

  // Main timer
  useEffect(() => {
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // Alarm sound on SOS activation
  useEffect(() => {
    startAlarm();

    // Vibrate with SOS pattern
    if (navigator.vibrate) {
      // SOS in Morse: ... --- ...
      const sosPattern = [
        100, 100, 100, 100, 100, 300, // ...
        300, 100, 300, 100, 300, 300, // ---
        100, 100, 100, 100, 100, 500, // ...
      ];
      const vibrateLoop = () => navigator.vibrate(sosPattern);
      vibrateLoop();
      const vibInterval = setInterval(vibrateLoop, 3600);
      return () => { clearInterval(vibInterval); navigator.vibrate(0); };
    }
  }, []);

  // Init map
  useEffect(() => {
    if (mapRef.current && !leafletMap.current) {
      leafletMap.current = L.map(mapRef.current, {
        zoomControl: false, attributionControl: false,
      }).setView([20.5937, 78.9629], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap.current);
    }
  }, []);

  // Update map with background location
  useEffect(() => {
    if (!location.lat || !location.lng || !leafletMap.current) return;
    const latlng: [number, number] = [location.lat, location.lng];
    leafletMap.current.setView(latlng, 16);
    if (marker.current) {
      marker.current.setLatLng(latlng);
    } else {
      marker.current = L.circleMarker(latlng, {
        radius: 8, fillColor: '#ff4757', fillOpacity: 1, color: '#fff', weight: 3,
      }).addTo(leafletMap.current);
    }
  }, [location.lat, location.lng]);

  // Sequential calling with real countdown
  useEffect(() => {
    if (guardians.length === 0) return;
    setCallStatus(guardians.map(() => 'waiting'));
    let idx = 0;
    let countdown = CALL_TIMEOUT;

    setCallingIdx(0);
    setCallCountdown(CALL_TIMEOUT);
    setCallStatus(prev => { const n = [...prev]; n[0] = 'calling'; return n; });

    const tick = setInterval(() => {
      countdown--;
      setCallCountdown(countdown);

      if (countdown <= 0) {
        setCallStatus(prev => {
          const n = [...prev]; n[idx] = 'no-answer'; return n;
        });
        idx = (idx + 1) % guardians.length;
        countdown = CALL_TIMEOUT;
        setCallingIdx(idx);
        setCallCountdown(CALL_TIMEOUT);
        setCallStatus(prev => {
          const n = [...prev]; n[idx] = 'calling'; return n;
        });
      }
    }, 1000);

    return () => clearInterval(tick);
  }, [guardians]);

  const startAlarm = () => {
    try {
      const ctx = new AudioContext();
      audioRef.current = ctx;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.1, ctx.currentTime);

      // Emergency siren sweep
      const now = ctx.currentTime;
      for (let i = 0; i < 120; i++) {
        osc.frequency.setValueAtTime(600, now + i * 0.6);
        osc.frequency.linearRampToValueAtTime(1000, now + i * 0.6 + 0.3);
        osc.frequency.linearRampToValueAtTime(600, now + i * 0.6 + 0.6);
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
      navigator.vibrate?.(0);
    } catch {}
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const handlePinSubmit = async (pin: string) => {
    setPinError('');
    setPinLoading(true);
    try {
      const result = await sosApi.verifyPin(incidentId, pin);
      if (result.success) {
        clearInterval(timerRef.current);
        stopAlarm();
        onCancelled();
      } else {
        setPinAttempts(a => a + 1);
        setPinError(result.message || 'Invalid PIN');
      }
    } catch (err: any) {
      setPinAttempts(a => a + 1);
      setPinError(err.message || 'Verification failed');
    } finally {
      setPinLoading(false);
    }
  };

  // Countdown ring dimensions
  const ringRadius = 17;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (callCountdown / CALL_TIMEOUT) * ringCircumference;

  if (showPin) {
    return (
      <div className="sos-active-overlay">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <PinPad
            onComplete={handlePinSubmit}
            onCancel={() => { setShowPin(false); setPinError(''); }}
            error={pinError}
            loading={pinLoading}
            attempts={pinAttempts}
            maxAttempts={5}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="sos-active-overlay sos-flashing">
      {/* Emergency Banner */}
      <div className="emergency-top-banner">
        <div className="emergency-banner-stripes" />
        <div className="emergency-banner-content">
          <span className="emergency-banner-icon">🚨</span>
          <span>EMERGENCY ACTIVE</span>
          <span className="emergency-banner-icon">🚨</span>
        </div>
      </div>

      {/* Header */}
      <div style={{ padding: '12px 0 8px', textAlign: 'center' }}>
        <div className="sos-timer">{formatTime(seconds)}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          {location.isBackground ? '📱 Tracking in background' : '📍 Live tracking active'}
        </div>
      </div>

      {/* Status Bars */}
      <div className="sos-status-bar">
        <div className="dot" />
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>📍 Live location being shared</span>
        {location.lat && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{location.lat.toFixed(4)}, {location.lng?.toFixed(4)}</span>}
      </div>

      <div className="sos-status-bar" style={{ background: 'var(--safe-glow)' }}>
        <span style={{ fontSize: 14 }}>✅</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--safe)' }}>
          Alert sent to {guardians.length || 0} guardian{guardians.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="sos-status-bar" style={{ background: 'rgba(255,165,2,0.12)' }}>
        <div className="dot" style={{ background: 'var(--warning)' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--warning)' }}>🎙️ Recording active</span>
      </div>

      <div className="sos-status-bar" style={{ background: 'rgba(59,130,246,0.12)' }}>
        <div className="dot" style={{ background: 'var(--info)' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--info)' }}>🔊 Alarm sounding</span>
      </div>

      {triggerSource === 'ble_device' && (
        <div className="sos-status-bar" style={{ background: 'rgba(155,89,182,0.12)' }}>
          <span style={{ fontSize: 14 }}>📟</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#9b59b6' }}>Triggered via safety device</span>
        </div>
      )}

      {/* Guardian responded notification */}
      {guardianResponded && (
        <div className="sos-status-bar" style={{ background: 'var(--safe-glow)', border: '1px solid var(--safe)' }}>
          <span style={{ fontSize: 14 }}>💚</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--safe)' }}>
            Guardian is responding to your alert!
          </span>
        </div>
      )}

      {/* Live Map */}
      <div ref={mapRef} className="map-container" style={{ height: 180 }} />

      {/* Calling Sequence */}
      {guardians.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 8 }}>📞 Calling Guardians</div>
          {guardians.map((g: any, i: number) => (
            <div
              key={g.guardianId || g.linkId || i}
              className={`calling-card ${callStatus[i] === 'calling' ? 'active-call' : ''} ${callStatus[i] === 'no-answer' ? 'call-done' : ''}`}
            >
              {callStatus[i] === 'calling' ? (
                <div className="countdown-ring">
                  <svg viewBox="0 0 44 44">
                    <circle className="ring-bg" cx="22" cy="22" r={ringRadius} />
                    <circle
                      className="ring-progress"
                      cx="22" cy="22" r={ringRadius}
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringOffset}
                    />
                  </svg>
                  <div className="ring-text">{callCountdown}s</div>
                </div>
              ) : (
                <div className="calling-avatar">
                  {callStatus[i] === 'no-answer' ? '📵' : '⏳'}
                </div>
              )}

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{g.name || 'Guardian'}</div>
                <div style={{ fontSize: 12, color: callStatus[i] === 'calling' ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {callStatus[i] === 'calling' ? `Ringing... (${callCountdown}s)` :
                   callStatus[i] === 'no-answer' ? 'No response — skipped' : 'Waiting in queue...'}
                </div>
                {callStatus[i] === 'calling' && (
                  <div className="progress-bar" style={{ marginTop: 8 }}>
                    <div className="fill" style={{ width: `${(callCountdown / CALL_TIMEOUT) * 100}%` }} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {guardians.length === 0 && (
        <div className="card" style={{ margin: '12px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--warning)' }}>⚠️ No guardians configured</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Add guardians in Guardian Hub for automatic calling
          </div>
        </div>
      )}

      {/* Cancel Button */}
      <div style={{ marginTop: 'auto', padding: '16px 0' }}>
        <button className="btn btn-danger btn-block" onClick={() => { setShowPin(true); stopAlarm(); }}>
          🔐 Cancel SOS — Enter PIN
        </button>
      </div>
    </div>
  );
}
