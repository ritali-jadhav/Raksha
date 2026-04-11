import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { authApi, geofenceApi, guardianApi } from '../api/client';
import { useToast } from '../context/ToastContext';

export default function Settings() {
  const { user, logout, refreshUser } = useAuth();
  const { showToast } = useToast();
  const [showPinChange, setShowPinChange] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState('');
  const [geofences, setGeofences] = useState<any[]>([]);
  const [showGeoForm, setShowGeoForm] = useState(false);
  const [geoForm, setGeoForm] = useState({ name: '', lat: '', lng: '', radius: '500' });

  // External phone guardians
  const [phoneGuardians, setPhoneGuardians] = useState<any[]>([]);
  const [showPhoneForm, setShowPhoneForm] = useState(false);
  const [phoneForm, setPhoneForm] = useState({ name: '', phone: '' });
  const [addingPhone, setAddingPhone] = useState(false);

  useEffect(() => {
    geofenceApi.list().then(r => setGeofences(r.geofences || [])).catch(() => {});
    guardianApi.phoneGuardians().then(r => setPhoneGuardians(r.guardians || [])).catch(() => {});
  }, []);

  const handlePinUpdate = async () => {
    if (newPin.length < 4) { setPinMsg('PIN must be at least 4 digits'); return; }
    try {
      await authApi.updatePin(newPin);
      setPinMsg('');
      setNewPin('');
      setShowPinChange(false);
      showToast('Safety PIN updated!');
      refreshUser();
    } catch (err: any) {
      setPinMsg(err.message);
    }
  };

  const handleAddGeofence = async () => {
    try {
      const lat = parseFloat(geoForm.lat);
      const lng = parseFloat(geoForm.lng);
      const radius = parseInt(geoForm.radius);
      if (isNaN(lat) || isNaN(lng) || isNaN(radius)) { showToast('Invalid values', 'error'); return; }

      await geofenceApi.create({ centerLat: lat, centerLng: lng, radiusMeters: radius, name: geoForm.name || undefined });
      setShowGeoForm(false);
      setGeoForm({ name: '', lat: '', lng: '', radius: '500' });
      const r = await geofenceApi.list();
      setGeofences(r.geofences || []);
      showToast('Safe zone added!');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const useCurrentLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setGeoForm(f => ({ ...f, lat: pos.coords.latitude.toString(), lng: pos.coords.longitude.toString() }));
      },
      () => { showToast('Location access denied', 'error'); },
      { enableHighAccuracy: true }
    );
  };

  const handleAddPhoneGuardian = async () => {
    if (!phoneForm.name.trim() || !phoneForm.phone.trim()) {
      showToast('Name and phone number required', 'error');
      return;
    }
    setAddingPhone(true);
    try {
      const res = await guardianApi.addPhone(phoneForm.name.trim(), phoneForm.phone.trim());
      if (res.success) {
        showToast('Guardian phone added!');
        setPhoneForm({ name: '', phone: '' });
        setShowPhoneForm(false);
        const r = await guardianApi.phoneGuardians();
        setPhoneGuardians(r.guardians || []);
      } else {
        showToast(res.message || 'Failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to add', 'error');
    } finally {
      setAddingPhone(false);
    }
  };

  const handleRemovePhoneGuardian = async (id: string) => {
    try {
      await guardianApi.removePhone(id);
      showToast('Guardian phone removed');
      const r = await guardianApi.phoneGuardians();
      setPhoneGuardians(r.guardians || []);
    } catch {
      showToast('Failed to remove', 'error');
    }
  };

  return (
    <div className="page">

      <h1 className="page-header">⚙️ Settings</h1>

      {/* Profile */}
      <div className="settings-group">
        <div className="settings-group-title">Profile</div>
        <div className="settings-item" style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}>
          <div className="settings-item-left">
            <span className="settings-item-icon">👤</span>
            <span className="settings-item-label">{user?.name}</span>
          </div>
        </div>
        <div className="settings-item">
          <div className="settings-item-left">
            <span className="settings-item-icon">📧</span>
            <span className="settings-item-label">{user?.email}</span>
          </div>
        </div>
        <div className="settings-item" style={{ borderRadius: '0 0 var(--radius-md) var(--radius-md)' }}>
          <div className="settings-item-left">
            <span className="settings-item-icon">📱</span>
            <span className="settings-item-label">{user?.phone || 'Not set'}</span>
          </div>
        </div>
      </div>

      {/* Security */}
      <div className="settings-group">
        <div className="settings-group-title">Security</div>
        <button className="settings-item" onClick={() => setShowPinChange(!showPinChange)}
          style={showPinChange ? {} : { borderRadius: 'var(--radius-md)' }}>
          <div className="settings-item-left">
            <span className="settings-item-icon">🔐</span>
            <span className="settings-item-label">Change Safety PIN</span>
          </div>
          <span className="settings-item-right">{showPinChange ? '▲' : '›'}</span>
        </button>
        {showPinChange && (
          <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, borderRadius: '0 0 var(--radius-md) var(--radius-md)' }}>
            {pinMsg && <div className="auth-error" style={{ margin: 0 }}>{pinMsg}</div>}
            <input
              className="input"
              type="password"
              placeholder="New 4-digit PIN"
              value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
            />
            <button className="btn btn-primary btn-sm" onClick={handlePinUpdate}>Update PIN</button>
          </div>
        )}
      </div>

      {/* Guardian Phone Numbers */}
      <div className="settings-group">
        <div className="settings-group-title">Guardian Phone Numbers</div>
        {phoneGuardians.map((g: any) => (
          <div key={g.id} className="settings-item">
            <div className="settings-item-left">
              <span className="settings-item-icon">📞</span>
              <div>
                <div className="settings-item-label">{g.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {g.phone}
                </div>
              </div>
            </div>
            <button
              className="guardian-action-btn"
              onClick={() => handleRemovePhoneGuardian(g.id)}
            >✕</button>
          </div>
        ))}
        <button
          className="settings-item"
          onClick={() => setShowPhoneForm(!showPhoneForm)}
          style={{ borderRadius: phoneGuardians.length === 0 && !showPhoneForm ? 'var(--radius-md)' : undefined }}
        >
          <div className="settings-item-left">
            <span className="settings-item-icon">➕</span>
            <span className="settings-item-label">Add Guardian Phone</span>
          </div>
        </button>
        {showPhoneForm && (
          <div className="card" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="input" placeholder="Guardian name (e.g. Mom)" value={phoneForm.name}
              onChange={e => setPhoneForm(f => ({ ...f, name: e.target.value }))} />
            <input className="input" placeholder="Phone (+91XXXXXXXXXX)" value={phoneForm.phone}
              onChange={e => setPhoneForm(f => ({ ...f, phone: e.target.value }))} type="tel" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Include country code (e.g. +91 for India, +1 for US)
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleAddPhoneGuardian} disabled={addingPhone}>
              {addingPhone ? 'Adding...' : 'Add Guardian'}
            </button>
          </div>
        )}
      </div>

      {/* Geofencing */}
      <div className="settings-group">
        <div className="settings-group-title">Safe Zones (Geofencing)</div>
        {geofences.map((g: any) => (
          <div key={g.id} className="settings-item">
            <div className="settings-item-left">
              <span className="settings-item-icon">📍</span>
              <div>
                <div className="settings-item-label">{g.name || 'Safe Zone'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {g.radiusMeters}m radius
                </div>
              </div>
            </div>
            <button
              className="guardian-action-btn"
              onClick={async () => {
                await geofenceApi.remove(g.id);
                const r = await geofenceApi.list();
                setGeofences(r.geofences || []);
                showToast('Zone removed');
              }}
            >✕</button>
          </div>
        ))}
        <button
          className="settings-item"
          onClick={() => setShowGeoForm(!showGeoForm)}
          style={{ borderRadius: geofences.length === 0 && !showGeoForm ? 'var(--radius-md)' : undefined }}
        >
          <div className="settings-item-left">
            <span className="settings-item-icon">➕</span>
            <span className="settings-item-label">Add Safe Zone</span>
          </div>
        </button>
        {showGeoForm && (
          <div className="card" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="input" placeholder="Zone name (e.g. Home)" value={geoForm.name}
              onChange={e => setGeoForm(f => ({ ...f, name: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" placeholder="Latitude" value={geoForm.lat}
                onChange={e => setGeoForm(f => ({ ...f, lat: e.target.value }))} inputMode="decimal" />
              <input className="input" placeholder="Longitude" value={geoForm.lng}
                onChange={e => setGeoForm(f => ({ ...f, lng: e.target.value }))} inputMode="decimal" />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={useCurrentLocation}>📍 Use Current Location</button>
            <input className="input" placeholder="Radius in meters" value={geoForm.radius}
              onChange={e => setGeoForm(f => ({ ...f, radius: e.target.value }))} inputMode="numeric" />
            <button className="btn btn-primary btn-sm" onClick={handleAddGeofence}>Create Safe Zone</button>
          </div>
        )}
      </div>

      {/* Disconnect */}
      <div className="settings-group">
        <button className="settings-item" style={{ borderRadius: 'var(--radius-md)' }} onClick={logout}>
          <div className="settings-item-left">
            <span className="settings-item-icon">🚪</span>
            <span className="settings-item-label" style={{ color: 'var(--accent)' }}>Logout</span>
          </div>
        </button>
      </div>

      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
        Raksha v1.0 — Your Safety, Our Priority
      </div>
    </div>
  );
}
