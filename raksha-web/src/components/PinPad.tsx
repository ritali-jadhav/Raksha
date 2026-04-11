import { useState, useEffect } from 'react';

interface PinPadProps {
  onComplete: (pin: string) => void;
  onCancel?: () => void;
  error?: string;
  loading?: boolean;
  title?: string;
  attempts?: number;
  maxAttempts?: number;
}

export default function PinPad({ onComplete, onCancel, error, loading, title, attempts = 0, maxAttempts = 5 }: PinPadProps) {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [lockout, setLockout] = useState(0);
  const maxLen = 4;

  // Lockout timer after max attempts
  useEffect(() => {
    if (attempts >= maxAttempts) {
      setLockout(30);
    }
  }, [attempts, maxAttempts]);

  useEffect(() => {
    if (lockout <= 0) return;
    const t = setInterval(() => setLockout(l => l - 1), 1000);
    return () => clearInterval(t);
  }, [lockout]);

  // Shake on error
  useEffect(() => {
    if (error) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  }, [error]);

  const handleKey = (digit: string) => {
    if (lockout > 0 || loading) return;
    if (pin.length < maxLen) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === maxLen) {
        onComplete(newPin);
        setTimeout(() => setPin(''), 600);
      }
    }
  };

  const handleBackspace = () => {
    setPin(p => p.slice(0, -1));
  };

  const isLocked = lockout > 0;
  const remainingAttempts = maxAttempts - attempts;

  return (
    <div style={{ padding: '20px 16px' }}>
      <h2 style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, marginBottom: 6 }}>
        {title || '🔐 Enter Safety PIN'}
      </h2>
      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, marginBottom: 4 }}>
        Enter your 4-digit PIN to cancel SOS
      </p>

      {error && <div className="auth-error">{error}</div>}

      {attempts > 0 && attempts < maxAttempts && (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--warning)', marginBottom: 8 }}>
          ⚠️ {remainingAttempts} attempt{remainingAttempts !== 1 ? 's' : ''} remaining
        </div>
      )}

      <div className={`pin-display ${shake ? 'shake-container' : ''}`}>
        {Array.from({ length: maxLen }).map((_, i) => (
          <div key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''} ${shake ? 'error' : ''}`} />
        ))}
      </div>

      {isLocked ? (
        <div className="pin-lockout">
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div>Too many failed attempts</div>
          <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
            0:{lockout.toString().padStart(2, '0')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Try again after cooldown
          </div>
        </div>
      ) : loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="pin-grid">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <button key={d} className="pin-key" onClick={() => handleKey(d)} type="button">
              {d}
            </button>
          ))}
          <button className="pin-key" onClick={onCancel} type="button" style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            ✕
          </button>
          <button className="pin-key" onClick={() => handleKey('0')} type="button">
            0
          </button>
          <button className="pin-key backspace" onClick={handleBackspace} type="button">
            ⌫
          </button>
        </div>
      )}
    </div>
  );
}
