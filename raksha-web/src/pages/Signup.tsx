import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Signup() {
  const { signup } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', safetyPin: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (form.safetyPin && form.safetyPin.length < 4) { setError('PIN must be at least 4 digits'); return; }
    setLoading(true);
    try {
      await signup({
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        safetyPin: form.safetyPin || undefined,
      });
    } catch (err: any) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-logo">
        <div className="emoji">🛡️</div>
        <h1>Create Account</h1>
        <p>Join Raksha for your safety</p>
      </div>

      <form onSubmit={handleSubmit}>
        {error && <div className="auth-error">{error}</div>}

        <div className="input-group">
          <label>Full Name</label>
          <input className="input" placeholder="Enter your name" value={form.name}
            onChange={e => update('name', e.target.value)} required autoComplete="name" />
        </div>

        <div className="input-group">
          <label>Email</label>
          <input className="input" type="email" placeholder="Enter your email" value={form.email}
            onChange={e => update('email', e.target.value)} required autoComplete="email" />
        </div>

        <div className="input-group">
          <label>Phone (optional)</label>
          <input className="input" type="tel" placeholder="+91 XXXXX XXXXX" value={form.phone}
            onChange={e => update('phone', e.target.value)} autoComplete="tel" />
        </div>

        <div className="input-group">
          <label>Password</label>
          <input className="input" type="password" placeholder="Min. 6 characters" value={form.password}
            onChange={e => update('password', e.target.value)} required autoComplete="new-password" />
        </div>

        <div className="input-group">
          <label>Safety PIN (4 digits, for SOS cancellation)</label>
          <input className="input" type="password" placeholder="e.g. 1234" value={form.safetyPin}
            onChange={e => update('safetyPin', e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric" maxLength={4} autoComplete="off" />
        </div>

        <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
          {loading ? <span className="spinner" /> : 'Create Account'}
        </button>
      </form>

      <div className="auth-footer">
        Already have an account? <Link to="/login">Sign In</Link>
      </div>
    </div>
  );
}
