import { useState, useEffect } from 'react';
import { analyticsApi } from '../api/client';

const HOUR_LABELS = ['12am', '1am', '2am', '3am', '4am', '5am', '6am', '7am', '8am', '9am', '10am', '11am',
    '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm'];

const TYPE_COLORS: Record<string, string> = {
    morning: '#2ed573', afternoon: '#ffa502', evening: '#ff6348', night: '#ff4757',
};

function getPeriod(hour: number) {
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'night';
}

export default function Analytics() {
    const [city, setCity] = useState('Mumbai');
    const [inputCity, setInputCity] = useState('Mumbai');
    const [trends, setTrends] = useState<{ hour: number; count: number }[]>([]);
    const [topCities, setTopCities] = useState<{ city: string; risk: number }[]>([]);
    const [loading, setLoading] = useState(false);
    const [total, setTotal] = useState(0);

    const loadTrends = async (c: string) => {
        setLoading(true);
        try {
            const r = await analyticsApi.crimeTrends(c);
            setTrends(r.hourly || []);
            setTotal(r.total || 0);
        } catch { setTrends([]); }
        setLoading(false);
    };

    useEffect(() => {
        loadTrends(city);
        analyticsApi.topCities().then(r => setTopCities(r.cities || [])).catch(() => { });
    }, [city]);

    const maxCount = Math.max(...trends.map(t => t.count), 1);

    const peakHour = trends.reduce((a, b) => b.count > a.count ? b : a, { hour: 0, count: 0 });
    const safestHour = trends.reduce((a, b) => b.count < a.count ? b : a, { hour: 0, count: Infinity });

    return (
        <div className="page">
            <h1 className="page-header">📊 Crime Analytics</h1>

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
                ) : trends.length === 0 ? (
                    <div className="empty-state"><div className="emoji">📭</div><p>No data for {city}</p></div>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100, overflowX: 'auto' }}>
                        {Array.from({ length: 24 }, (_, h) => {
                            const entry = trends.find(t => t.hour === h);
                            const count = entry?.count || 0;
                            const heightPct = (count / maxCount) * 100;
                            const period = getPeriod(h);
                            const color = TYPE_COLORS[period];
                            return (
                                <div key={h} style={{ flex: '0 0 auto', width: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                                    title={`${HOUR_LABELS[h]}: ${count} incidents`}>
                                    <div style={{ width: '100%', height: `${heightPct}%`, background: color, borderRadius: '2px 2px 0 0', minHeight: count > 0 ? 2 : 0, transition: 'height 0.3s' }} />
                                </div>
                            );
                        })}
                    </div>
                )}
                {/* X-axis labels */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: 'var(--text-muted)' }}>
                    <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                </div>
                {/* Legend */}
                <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                    {Object.entries(TYPE_COLORS).map(([k, c]) => (
                        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
                            {k.charAt(0).toUpperCase() + k.slice(1)}
                        </div>
                    ))}
                </div>
            </div>

            {/* Top risky cities */}
            <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Top High-Risk Cities</div>
                {topCities.map((c, i) => (
                    <div key={c.city} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: i < 3 ? 'var(--accent-soft)' : 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: i < 3 ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }}>
                            {i + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.city}</div>
                            <div style={{ height: 4, background: 'var(--bg-secondary)', borderRadius: 2, marginTop: 3 }}>
                                <div style={{ height: '100%', width: `${c.risk * 100}%`, background: c.risk > 0.6 ? 'var(--accent)' : c.risk > 0.3 ? 'var(--warning)' : 'var(--safe)', borderRadius: 2 }} />
                            </div>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: c.risk > 0.6 ? 'var(--accent)' : c.risk > 0.3 ? 'var(--warning)' : 'var(--safe)', minWidth: 36, textAlign: 'right' }}>
                            {(c.risk * 100).toFixed(0)}%
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
