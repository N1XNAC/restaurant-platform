import React, { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';

export function SettingsPage() {
  const { restaurant, refreshMe } = useAuth();
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [hours, setHours] = useState('');
  const [taxRatePct, setTaxRatePct] = useState('8.00');
  const [serviceChargePct, setServiceChargePct] = useState('0.00');
  const [currency, setCurrency] = useState('USD');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (restaurant) {
      setName(restaurant.name);
      setTagline(restaurant.tagline ?? '');
      setHours(restaurant.hours ?? '');
      setTaxRatePct((restaurant.taxRateBps / 100).toFixed(2));
      setServiceChargePct(((restaurant.serviceChargeBps ?? 0) / 100).toFixed(2));
      setCurrency(restaurant.currency);
      setAddress(restaurant.address ?? '');
      setPhone(restaurant.phone ?? '');
    }
  }, [restaurant]);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/restaurant', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          tagline: tagline || null,
          hours: hours || null,
          taxRateBps: Math.round(Number.parseFloat(taxRatePct) * 100),
          serviceChargeBps: Math.round(Number.parseFloat(serviceChargePct || '0') * 100),
          currency,
          address: address || null,
          phone: phone || null,
        }),
      }),
    onSuccess: async () => {
      await refreshMe();
      setSavedMsg('Restaurant settings saved.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedMsg(null);
    mutation.mutate();
  };

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Restaurant Settings</h1>
        <p className="text-sm text-slate-500">
          Configure restaurant profile, tax rate, and currency
        </p>
      </div>

      {savedMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {savedMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Restaurant Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Tagline</label>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Seasonal Hearth & Botanical Kitchen"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Opening Hours</label>
            <input
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Wed–Sun · 17:00 – 22:30"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Currency</label>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Tax Rate (%)</label>
            <input
              type="number"
              step="0.01"
              value={taxRatePct}
              onChange={(e) => setTaxRatePct(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Service Charge (%)</label>
            <input
              type="number"
              step="0.01"
              value={serviceChargePct}
              onChange={(e) => setServiceChargePct(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Applied to the food subtotal of every new order (customer site included).
            </p>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800"
        >
          {mutation.isPending ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
