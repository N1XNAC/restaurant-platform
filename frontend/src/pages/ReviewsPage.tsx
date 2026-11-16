import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';

interface ReviewRow {
  id: string;
  customerName: string;
  rating: number;
  comment: string | null;
  response: string | null;
  createdAt: string;
  order: { orderNumber: string } | null;
}

export function ReviewsPage() {
  const { user } = useAuth();
  const canReply = user && ['OWNER', 'ADMIN', 'MANAGER'].includes(user.role);
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['reviews'],
    queryFn: () =>
      apiFetch<{
        reviews: ReviewRow[];
        summary: { total: number; avgRating: number; distribution: Record<number, number> };
      }>('/api/v1/reviews'),
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, response }: { id: string; response: string }) =>
      apiFetch(`/api/v1/reviews/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ response }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reviews'] }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Customer Reviews</h1>
        <p className="text-sm text-slate-500">Ratings, written feedback, and management responses</p>
      </div>

      {data && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex flex-col justify-center">
            <div className="text-3xl font-bold text-slate-900">{data.summary.avgRating} / 5</div>
            <div className="text-xs text-slate-500 mt-1">
              Based on {data.summary.total} review(s)
            </div>
          </div>
          <div className="md:col-span-2 space-y-1.5">
            {[5, 4, 3, 2, 1].map((stars) => {
              const count = data.summary.distribution[stars] ?? 0;
              const pct = data.summary.total > 0 ? Math.round((count / data.summary.total) * 100) : 0;
              return (
                <div key={stars} className="flex items-center gap-3 text-xs">
                  <span className="w-10 text-slate-600">{stars} star</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right text-slate-600">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-slate-500">Loading reviews...</div>
      ) : (
        <div className="space-y-4">
          {data?.reviews.map((r) => (
            <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-900">{r.customerName}</span>
                  {r.order && (
                    <span className="ml-2 text-xs text-slate-500">Order {r.order.orderNumber}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-amber-500 text-sm font-semibold">
                  <Star className="w-4 h-4 fill-amber-400" />
                  {r.rating}
                </div>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{formatDateTime(r.createdAt)}</div>
              {r.comment && <p className="text-sm text-slate-700 mt-2">{r.comment}</p>}

              {r.response ? (
                <div className="mt-3 p-3 bg-slate-50 rounded-lg text-xs text-slate-700">
                  <span className="font-semibold">Restaurant Response:</span> {r.response}
                </div>
              ) : (
                canReply && (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={replyText[r.id] ?? ''}
                      onChange={(e) => setReplyText((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      placeholder="Write a response..."
                      className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                    />
                    <button
                      onClick={() =>
                        replyMutation.mutate({ id: r.id, response: replyText[r.id] ?? '' })
                      }
                      disabled={!replyText[r.id]?.trim()}
                      className="px-3 py-1.5 bg-slate-900 text-white text-xs rounded-lg"
                    >
                      Reply
                    </button>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
