import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch, setStoredToken } from './api';

export type StaffRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'WAITER' | 'KITCHEN_STAFF';

export interface StaffUser {
  id: string;
  restaurantId: string;
  email: string;
  name: string;
  role: StaffRole;
}

export interface RestaurantInfo {
  id: string;
  name: string;
  slug: string;
  taxRateBps: number;
  currency: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  timezone?: string;
}

interface AuthContextValue {
  user: StaffUser | null;
  restaurant: RestaurantInfo | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = async () => {
    try {
      const data = await apiFetch<{ user: StaffUser; restaurant: RestaurantInfo }>('/api/v1/auth/me');
      setUser(data.user);
      setRestaurant(data.restaurant);
    } catch {
      setUser(null);
      setRestaurant(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshMe();
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiFetch<{
      token: string;
      user: StaffUser;
      restaurant: RestaurantInfo;
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(data.token);
    setUser(data.user);
    setRestaurant(data.restaurant);
  };

  const logout = async () => {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      setStoredToken(null);
      setUser(null);
      setRestaurant(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, restaurant, loading, login, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
