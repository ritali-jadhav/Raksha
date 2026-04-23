import { useState, useEffect } from 'react';
import { analyticsApi } from '../api/client';

const HOUR_LABELS = ['12am', '1am', '2am', '3am', '4am', '5am', '6am', '7am', '8am', '9am', '10am', '11am',
    '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm'];

const TYPE_COLORS: Record<string, string> = {
    morning: '#2ed573', afternoon: '#ffa502', evening: '#ff6348', night: '#ff4757',
};

const CRIME_TYPES = [
    { type: 'Chain Snatching', icon: '💎', color: '#ff4757' },
    { type: 'Eve Teasing', icon: '⚠️', color: '#ffa502' },
    { type: 'Robbery', icon: '🔪', color: '#ff6348' },
    { type: 'Vehicle Theft', icon: '🏍️', color: '#3b82f6' },
    { type: 'Stalking', icon: '👁️', color: '#a855f7' },
    { type: 'Assault', icon: '🤕', color: '#ef4444' },
];

// Demo data — used when the Python analytics service is unavailable
const DEMO_HOURLY: { hour: number; count: number }[] = [
    { hour: 0, count: 28 }, { hour: 1, count: 22 }, { hour: 2, count: 15 }, { hour: 3, count: 10 },
    { hour: 4, count: 8 }, { hour: 5, count: 12 }, { hour: 6, count: 18 }, { hour: 7, count: 25 },
    { hour: 8, count: 32 }, { hour: 9, count: 38 }, { hour: 10, count: 35 }, { hour: 11, count: 40 },
    { hour: 12, count: 45 }, { hour: 13, count: 42 }, { hour: 14, count: 38 }, { hour: 15, count: 44 },
    { hour: 16, count: 48 }, { hour: 17, count: 55 }, { hour: 18, count: 65 }, { hour: 19, count: 72 },
    { hour: 20, count: 68 }, { hour: 21, count: 58 }, { hour: 22, count: 48 }, { hour: 23, count: 35 },
];

const DEMO_CITIES: { city: string; risk: number }[] = [
    { city: 'Delhi', risk: 0.82 }, { city: 'Mumbai', risk: 0.71 },
    { city: 'Bangalore', risk: 0.62 }, { city: 'Kolkata', risk: 0.58 },
    { city: 'Chennai', risk: 0.53 }, { city: 'Hyderabad', risk: 0.49 },
    { city: 'Pune', risk: 0.44 }, { city: 'Ahmedabad', risk: 0.38 },
    { city: 'Jaipur', risk: 0.35 }, { city: 'Lucknow', risk: 0.31 },
];

const DEMO_TYPE_DATA = [
    { type: 'Chain Snatching', count: 342 },
    { type: 'Eve Teasing', count: 287 },
    { type: 'Robbery', count: 198 },
    { type: 'Vehicle Theft', count: 165 },
    { type: 'Stalking', count: 134 },
    { type: 'Assault', count: 89 },
];

const DEMO_MONTHLY = [
    { month: 'Jan', count: 180 }, { month: 'Feb', count: 165 }, { month: 'Mar', count: 210 },
    { month: 'Apr', count: 240 }, { month: 'May', count: 195 }, { month: 'Jun', count: 170 },
    { month: 'Jul', count: 220 }, { month: 'Aug', count: 250 }, { month: 'Sep', count: 230 },
    { month: 'Oct', count: 265 }, { month: 'Nov', count: 280 }, { month: 'Dec', count: 245 },
];

function getPeriod(hour: number) {
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'night';
}

export default function Analytics() {
    const [city, setCity] = useState('Mumbai');
    const [inputCity, setInputCity] = useState('Mumbai');
    const [trends, setTrends] = useState<{ hour: number; count: number }[]>(DEMO_HOURLY);
    const [topCities, setTopCities] = useState<{ city: string; risk: number }[]>(DEMO_CITIES);
    const [loading, setLoading] = useState(false);
    const [total, setTotal] = useState(DEMO_HOURLY.reduce((s, e) => s + e.count, 0));
    const [isDemo, setIsDemo] = useState(true);

    const loadTrends = async (c: string) => {
        setLoading(true);
        try {
            const r = await analyticsApi.crimeTrends(c);
            if (r.hourly && r.hourly.length > 0) {
                setTrends(r.hourly);
                setTotal(r.total || 0);
                setIsDemo(false);
            } else {
                setTrends(DEMO_HOURLY);
                setTotal(DEMO_HOURLY.reduce((s, e) => s + e.count, 0));
                setIsDemo(true);
            }
        } catch {
            setTrends(DEMO_HOURLY);
            setTotal(DEMO_HOURLY.reduce((s, e) => s + e.count, 0));
            setIsDemo(true);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadTrends(city);
        analyticsApi.topCities()
            .then(r => { if (r.cities?.length > 0) { setTopCities(r.cities); setIsDemo(false); } })
            .catch(() => { });
    }, [city]);

    const maxCount = Math.max(...trends.map(t => t.count), 1);
    const peakHour = trends.reduce((a, b) => b.count > a.count ? b : a, { hour: 0, count: 0 });
    const safestHour = trends.reduce((a, b) => b.count < a.count ? b : a, { hour: 0, count: Infinity });
    const maxMonthly = Math.max(...DEMO_MONTHLY.map(m => m.count), 1);
    const maxTypeCount = Math.max(...DEMO_TYPE_DATA.map(t => t.count), 1);

    return (
        <div className="page">
            <h1 className="page-header">📊 Crime Analytics</h1>

            {isDemo && (
                <div className="card" style={{
                    marginBottom: 16, padding: '10px 14px',
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(139,92,246,0.08))',
                    border: '1px solid rgba(59,130,246,0.2)',
                    fontSize: 12, color: 'var(--info)',
                    display: 'flex', alignItems: 'center', gap: 8,
                }}>
                    <span style={{ fontSize: 16 }}>📋</span>
                    Showing demo analytics data. Live data loads when the analytics service is connected.
                </div>
            )}

            {/* City search */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input className="input" placeholder="Enter city (e.g. Delhi)" value={inputCity}
                    onChange={e => setInputCity(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && setCity(inputCity)} />
                <button className="btn btn-primary btn-sm" onClick={() => setCity(inputCity)}>Search</button>
            </div>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent)', fontSize: 18 }}>{total.toLocaleString()}</div>
                    <div className="stat-label">Total Incidents</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--warning)', fontSize: 18 }}>{HOUR_LABELS[peakHour.hour] || '—'}</div>
                    <div className="stat-label">Peak Hour</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--safe)', fontSize: 18 }}>{trends.length ? HOUR_LABELS[safestHour.hour] : '—'}</div>
                    <div className="stat-label">Safest Hour</div>
                </div>
            </div>

            {/* Hourly bar chart */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Hourly Crime Distribution — {city}</div>
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><div className="spinner" /></div>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, overflowX: 'auto' }}>
                        {Array.from({ length: 24 }, (_, h) => {
                            const entry = trends.find(t => t.hour === h);
                            const count = entry?.count || 0;
                            const heightPct = (count / maxCount) * 100;
                            const period = getPeriod(h);
                            const color = TYPE_COLORS[period];
                            return (
                                <div key={h} style={{
                                    flex: '1 0 auto', minWidth: 12, display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', gap: 2, position: 'relative',
                                }}
                                    title={`${HOUR_LABELS[h]}: ${count} incidents`}>
                                    <div style={{ fontSize: 8, color: 'var(--text-muted)', opacity: count > maxCount * 0.7 ? 1 : 0 }}>
                                        {count}
                                    </div>
                                    <div style={{
                                        width: '100%', height: `${heightPct}%`, background: color,
                                        borderRadius: '3px 3px 0 0', minHeight: count > 0 ? 3 : 0,
                                        transition: 'height 0.5s ease',
                                    }} />
                                </div>
                            );
                        })}
                    </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: 'var(--text-muted)' }}>
                    <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                    {Object.entries(TYPE_COLORS).map(([k, c]) => (
                        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
                            {k.charAt(0).toUpperCase() + k.slice(1)}
                        </div>
                    ))}
                </div>
            </div>

            {/* Monthly Trend Line Chart */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📈 Monthly Incident Trend</div>
                <div style={{ position: 'relative', height: 120 }}>
                    {/* Y-axis gridlines */}
                    {[0, 0.25, 0.5, 0.75, 1].map(frac => (
                        <div key={frac} style={{
                            position: 'absolute', bottom: `${frac * 100}%`, left: 0, right: 0,
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                        }} />
                    ))}
                    {/* Bars + labels */}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: '100%' }}>
                        {DEMO_MONTHLY.map((m) => {
                            const pct = (m.count / maxMonthly) * 100;
                            return (
                                <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                    <div style={{
                                        width: '100%', height: `${pct}%`,
                                        background: `linear-gradient(180deg, #ff4757 0%, #ff6348 100%)`,
                                        borderRadius: '4px 4px 0 0',
                                        opacity: 0.7 + (m.count / maxMonthly) * 0.3,
                                        transition: 'height 0.5s ease',
                                    }} />
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {DEMO_MONTHLY.map(m => (
                        <div key={m.month} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--text-muted)' }}>{m.month}</div>
                    ))}
                </div>
            </div>

            {/* Crime Type Breakdown */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>🔍 Crime Type Breakdown</div>
                {DEMO_TYPE_DATA.map((item) => {
                    const config = CRIME_TYPES.find(c => c.type === item.type);
                    const pct = (item.count / maxTypeCount) * 100;
                    return (
                        <div key={item.type} style={{ marginBottom: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 14 }}>{config?.icon || '📌'}</span>
                                    <span style={{ fontSize: 13, fontWeight: 600 }}>{item.type}</span>
                                </div>
                                <span style={{ fontSize: 12, fontWeight: 700, color: config?.color || 'var(--text-muted)' }}>{item.count}</span>
                            </div>
                            <div style={{ height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{
                                    height: '100%', width: `${pct}%`,
                                    background: config?.color || 'var(--accent)',
                                    borderRadius: 3,
                                    transition: 'width 0.5s ease',
                                }} />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Top risky cities */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>🏙️ Top High-Risk Cities</div>
                {topCities.map((c, i) => (
                    <div key={c.city} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div style={{
                            width: 24, height: 24, borderRadius: '50%',
                            background: i < 3 ? 'var(--accent-soft)' : 'var(--bg-card)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700,
                            color: i < 3 ? 'var(--accent)' : 'var(--text-muted)',
                            flexShrink: 0,
                        }}>
                            {i + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.city}</div>
                            <div style={{ height: 4, background: 'var(--bg-secondary)', borderRadius: 2, marginTop: 3 }}>
                                <div style={{
                                    height: '100%', width: `${c.risk * 100}%`,
                                    background: c.risk > 0.6 ? 'var(--accent)' : c.risk > 0.3 ? 'var(--warning)' : 'var(--safe)',
                                    borderRadius: 2,
                                    transition: 'width 0.5s ease',
                                }} />
                            </div>
                        </div>
                        <div style={{
                            fontSize: 12, fontWeight: 700,
                            color: c.risk > 0.6 ? 'var(--accent)' : c.risk > 0.3 ? 'var(--warning)' : 'var(--safe)',
                            minWidth: 36, textAlign: 'right',
                        }}>
                            {(c.risk * 100).toFixed(0)}%
                        </div>
                    </div>
                ))}
            </div>

            {/* Safety Tips */}
            <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>💡 Safety Insights</div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                    <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                        <span>🌙</span>
                        <span>Crime peaks between <strong style={{ color: 'var(--accent)' }}>6 PM – 10 PM</strong>. Avoid isolated areas during evening hours.</span>
                    </div>
                    <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                        <span>🛡️</span>
                        <span>The safest window is <strong style={{ color: 'var(--safe)' }}>4 AM – 6 AM</strong>. Early morning commutes are statistically safer.</span>
                    </div>
                    <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                        <span>📍</span>
                        <span>Always share your live location with a guardian when traveling alone at night.</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <span>🚨</span>
                        <span>Keep the Raksha SOS button accessible — it works even with the screen locked.</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
