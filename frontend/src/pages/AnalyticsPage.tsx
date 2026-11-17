import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMoney } from '../lib/format';

interface AnalyticsSummary {
  kpis: {
    grossSalesCents: number;
    discountsCents: number;
    refundsCents: number;
    netSalesCents: number;
    taxesCollectedCents: number;
    serviceChargesCents: number;
    cogsCents: number;
    operatingExpensesCents: number;
    estimatedGrossProfitCents: number;
    estimatedNetProfitCents: number;
    totalOrders: number;
    averageOrderValueCents: number;
  };
  popularDishes: Array<{ name: string; quantity: number; revenueCents: number }>;
  revenueByCategory: Array<{ name: string; revenueCents: number; count: number }>;
}

interface ExpenseRow {
  id: string;
  category: string;
  description: string;
  amountCents: number;
  expenseDate: string;
}

export function AnalyticsPage() {
  const { restaurant } = useAuth();
  const currency = restaurant?.currency ?? 'USD';
  const queryClient = useQueryClient();
  const [range, setRange] = useState('30d');

  const [expCategory, setExpCategory] = useState('Supplies');
  const [expDesc, setExpDesc] = useState('');
  const [expDollars, setExpDollars] = useState('');

  const { data } = useQuery({
    queryKey: ['analytics', 'finance', range],
    queryFn: () => apiFetch<AnalyticsSummary>(`/api/v1/analytics/summary?range=${range}`),
  });

  const { data: expData } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => apiFetch<{ expenses: ExpenseRow[] }>('/api/v1/expenses'),
  });

  const addExpenseMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/expenses', {
        method: 'POST',
        body: JSON.stringify({
          category: expCategory,
          description: expDesc,
          amountCents: Math.round(Number.parseFloat(expDollars) * 100),
        }),
      }),
    onSuccess: () => {
      setExpDesc('');
      setExpDollars('');
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const k = data?.kpis;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Sales & Profit Analytics</h1>
          <p className="text-sm text-slate-500">
            Accurate P&L, COGS, refunds, taxes, expenses, and CSV export
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="month">This month</option>
          </select>
          <a
            href={`/api/v1/analytics/export.csv?range=${range}`}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </a>
        </div>
      </div>

      {k && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-2 md:grid-cols-5 gap-4">
          <Stat label="Gross Sales" value={formatMoney(k.grossSalesCents, currency)} />
          <Stat label="Discounts" value={formatMoney(k.discountsCents, currency)} />
          <Stat label="Refunds" value={formatMoney(k.refundsCents, currency)} />
          <Stat label="Net Sales" value={formatMoney(k.netSalesCents, currency)} />
          <Stat label="Taxes Collected" value={formatMoney(k.taxesCollectedCents, currency)} />
          <Stat label="Service Charges" value={formatMoney(k.serviceChargesCents, currency)} />
          <Stat label="Cost of Goods (COGS)" value={formatMoney(k.cogsCents, currency)} />
          <Stat label="Operating Expenses" value={formatMoney(k.operatingExpensesCents, currency)} />
          <Stat label="Est. Gross Profit" value={formatMoney(k.estimatedGrossProfitCents, currency)} />
          <Stat label="Est. Net Profit" value={formatMoney(k.estimatedNetProfitCents, currency)} />
          <Stat label="Avg Order Value" value={formatMoney(k.averageOrderValueCents, currency)} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Revenue per Category</h2>
          {!data?.revenueByCategory.length ? (
            <p className="text-xs text-slate-500">No category revenue in this period.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {data.revenueByCategory.map((c) => (
                <div key={c.name} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
                  <span>{c.name} ({c.count} items)</span>
                  <span className="font-medium">{formatMoney(c.revenueCents, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Revenue per Dish</h2>
          {!data?.popularDishes.length ? (
            <p className="text-xs text-slate-500">No dish revenue in this period.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {data.popularDishes.map((d) => (
                <div key={d.name} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
                  <span>{d.name} ({d.quantity}x)</span>
                  <span className="font-medium">{formatMoney(d.revenueCents, currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Operating Expenses */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Record Operating Expense</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            value={expCategory}
            onChange={(e) => setExpCategory(e.target.value)}
            placeholder="Category (e.g. Utilities)"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <input
            value={expDesc}
            onChange={(e) => setExpDesc(e.target.value)}
            placeholder="Description"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm sm:col-span-2"
          />
          <div className="flex gap-2">
            <input
              value={expDollars}
              onChange={(e) => setExpDollars(e.target.value)}
              placeholder="Amount"
              type="number"
              step="0.01"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <button
              onClick={() => addExpenseMutation.mutate()}
              disabled={!expDesc.trim() || !expDollars || addExpenseMutation.isPending}
              className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg shrink-0"
            >
              Add
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-100 text-sm">
          {expData?.expenses.map((e) => (
            <div key={e.id} className="py-2.5 flex items-center justify-between">
              <div>
                <span className="font-medium text-slate-900">{e.category}</span> —{' '}
                <span className="text-slate-600">{e.description}</span>
                <div className="text-xs text-slate-400">{formatDateTime(e.expenseDate)}</div>
              </div>
              <span className="font-semibold text-slate-900">
                {formatMoney(e.amountCents, currency)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}
