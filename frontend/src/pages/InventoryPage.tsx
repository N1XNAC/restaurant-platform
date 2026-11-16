import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMoney } from '../lib/format';

interface IngredientRow {
  id: string;
  name: string;
  unit: string;
  stockQty: number;
  lowStockThreshold: number;
  costPerUnitCents: number;
  isLowStock: boolean;
}

interface TransactionRow {
  id: string;
  type: string;
  quantityDelta: number;
  notes: string | null;
  createdAt: string;
  ingredient: { name: string; unit: string };
}

export function InventoryPage() {
  const { restaurant } = useAuth();
  const currency = restaurant?.currency ?? 'USD';
  const queryClient = useQueryClient();

  const [adjId, setAdjId] = useState<string | null>(null);
  const [adjType, setAdjType] = useState<'RESTOCK' | 'WASTAGE' | 'ADJUSTMENT'>('RESTOCK');
  const [adjQty, setAdjQty] = useState('10');
  const [adjNotes, setAdjNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: ingData, isLoading } = useQuery({
    queryKey: ['inventory', 'ingredients'],
    queryFn: () => apiFetch<{ ingredients: IngredientRow[] }>('/api/v1/inventory/ingredients'),
  });

  const { data: txData } = useQuery({
    queryKey: ['inventory', 'transactions'],
    queryFn: () => apiFetch<{ transactions: TransactionRow[] }>('/api/v1/inventory/transactions'),
  });

  const adjustMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          ingredientId: adjId,
          type: adjType,
          quantityDelta: Number.parseFloat(adjQty),
          notes: adjNotes || undefined,
        }),
      }),
    onSuccess: () => {
      setAdjId(null);
      setAdjNotes('');
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Adjustment failed'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Inventory Management</h1>
        <p className="text-sm text-slate-500">
          Ingredient stock levels, low-stock alerts, wastage, and automated recipe deductions
        </p>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {errorMsg}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600 uppercase">
            <tr>
              <th className="px-4 py-3">Ingredient</th>
              <th className="px-4 py-3">In Stock</th>
              <th className="px-4 py-3">Low Threshold</th>
              <th className="px-4 py-3">Unit Cost</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  Loading inventory...
                </td>
              </tr>
            ) : (
              ingData?.ingredients.map((ing) => (
                <tr key={ing.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{ing.name}</td>
                  <td className="px-4 py-3">
                    {ing.stockQty} {ing.unit}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {ing.lowStockThreshold} {ing.unit}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatMoney(ing.costPerUnitCents, currency)} / {ing.unit}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        ing.isLowStock
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {ing.isLowStock ? 'Low Stock' : 'Healthy'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setAdjId(ing.id)}
                      className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-md"
                    >
                      Adjust Stock
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Recent Inventory Transactions</h2>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {txData?.transactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between text-xs py-2 border-b border-slate-100 last:border-0"
            >
              <div>
                <span className="font-semibold text-slate-900">{tx.ingredient.name}</span> ·{' '}
                <span className="text-slate-600">{tx.type}</span>
                {tx.notes && <span className="text-slate-500"> — {tx.notes}</span>}
              </div>
              <div className="text-right">
                <span
                  className={`font-semibold ${
                    tx.quantityDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {tx.quantityDelta >= 0 ? `+${tx.quantityDelta}` : tx.quantityDelta}{' '}
                  {tx.ingredient.unit}
                </span>
                <div className="text-[11px] text-slate-400">{formatDateTime(tx.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {adjId && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-semibold">Adjust Stock</h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
              <select
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as 'RESTOCK' | 'WASTAGE' | 'ADJUSTMENT')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                <option value="RESTOCK">RESTOCK (+)</option>
                <option value="WASTAGE">WASTAGE (-)</option>
                <option value="ADJUSTMENT">ADJUSTMENT (+/-)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Quantity</label>
              <input
                type="number"
                value={adjQty}
                onChange={(e) => setAdjQty(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
              <input
                value={adjNotes}
                onChange={(e) => setAdjNotes(e.target.value)}
                placeholder="Reason or supplier invoice"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAdjId(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => adjustMutation.mutate()}
                className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
