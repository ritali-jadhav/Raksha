import { useState, useEffect, useRef } from 'react';
import { checkinApi, journeyApi } from '../api/client';
import { useToast } from '../context/ToastContext';
import { sosApi } from '../api/client';

// ─── Dead Man's Switch ────────────────────────────────────────────────────────
function DeadMansSwitch() {
    const { showToast } = useToast();
    const [minutes, setMinutes] = useState(30);
    const [activeTimer, setActiveTimer] = useState<any>(null);
    const [remaining, setRemaining] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

    useEffect(() => {
        checkinApi.active().then(r => {
            if (r.timers?.length) {
                const t = r.timers[0];
                setActiveTimer(t);
                startCountdown(new Date(t.expiresAt).getTime());
            }
        }).catch(() => { });
        return () => clearInterval(intervalRef.current);
    }, []);

    const startCountdown = (expiresAt: number) => {
        clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
            const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
            setRemaining(left);
            if (left === 0) {
                clearInterval(intervalRef.current);
                // Auto-trigger SOS when timer expires
                navigator.geolocation?.getCurrentPosition(pos => {
                    sosApi.trigger('dead_mans_switch', pos.coords.latitude, pos.coords.longitude).catch(() => { });
                }, () => {
                    sosApi.trigger('dead_mans_switch').catch(() => { });
                });
                showToast('Timer expired — SOS triggered!', 'error');
                setActiveTimer(null);
            }
        }, 1000);
    };

    const handleStart = async () => {
        try {
            const r = await checkinApi.startTimer(minutes, `${minutes} min check-in`);
            const timer = { id: r.timerId, label: `${minutes} min timer`, expiresAt: r.expiresAt, durationMinutes: minutes };
            setActiveTimer(timer);
            startCountdown(new Date(r.expiresAt).getTime());
            showToast(`Timer started — check in within ${minutes} min`);
        } catch { showToast('Failed to start timer', 'error'); }
    };

    const handleConfirm = async () => {
        if (!activeTimer) return;
        try {
            await checkinApi.confirm(activeTimer.id);
            clearInterval(intervalRef.current);
            setActiveTimer(null);
            setRemaining(0);
            showToast('Check-in confirmed — you are safe!', 'success');
        } catch { showToast('Failed to confirm', 'error'); }
    };

    const handleCancel = async () => {
        if (!activeTimer) return;
        try {
            await checkinApi.cancel(activeTimer.id);
            clearInterval(intervalRef.current);
            setActiveTimer(null);
            setRemaining(0);
            showToast('Timer cancelled');
        } catch { showToast('Failed to cancel', 'error'); }
    };

    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const pct = activeTimer ? (remaining / (activeTimer.durationMinutes * 60)) * 100 : 0;
    const urgent = remaining < 60 && remaining > 0;

    return (
        <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 24 }}>⏱️</span>
                <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Dead Man's Switch</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Auto-SOS if you don't check in</div>
                </div>
            </div>

            {activeTimer ? (
                <>
                    <div style={{ textAlign: 'center', marginBottom: 12 }}>
                        <div style={{ fontSize: 48, fontWeight: 900, color: urgent ? 'var(--accent)' : 'var(--safe)', fontVariantNumeric: 'tabular-nums', animation: urgent ? 'countdownPulse 1s ease infinite' : 'none' }}>
                            {fmt(remaining)}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>remaining — {activeTimer.label}</div>
                    </div>
                    <div className="progress-bar" style={{ marginBottom: 12, height: 6 }}>
                        <div className="fill" style={{ width: `${pct}%`, background: urgent ? 'var(--accent)' : 'var(--safe)', transition: 'width 1s linear' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-safe btn-sm" style={{ flex: 2 }} onClick={handleConfirm}>✅ I'm Safe — Check In</button>
                        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={handleCancel}>Cancel</button>
                    </div>
                </>
            ) : (
                <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                        {[15, 30, 45, 60, 90, 120].map(m => (
                            <button key={m} className={`hour-chip ${minutes === m ? 'active' : ''}`} onClick={() => setMinutes(m)}>
                                {m < 60 ? `${m}m` : `${m / 60}h`}
                            </button>
                        ))}
                    </div>
                    <button className="btn btn-primary btn-block btn-sm" onClick={handleStart}>
                        Start {minutes} min Timer
                    </button>
                </>
            )}
        </div>
    );
}

// ─── Journey Mode ─────────────────────────────────────────────────────────────
function JourneyMode() {
    const { showToast } = useToast();
    const [destination, setDestination] = useState('');
    const [eta, setEta] = useState(30);
    const [destLat, setDestLat] = useState('');
    const [destLng, setDestLng] = useState('');
    const [activeJourney, setActiveJourney] = useState<any>(null);
    const [remaining, setRemaining] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

    useEffect(() => {
        journeyApi.active().then(r => {
            if (r.journeys?.length) {
                const j = r.journeys[0];
                setActiveJourney(j);
                startCountdown(new Date(j.etaAt).getTime());
            }
        }).catch(() => { });
        return () => clearInterval(intervalRef.current);
    }, []);

    const startCountdown = (etaAt: number) => {
        clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
            const left = Math.max(0, Math.floor((etaAt - Date.now()) / 1000));
            setRemaining(left);
            if (left === 0) {
                clearInterval(intervalRef.current);
                sosApi.trigger('journey_overdue').catch(() => { });
                showToast('Journey overdue — SOS triggered!', 'error');
                setActiveJourney(null);
            }
        }, 1000);
    };

    const handleStart = async () => {
        const lat = parseFloat(destLat), lng = parseFloat(destLng);
        if (!destination.trim()) { showToast('Enter a destination name', 'error'); return; }
        if (isNaN(lat) || isNaN(lng)) { showToast('Enter valid coordinates or use current location', 'error'); return; }
        try {
            const r = await journeyApi.start({ destination, destLat: lat, destLng: lng, etaMinutes: eta });
            const j = { id: r.journeyId, destination, destLat: lat, destLng: lng, etaMinutes: eta, etaAt: r.etaAt };
            setActiveJourney(j);
            startCountdown(new Date(r.etaAt).getTime());
            showToast(`Journey started — arrive within ${eta} min`);
        } catch { showToast('Failed to start journey', 'error'); }
    };

    const handleArrived = async () => {
        if (!activeJourney) return;
        try {
            await journeyApi.arrived(activeJourney.id);
            clearInterval(intervalRef.current);
            setActiveJourney(null);
            showToast('Arrived safely!', 'success');
        } catch { showToast('Failed', 'error'); }
    };

    const handleCancel = async () => {
        if (!activeJourney) return;
        try {
            await journeyApi.cancel(activeJourney.id);
            clearInterval(intervalRef.current);
            setActiveJourney(null);
        } catch { }
    };

    const useCurrentAsDestination = () => {
        navigator.geolocation?.getCurrentPosition(pos => {
            setDestLat(pos.coords.latitude.toFixed(6));
            setDestLng(pos.coords.longitude.toFixed(6));
        }, () => showToast('Location denied', 'error'));
    };

    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const urgent = remaining < 120 && remaining > 0;

    return (
        <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 24 }}>🧭</span>
                <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Journey Mode</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Auto-SOS if you don't arrive on time</div>
                </div>
            </div>

            {activeJourney ? (
                <>
                    <div style={{ textAlign: 'center', marginBottom: 12 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>To: {activeJourney.destination}</div>
                        <div style={{ fontSize: 44, fontWeight: 900, color: urgent ? 'var(--accent)' : 'var(--info)', fontVariantNumeric: 'tabular-nums' }}>
                            {fmt(remaining)}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>until auto-SOS</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-safe btn-sm" style={{ flex: 2 }} onClick={handleArrived}>✅ I've Arrived</button>
                        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={handleCancel}>Cancel</button>
                    </div>
                </>
            ) : (
                <>
                    <input className="input" placeholder="Destination name" value={destination}
                        onChange={e => setDestination(e.target.value)} style={{ marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input className="input" placeholder="Dest. Lat" value={destLat}
                            onChange={e => setDestLat(e.target.value)} inputMode="decimal" />
                        <input className="input" placeholder="Dest. Lng" value={destLng}
                            onChange={e => setDestLng(e.target.value)} inputMode="decimal" />
                    </div>
                    <button className="btn btn-secondary btn-sm btn-block" style={{ marginBottom: 8 }} onClick={useCurrentAsDestination}>
                        📍 Use Current Location as Destination
                    </button>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                        {[15, 30, 45, 60, 90].map(m => (
                            <button key={m} className={`hour-chip ${eta === m ? 'active' : ''}`} onClick={() => setEta(m)}>
                                {m < 60 ? `${m}m` : `${m / 60}h`}
                            </button>
                        ))}
                    </div>
                    <button className="btn btn-primary btn-block btn-sm" onClick={handleStart}>
                        Start Journey ({eta} min ETA)
                    </button>
                </>
            )}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SafetyTools() {
    return (
        <div className="page">
            <h1 className="page-header">🛡️ Safety Tools</h1>
            <DeadMansSwitch />
            <JourneyMode />
        </div>
    );
}
