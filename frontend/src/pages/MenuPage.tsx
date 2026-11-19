import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Archive } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { mediaUrl } from '../lib/endpoints';
import { useAuth } from '../lib/auth';
import { formatMoney } from '../lib/format';

interface MenuItemRow {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceCents: number;
  prepTimeMinutes: number;
  dietaryType: 'VEG' | 'NON_VEG' | 'VEGAN';
  allergens: string[];
  imageUrl: string | null;
  isAvailable: boolean;
  category: { id: string; name: string };
}

interface CategoryRow {
  id: string;
  name: string;
}

export function MenuPage() {
  const { user, restaurant } = useAuth();
  const currency = restaurant?.currency ?? 'USD';
  const canManage = user && ['OWNER', 'ADMIN', 'MANAGER'].includes(user.role);
  const queryClient = useQueryClient();

  const [selectedCat, setSelectedCat] = useState('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priceDollars, setPriceDollars] = useState('15.00');
  const [prepTimeMinutes, setPrepTimeMinutes] = useState(15);
  const [dietaryType, setDietaryType] = useState<'VEG' | 'NON_VEG' | 'VEGAN'>('VEG');
  const [description, setDescription] = useState('');
  const [allergens, setAllergens] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['menu'],
    queryFn: () =>
      apiFetch<{ categories: CategoryRow[]; items: MenuItemRow[] }>('/api/v1/menu'),
  });

  const toggleAvailMutation = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      apiFetch(`/api/v1/menu/items/${id}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['menu'] }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/menu/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['menu'] }),
  });

  const createItemMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/menu/items', {
        method: 'POST',
        body: JSON.stringify({
          categoryId: categoryId || data?.categories[0]?.id,
          name,
          description: description || null,
          priceCents: Math.round(Number.parseFloat(priceDollars) * 100),
          prepTimeMinutes,
          dietaryType,
          allergens: allergens
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          imageUrl: imageUrl || null,
        }),
      }),
    onSuccess: () => {
      setModalOpen(false);
      setName('');
      setDescription('');
      setAllergens('');
      setImageUrl('');
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to create dish'),
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await apiFetch<{ imageUrl: string }>('/api/v1/menu/upload', {
        method: 'POST',
        body: form,
      });
      setImageUrl(res.imageUrl);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const filteredItems =
    data?.items.filter((i) => selectedCat === 'ALL' || i.categoryId === selectedCat) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Menu Management</h1>
          <p className="text-sm text-slate-500">
            Dishes, pricing, dietary tags, and live availability synced to customer site
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800"
          >
            <Plus className="w-4 h-4" />
            Add Dish
          </button>
        )}
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedCat('ALL')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
            selectedCat === 'ALL'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-600'
          }`}
        >
          All Categories
        </button>
        {data?.categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCat(cat.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              selectedCat === cat.id
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">Loading menu...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between"
            >
              <div>
                {item.imageUrl && (
                  <img
                    src={mediaUrl(item.imageUrl)}
                    alt={item.name}
                    className="w-full h-36 object-cover rounded-lg mb-3"
                  />
                )}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{item.name}</div>
                    <div className="text-xs text-slate-500">
                      {item.category.name} · {item.prepTimeMinutes} min
                    </div>
                  </div>
                  <div className="font-semibold text-slate-900">
                    {formatMoney(item.priceCents, currency)}
                  </div>
                </div>
                {item.description && (
                  <p className="text-xs text-slate-600 mt-2">{item.description}</p>
                )}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                    {item.dietaryType}
                  </span>
                  {item.allergens.map((a) => (
                    <span
                      key={a}
                      className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() =>
                    toggleAvailMutation.mutate({ id: item.id, isAvailable: !item.isAvailable })
                  }
                  className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                    item.isAvailable
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {item.isAvailable ? 'Available' : 'Unavailable'}
                </button>
                {canManage && (
                  <button
                    onClick={() => archiveMutation.mutate(item.id)}
                    title="Archive dish"
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                  >
                    <Archive className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold">Add Menu Dish</h3>
            {errorMsg && <div className="text-xs text-rose-600">{errorMsg}</div>}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select
                value={categoryId || data?.categories[0]?.id || ''}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                {data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Dish Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Price ({currency})
                </label>
                <input
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prep Time (min)
                </label>
                <input
                  type="number"
                  value={prepTimeMinutes}
                  onChange={(e) => setPrepTimeMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Dietary Type</label>
              <select
                value={dietaryType}
                onChange={(e) => setDietaryType(e.target.value as 'VEG' | 'NON_VEG' | 'VEGAN')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                <option value="VEG">VEG</option>
                <option value="NON_VEG">NON_VEG</option>
                <option value="VEGAN">VEGAN</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Allergens (comma separated)
              </label>
              <input
                value={allergens}
                onChange={(e) => setAllergens(e.target.value)}
                placeholder="Dairy, Gluten"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Dish Image</label>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} className="text-xs" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => createItemMutation.mutate()}
                disabled={!name.trim() || createItemMutation.isPending}
                className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg"
              >
                Save Dish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
