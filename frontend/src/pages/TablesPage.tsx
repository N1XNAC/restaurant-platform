import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney } from '../lib/format';

interface TableRow {
  id: string;
  tableNumber: string;
  label: string | null;
  capacity: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING';
  isActive: boolean;
  activeOrdersCount: number;
  outstandingCents: number;
  orders: Array<{ id: string; orderNumber: string; status: string; totalCents: number }>;
}

const STATUS_BADGE: Record<string, string> = {
  AVAILABLE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  OCCUPIED: 'bg-rose-50 text-rose-700 border-rose-200',
  RESERVED: 'bg-amber-50 text-amber-700 border-amber-200',
  CLEANING: 'bg-sky-50 text-sky-700 border-sky-200',
};

export function TablesPage() {
  const { user, restaurant } = useAuth();
  const currency = restaurant?.currency ?? 'USD';
  const canManage = user && ['OWNER', 'ADMIN', 'MANAGER'].includes(user.role);
  const queryClient = useQueryClient();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [tableNumber, setTableNumber] = useState('');
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState(4);

  const { data, isLoading } = useQuery({
    queryKey: ['tables'],
    queryFn: () => apiFetch<{ tables: TableRow[] }>('/api/v1/tables'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/v1/tables/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Status update failed'),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/tables', {
        method: 'POST',
        body: JSON.stringify({ tableNumber, label: label || undefined, capacity }),
      }),
    onSuccess: () => {
      setModalOpen(false);
      setTableNumber('');
      setLabel('');
      setCapacity(4);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Create failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/tables/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Delete failed'),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Table Management</h1>
          <p className="text-sm text-slate-500">
            Occupancy, active orders per table, and outstanding balances
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800"
          >
            <Plus className="w-4 h-4" />
            Add Table
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {errorMsg}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-slate-500">Loading tables...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {data?.tables
            .filter((t) => t.isActive)
            .map((table) => (
              <div
                key={table.id}
                className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-lg font-semibold text-slate-900">{table.tableNumber}</div>
                      <div className="text-xs text-slate-500">
                        {table.label ?? 'Dining'} · {table.capacity} seats
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                        STATUS_BADGE[table.status] ?? 'bg-slate-100'
                      }`}
                    >
                      {table.status}
                    </span>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 text-xs space-y-1">
                    <div className="flex justify-between text-slate-600">
                      <span>Active Orders</span>
                      <span className="font-semibold text-slate-900">{table.activeOrdersCount}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Outstanding</span>
                      <span className="font-semibold text-slate-900">
                        {formatMoney(table.outstandingCents, currency)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <select
                    value={table.status}
                    onChange={(e) =>
                      statusMutation.mutate({ id: table.id, status: e.target.value })
                    }
                    className="flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="AVAILABLE">AVAILABLE</option>
                    <option value="OCCUPIED">OCCUPIED</option>
                    <option value="RESERVED">RESERVED</option>
                    <option value="CLEANING">CLEANING</option>
                  </select>
                  {canManage && (
                    <button
                      onClick={() => deleteMutation.mutate(table.id)}
                      title="Deactivate/Delete table"
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-semibold">Add Restaurant Table</h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Table Number</label>
              <input
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                placeholder="e.g. T-09"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Label / Area</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Rooftop"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Capacity</label>
              <input
                type="number"
                min={1}
                max={20}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!tableNumber.trim() || createMutation.isPending}
                className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
