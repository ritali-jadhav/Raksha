import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { sosApi } from '../api/client';

export default function History() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'cancelled' | 'resolved'>('all');

  useEffect(() => {
    sosApi.incidents()
      .then(r => setIncidents(r.incidents || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getStatusClass = (status: string) => {
    if (status === 'active') return 'active';
    if (status === 'cancelled') return 'cancelled';
    return 'resolved';
  };

  const getTriggerLabel = (type: string) => {
    const labels: Record<string, string> = {
      manual: '🚨 Manual SOS',
      geofence_breach: '📍 Geofence Breach',
      auto: '🤖 Auto Triggered',
    };
    return labels[type] || `⚡ ${type}`;
  };

  const filtered = filter === 'all' ? incidents : incidents.filter(i => i.status === filter);

  return (
    <div className="page">
      <h1 className="page-header">📋 Incident History</h1>

      {/* Filters */}
      <div className="tabs">
        {(['all', 'active', 'cancelled', 'resolved'] as const).map(f => (
          <button
            key={f}
            className={`tab ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? `All (${incidents.length})` :
             f === 'active' ? `Active (${incidents.filter(i => i.status === 'active').length})` :
             f === 'cancelled' ? `Cancelled (${incidents.filter(i => i.status === 'cancelled').length})` :
             `Resolved (${incidents.filter(i => i.status === 'resolved').length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3].map(i => (
            <div key={i} className="skeleton" style={{ height: 80 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="emoji">🕊️</div>
          <p>{filter === 'all' ? 'No incidents recorded. Stay safe!' : `No ${filter} incidents`}</p>
        </div>
      ) : (
        filtered.map((inc: any) => (
          <div
            key={inc.incidentId}
            className="incident-card"
            onClick={() => navigate(`/incident/${inc.incidentId}`)}
          >
            <div className="incident-header">
              <span className="incident-type">{getTriggerLabel(inc.triggerType)}</span>
              <span className={`incident-status ${getStatusClass(inc.status)}`}>
                {inc.status}
              </span>
            </div>
            <div className="incident-date">
              {new Date(inc.createdAt).toLocaleString()}
            </div>
            <div className="incident-meta">
              {inc.escalationStage > 0 && (
                <span className="incident-meta-item">
                  ⚡ Stage {inc.escalationStage}
                </span>
              )}
              {inc.triggerType === 'geofence_breach' && (
                <span className="incident-meta-item">📍 Geofence</span>
              )}
              <span className="incident-meta-item" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>
                View details →
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
