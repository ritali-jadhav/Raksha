import { NavLink, useLocation } from 'react-router-dom';

const tabs = [
  { path: '/', icon: '🏠', label: 'Home' },
  { path: '/tracking', icon: '📍', label: 'Track' },
  { path: '/safe-route', icon: '🗺️', label: 'Routes' },
  { path: '/community', icon: '🗣️', label: 'Community' },
  { path: '/safety-tools', icon: '⏱️', label: 'Tools' },
  { path: '/analytics', icon: '📊', label: 'Analytics' },
  { path: '/guardians', icon: '🛡️', label: 'Guardians' },
  { path: '/awareness', icon: '🏥', label: 'Nearby' },
  { path: '/settings', icon: '⚙️', label: 'Settings' },
];

export default function BottomNav() {
  const location = useLocation();

  return (
    <nav className="bottom-nav-v2" style={{ overflowX: 'auto', justifyContent: 'flex-start', paddingLeft: 4, paddingRight: 4, gap: 0 }}>
      {tabs.map((tab) => {
        const active = location.pathname === tab.path;
        return (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={`nav-item-v2 ${active ? 'active' : ''}`}
            style={{ minWidth: 56, flexShrink: 0 }}
          >
            <span className="nav-icon-v2">{tab.icon}</span>
            {tab.label}
            <span className="nav-active-dot" />
          </NavLink>
        );
      })}
    </nav>
  );
}
