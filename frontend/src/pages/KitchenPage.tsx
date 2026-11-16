import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { elapsedMinutes } from '../lib/format';

interface KitchenOrder {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  table: { id: string; tableNumber: string };
  items: Array<{
    id: string;
    itemNameSnapshot: string;
    quantity: number;
    specialInstructions: string | null;
    prepTimeMinutes: number;
    itemStatus: 'PENDING' | 'PREPARING' | 'READY' | 'SERVED';
  }>;
}

export function KitchenPage() {
  const queryClient = useQueryClient();
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['orders', 'kitchen'],
    queryFn: () =>
      apiFetch<{ orders: KitchenOrder[] }>('/api/v1/orders?status=NEW,ACCEPTED,PREPARING'),
  });

  const itemMutation = useMutation({
    mutationFn: ({
      orderId,
      itemId,
      itemStatus,
    }: {
      orderId: string;
      itemId: string;
      itemStatus: string;
    }) =>
      apiFetch(`/api/v1/orders/${orderId}/items/${itemId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ itemStatus }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });

  const orderStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/v1/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Kitchen Display System (KDS)</h1>
        <p className="text-sm text-slate-500">
          Tablet-ready ticket queue with item-level prep tracking and delay alerts
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">Loading kitchen tickets...</div>
      ) : !data?.orders.length ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
          All caught up! No active kitchen tickets.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.orders.map((order) => {
            const waited = elapsedMinutes(order.createdAt);
            const maxPrep = Math.max(...order.items.map((i) => i.prepTimeMinutes), 15);
            const isDelayed = waited > maxPrep;

            return (
              <div
                key={order.id}
                className={`rounded-xl border-2 p-5 bg-white flex flex-col justify-between ${
                  isDelayed ? 'border-rose-500' : 'border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div>
                      <div className="text-lg font-bold text-slate-900">
                        Table {order.table.tableNumber}
                      </div>
                      <div className="text-xs text-slate-500">
                        {order.orderNumber} · {order.status}
                      </div>
                    </div>
                    <div
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        isDelayed ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {isDelayed ? (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                      {waited}m / {maxPrep}m
                    </div>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    {order.items.map((item) => (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {item.quantity}x {item.itemNameSnapshot}
                          </div>
                          <div className="text-xs text-slate-500">
                            Prep: {item.prepTimeMinutes}m · Status: {item.itemStatus}
                          </div>
                          {item.specialInstructions && (
                            <div className="text-xs text-amber-700 font-medium mt-0.5">
                              {item.specialInstructions}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() =>
                            itemMutation.mutate({
                              orderId: order.id,
                              itemId: item.id,
                              itemStatus: item.itemStatus === 'READY' ? 'PREPARING' : 'READY',
                            })
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 ${
                            item.itemStatus === 'READY'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {item.itemStatus === 'READY' ? 'Ready' : 'Mark Ready'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex gap-2">
                  {order.status === 'NEW' && (
                    <button
                      onClick={() =>
                        orderStatusMutation.mutate({ id: order.id, status: 'ACCEPTED' })
                      }
                      className="flex-1 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-lg"
                    >
                      Accept Ticket
                    </button>
                  )}
                  {order.status === 'ACCEPTED' && (
                    <button
                      onClick={() =>
                        orderStatusMutation.mutate({ id: order.id, status: 'PREPARING' })
                      }
                      className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg"
                    >
                      Start Preparing
                    </button>
                  )}
                  {order.status === 'PREPARING' && (
                    <button
                      onClick={() =>
                        orderStatusMutation.mutate({ id: order.id, status: 'READY' })
                      }
                      className="flex-1 py-2.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Complete Order (Ready)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
