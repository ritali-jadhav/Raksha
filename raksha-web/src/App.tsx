import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useSocket } from './context/SocketContext';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { usePushNotifications } from './hooks/usePushNotifications';
import BottomNav from './components/BottomNav';
import EmergencyAlert from './components/EmergencyAlert';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Home from './pages/Home';
import Tracking from './pages/Tracking';
import GuardianHub from './pages/GuardianHub';
import Awareness from './pages/Awareness';
import History from './pages/History';
import IncidentDetail from './pages/IncidentDetail';
import Settings from './pages/Settings';
import SafeRoute from './pages/SafeRoute';
import SafetyTools from './pages/SafetyTools';
import Analytics from './pages/Analytics';
import Community from './pages/Community';

function ProtectedLayout() {
  const { connected } = useSocket();
  const { online } = useNetworkStatus();

  // Register for push notifications
  usePushNotifications(true);

  return (
    <div className="app-layout">
      {/* Offline / Disconnected Banner */}
      {!online && (
        <div className="network-banner offline">
          <span className="network-banner-icon">📡</span>
          <span>No internet connection — requests will be queued</span>
        </div>
      )}
      {online && !connected && (
        <div className="network-banner reconnecting">
          <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          <span>Reconnecting to real-time server...</span>
        </div>
      )}

      {/* WebSocket connection indicator */}
      <div className={`connection-dot ${connected ? 'connected' : 'disconnected'}`}
        title={connected ? 'Real-time connected' : 'Reconnecting...'}
      />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tracking" element={<Tracking />} />
        <Route path="/safe-route" element={<SafeRoute />} />
        <Route path="/guardians" element={<GuardianHub />} />
        <Route path="/awareness" element={<Awareness />} />
        <Route path="/history" element={<History />} />
        <Route path="/incident/:id" element={<IncidentDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/safety-tools" element={<SafetyTools />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/community" element={<Community />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />

      {/* Full-screen emergency alert for guardians (always mounted) */}
      <EmergencyAlert />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-shield">🛡️</div>
        <div className="spinner" style={{ width: 36, height: 36 }} />
        <div className="app-loading-text">Securing your connection...</div>
      </div>
    );
  }

  return (
    <Routes>
      {!user ? (
        <>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      ) : (
        <Route path="/*" element={<ProtectedLayout />} />
      )}
    </Routes>
  );
}
