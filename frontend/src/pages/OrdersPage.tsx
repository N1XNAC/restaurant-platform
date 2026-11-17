import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CreditCard } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMoney } from '../lib/format';

interface OrderItemRow {
  id: string;
  itemNameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  extrasTotalCents: number;
  lineTotalCents: number;
  specialInstructions: string | null;
  itemStatus: string;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  tableId: string;
  status: string;
  paymentStatus: string;
  subtotalCents: number;
  taxCents: number;
  serviceChargeCents: number;
  discountCents: number;
  totalCents: number;
  notes: string | null;
  createdAt: string;
  table: { id: string; tableNumber: string; label: string | null };
  items: OrderItemRow[];
}

const STATUS_TABS = ['ALL', 'NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'];

const NEXT_ACTIONS: Record<string, Array<{ status: string; label: string; style: string }>> = {
  NEW: [
    { status: 'ACCEPTED', label: 'Accept', style: 'bg-slate-900 text-white hover:bg-slate-800' },
    { status: 'REJECTED', label: 'Reject', style: 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200' },
  ],
  ACCEPTED: [
    { status: 'PREPARING', label: 'Start Prep', style: 'bg-indigo-600 text-white hover:bg-indigo-700' },
    { status: 'CANCELLED', label: 'Cancel', style: 'bg-slate-100 text-slate-700 hover:bg-slate-200' },
  ],
  PREPARING: [
    { status: 'READY', label: 'Mark Ready', style: 'bg-emerald-600 text-white hover:bg-emerald-700' },
  ],
  READY: [
    { status: 'SERVED', label: 'Mark Served', style: 'bg-teal-600 text-white hover:bg-teal-700' },
  ],
  SERVED: [
    { status: 'COMPLETED', label: 'Complete Order', style: 'bg-slate-900 text-white hover:bg-slate-800' },
  ],
};

export function OrdersPage() {
  const { restaurant } = useAuth();
  const currency = restaurant?.currency ?? 'USD';
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [actionError, setActionError] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  const [simTableId, setSimTableId] = useState('');
  const [simItemId, setSimItemId] = useState('');
  const [simQty, setSimQty] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['orders', statusFilter],
    queryFn: () =>
      apiFetch<{ orders: OrderRow[] }>(
        statusFilter === 'ALL' ? '/api/v1/orders' : `/api/v1/orders?status=${statusFilter}`
      ),
  });

  const { data: tablesData } = useQuery({
    queryKey: ['tables'],
    queryFn: () => apiFetch<{ tables: Array<{ id: string; tableNumber: string; isActive: boolean }> }>('/api/v1/tables'),
    enabled: simOpen,
  });

  const { data: menuData } = useQuery({
    queryKey: ['menu'],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; priceCents: number; isAvailable: boolean }> }>('/api/v1/menu'),
    enabled: simOpen,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/v1/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Status update failed'),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, amountCents }: { id: string; amountCents: number }) =>
      apiFetch(`/api/v1/orders/${id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amountCents, method: 'CARD' }),
      }),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Payment failed'),
  });

  const simulateOrderMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/public/restaurants/${restaurant?.slug ?? 'bistro-lumiere'}/orders`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `sim-${Date.now()}` },
        body: JSON.stringify({
          tableId: simTableId || tablesData?.tables[0]?.id,
          items: [{ menuItemId: simItemId || menuData?.items[0]?.id, quantity: simQty }],
        }),
      }),
    onSuccess: () => {
      setSimOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Order submission failed'),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Live Order Management</h1>
          <p className="text-sm text-slate-500">
            Track incoming customer orders and enforce kitchen-to-table lifecycle
          </p>
        </div>
        <button
          onClick={() => setSimOpen(true)}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800"
        >
          <Plus className="w-4 h-4" />
          Place Test Customer Order
        </button>
      </div>

      {actionError && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {actionError}
        </div>
      )}

      {/* Status Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-3">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              statusFilter === tab
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">Loading orders...</div>
      ) : !data?.orders.length ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          No orders in this status.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.orders.map((order) => (
            <div key={order.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{order.orderNumber}</span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-medium">
                        Table {order.table.tableNumber}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {formatDateTime(order.createdAt)} · Table ID: {order.tableId.slice(-6)}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-900 text-white">
                      {order.status}
                    </span>
                    <div className="text-[11px] text-slate-500 mt-1">{order.paymentStatus}</div>
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3 space-y-2">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-start justify-between text-sm">
                      <div>
                        <span className="font-medium text-slate-900">
                          {item.quantity}x {item.itemNameSnapshot}
                        </span>
                        {item.specialInstructions && (
                          <div className="text-xs text-amber-700">Note: {item.specialInstructions}</div>
                        )}
                      </div>
                      <span className="text-slate-700">
                        {formatMoney(item.lineTotalCents, currency)}
                      </span>
                    </div>
                  ))}
                </div>

                {order.notes && (
                  <div className="mt-2 text-xs bg-amber-50 text-amber-800 px-2.5 py-1.5 rounded-md">
                    Order Note: {order.notes}
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-600 space-y-1">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatMoney(order.subtotalCents, currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tax</span>
                    <span>{formatMoney(order.taxCents, currency)}</span>
                  </div>
                  {order.serviceChargeCents > 0 && (
                    <div className="flex justify-between">
                      <span>Service charge</span>
                      <span>{formatMoney(order.serviceChargeCents, currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-semibold text-slate-900 pt-1">
                    <span>Total</span>
                    <span>{formatMoney(order.totalCents, currency)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                {(NEXT_ACTIONS[order.status] ?? []).map((act) => (
                  <button
                    key={act.status}
                    onClick={() => statusMutation.mutate({ id: order.id, status: act.status })}
                    disabled={statusMutation.isPending}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${act.style}`}
                  >
                    {act.label}
                  </button>
                ))}
                {order.paymentStatus === 'UNPAID' &&
                  order.status !== 'CANCELLED' &&
                  order.status !== 'REJECTED' && (
                    <button
                      onClick={() => payMutation.mutate({ id: order.id, amountCents: order.totalCents })}
                      className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      Mark Paid
                    </button>
                  )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Test Customer Order Modal */}
      {simOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold">Simulate Customer Website Order</h3>
            <p className="text-xs text-slate-500">
              Submits a real order through the public customer endpoint (
              <code>POST /api/v1/public/restaurants/.../orders</code>).
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Table</label>
              <select
                value={simTableId || tablesData?.tables[0]?.id || ''}
                onChange={(e) => setSimTableId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                {tablesData?.tables
                  .filter((t) => t.isActive)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.tableNumber}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Dish</label>
              <select
                value={simItemId || menuData?.items[0]?.id || ''}
                onChange={(e) => setSimItemId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                {menuData?.items
                  .filter((i) => i.isAvailable)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({formatMoney(i.priceCents, currency)})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                max={20}
                value={simQty}
                onChange={(e) => setSimQty(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setSimOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => simulateOrderMutation.mutate()}
                disabled={simulateOrderMutation.isPending}
                className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800"
              >
                {simulateOrderMutation.isPending ? 'Submitting...' : 'Submit Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
