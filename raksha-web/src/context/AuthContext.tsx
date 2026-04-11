import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authApi } from '../api/client';

interface User {
  userId: string;
  email: string;
  name: string;
  phone: string | null;
  hasSafetyPin: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: {email:string; password:string; name:string; phone?:string; safetyPin?:string}) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('raksha_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      authApi.me()
        .then(res => setUser(res.user))
        .catch(() => { localStorage.removeItem('raksha_token'); setToken(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    localStorage.setItem('raksha_token', res.token);
    setToken(res.token);
    setUser(res.user);
  };

  const signup = async (data: {email:string; password:string; name:string; phone?:string; safetyPin?:string}) => {
    const res = await authApi.signup(data);
    localStorage.setItem('raksha_token', res.token);
    setToken(res.token);
    setUser(res.user);
  };

  const logout = () => {
    localStorage.removeItem('raksha_token');
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    const res = await authApi.me();
    setUser(res.user);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
