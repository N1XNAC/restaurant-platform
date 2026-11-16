import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMoney } from '../lib/format';

interface AnalyticsSummary {
  kpis: {
    totalOrders: number;
    pendingOrders: number;
    acceptedOrders: number;
    preparingOrders: number;
    readyOrders: number;
    servedOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    rejectedOrders: number;
    grossSalesCents: number;
    netSalesCents: number;
    estimatedNetProfitCents: number;
    totalDishesSold: number;
    averageOrderValueCents: number;
    occupiedTables: number;
    availableTables: number;
    totalActiveTables: number;
  };
  popularDishes: Array<{ name: string; quantity: number; revenueCents: number }>;
  hourlySeries: Array<{ hour: string; orders: number; salesCents: number }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    createdAt: string;
    table: { tableNumber: string };
  }>;
  recentReviews: Array<{
    id: string;
    customerName: string;
    rating: number;
    comment: string | null;
    createdAt: string;
  }>;
}

const DATE_RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];

export function DashboardPage() {
  const { restaurant } = useAuth();
  const currency = restaurant?.currency ?? 'USD';
  const [range, setRange] = useState('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const queryParams = new URLSearchParams({ range });
  if (range === 'custom' && from) queryParams.set('from', from);
  if (range === 'custom' && to) queryParams.set('to', to);

  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', 'summary', range, from, to],
    queryFn: () => apiFetch<AnalyticsSummary>(`/api/v1/analytics/summary?${queryParams.toString()}`),
  });

  if (isLoading) return <div className="text-sm text-slate-500 py-8">Loading dashboard...</div>;
  if (error || !data) {
    return (
      <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
        Failed to load dashboard metrics.
      </div>
    );
  }

  const { kpis } = data;
  const chartData = data.hourlySeries.map((h) => ({
    ...h,
    salesDollars: Number((h.salesCents / 100).toFixed(2)),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Operational Dashboard</h1>
          <p className="text-sm text-slate-500">Real-time orders, tables, and revenue overview</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {DATE_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                range === r.key
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {r.label}
            </button>
          ))}
          {range === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="px-2 py-1 text-xs border border-slate-200 rounded-md bg-white"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="px-2 py-1 text-xs border border-slate-200 rounded-md bg-white"
              />
            </div>
          )}
        </div>
      </div>

      {/* Financial & Operational KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Gross Sales" value={formatMoney(kpis.grossSalesCents, currency)} />
        <KpiCard label="Net Sales" value={formatMoney(kpis.netSalesCents, currency)} />
        <KpiCard label="Est. Net Profit" value={formatMoney(kpis.estimatedNetProfitCents, currency)} />
        <KpiCard label="Avg Order Value" value={formatMoney(kpis.averageOrderValueCents, currency)} />
        <KpiCard label="Total Orders" value={String(kpis.totalOrders)} />
        <KpiCard label="Dishes Sold" value={String(kpis.totalDishesSold)} />
        <KpiCard
          label="Tables Occupied"
          value={`${kpis.occupiedTables} / ${kpis.totalActiveTables}`}
          sub={`${kpis.availableTables} available`}
        />
        <KpiCard
          label="Active Queue"
          value={String(kpis.pendingOrders + kpis.acceptedOrders + kpis.preparingOrders + kpis.readyOrders)}
          sub={`${kpis.pendingOrders} pending`}
        />
      </div>

      {/* Order Status Breakdown */}
      <div className="grid grid-cols-3 sm:grid-cols-7 gap-3">
        {[
          ['Pending', kpis.pendingOrders, 'bg-amber-50 text-amber-800 border-amber-200'],
          ['Accepted', kpis.acceptedOrders, 'bg-sky-50 text-sky-800 border-sky-200'],
          ['Preparing', kpis.preparingOrders, 'bg-indigo-50 text-indigo-800 border-indigo-200'],
          ['Ready', kpis.readyOrders, 'bg-emerald-50 text-emerald-800 border-emerald-200'],
          ['Served', kpis.servedOrders, 'bg-teal-50 text-teal-800 border-teal-200'],
          ['Completed', kpis.completedOrders, 'bg-slate-100 text-slate-800 border-slate-200'],
          ['Cancelled', kpis.cancelledOrders + kpis.rejectedOrders, 'bg-rose-50 text-rose-800 border-rose-200'],
        ].map(([label, val, cls]) => (
          <div key={String(label)} className={`p-3 rounded-xl border ${cls}`}>
            <div className="text-xs font-medium">{label}</div>
            <div className="text-lg font-semibold mt-0.5">{val}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Sales by Hour ({currency})</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={2} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="salesDollars"
                  name="Sales"
                  stroke="#0f172a"
                  fill="#cbd5e1"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Peak Ordering Periods</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={2} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="orders" name="Orders" fill="#0f172a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Popular Dishes, Recent Orders, Recent Reviews */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Most Popular Dishes</h2>
          {data.popularDishes.length === 0 ? (
            <p className="text-xs text-slate-500">No dishes sold in this period.</p>
          ) : (
            <div className="space-y-2.5">
              {data.popularDishes.slice(0, 6).map((d) => (
                <div key={d.name} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 truncate pr-2">{d.name}</span>
                  <span className="text-xs font-medium text-slate-900 shrink-0">
                    {d.quantity} sold ({formatMoney(d.revenueCents, currency)})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Recent Orders</h2>
          {data.recentOrders.length === 0 ? (
            <p className="text-xs text-slate-500">No orders in this period.</p>
          ) : (
            <div className="space-y-2.5">
              {data.recentOrders.slice(0, 6).map((o) => (
                <div key={o.id} className="flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium text-slate-900">
                      {o.orderNumber} · {o.table.tableNumber}
                    </div>
                    <div className="text-xs text-slate-500">{formatDateTime(o.createdAt)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{formatMoney(o.totalCents, currency)}</div>
                    <div className="text-[11px] text-slate-500">{o.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Recent Reviews</h2>
          {data.recentReviews.length === 0 ? (
            <p className="text-xs text-slate-500">No reviews yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recentReviews.map((r) => (
                <div key={r.id} className="border-b border-slate-100 last:border-0 pb-2.5 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-900">{r.customerName}</span>
                    <span className="text-xs font-semibold text-amber-600">{r.rating} / 5</span>
                  </div>
                  {r.comment && <p className="text-xs text-slate-600 mt-1 line-clamp-2">{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
