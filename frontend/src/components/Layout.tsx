import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  ClipboardList,
  ChefHat,
  Grid2x2,
  UtensilsCrossed,
  Boxes,
  BarChart3,
  MessageSquareQuote,
  Users,
  Settings,
  Bell,
  LogOut,
  Wifi,
  WifiOff,
  Menu,
  X,
} from 'lucide-react';
import { useAuth, type StaffRole } from '../lib/auth';
import { useRealtime } from '../lib/realtime';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: StaffRole[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/orders', label: 'Live Orders', icon: ClipboardList },
  { to: '/kitchen', label: 'Kitchen Display', icon: ChefHat },
  { to: '/tables', label: 'Tables', icon: Grid2x2 },
  { to: '/menu', label: 'Menu', icon: UtensilsCrossed, roles: ['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN_STAFF'] },
  { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN_STAFF'] },
  { to: '/analytics', label: 'Analytics & Finance', icon: BarChart3, roles: ['OWNER', 'ADMIN', 'MANAGER'] },
  { to: '/reviews', label: 'Reviews', icon: MessageSquareQuote },
  { to: '/staff', label: 'Staff & Audit', icon: Users, roles: ['OWNER', 'ADMIN', 'MANAGER'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['OWNER', 'ADMIN'] },
];

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export function Layout() {
  const { user, restaurant, logout } = useAuth();
  const { connected, lastAlert, dismissAlert } = useRealtime();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiFetch<{ notifications: NotificationRow[]; unreadCount: number }>('/api/v1/notifications'),
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role))
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200">
          <div>
            <div className="font-semibold text-slate-900 tracking-tight">
              {restaurant?.name ?? 'Lumiere Ops'}
            </div>
            <div className="text-xs text-slate-500">Restaurant Control</div>
          </div>
          <button
            className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{user?.name}</div>
              <div className="text-xs text-slate-500">{user?.role}</div>
            </div>
            <button
              onClick={() => void logout()}
              title="Sign out"
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                connected
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}
            >
              {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {connected ? 'Live Sync' : 'Reconnecting...'}
            </div>
          </div>

          <div className="relative">
            <button
              onClick={() => setNotifOpen((v) => !v)}
              className="relative p-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {(notifData?.unreadCount ?? 0) > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-semibold flex items-center justify-center">
                  {notifData?.unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-sm font-semibold">Notifications</span>
                  <button
                    onClick={() => markAllReadMutation.mutate()}
                    className="text-xs text-slate-600 hover:text-slate-900 font-medium"
                  >
                    Mark all read
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                  {!notifData?.notifications.length ? (
                    <div className="p-6 text-center text-sm text-slate-500">
                      No notifications yet.
                    </div>
                  ) : (
                    notifData.notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => !n.isRead && markReadMutation.mutate(n.id)}
                        className={`p-3.5 cursor-pointer hover:bg-slate-50 ${
                          n.isRead ? 'opacity-65' : 'bg-blue-50/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium text-slate-900">{n.title}</div>
                          {!n.isRead && (
                            <span className="w-2 h-2 rounded-full bg-blue-600 mt-1.5 shrink-0" />
                          )}
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">{n.message}</div>
                        <div className="text-[11px] text-slate-400 mt-1">
                          {formatDateTime(n.createdAt)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Live New Order Toast */}
        {lastAlert && (
          <div className="mx-4 lg:mx-6 mt-4 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-md flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{lastAlert.title}</div>
              <div className="text-xs text-slate-300">{lastAlert.message}</div>
            </div>
            <button
              onClick={dismissAlert}
              className="text-xs bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-md"
            >
              Dismiss
            </button>
          </div>
        )}

        <main className="flex-1 p-4 lg:p-6 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
