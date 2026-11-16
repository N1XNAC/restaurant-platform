import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth, type StaffRole } from '../lib/auth';
import { formatDateTime } from '../lib/format';

interface StaffRow {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
}

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actor: { name: string; role: string } | null;
}

export function StaffPage() {
  const { user } = useAuth();
  const canEdit = user && ['OWNER', 'ADMIN'].includes(user.role);
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<StaffRole>('WAITER');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: staffData } = useQuery({
    queryKey: ['staff'],
    queryFn: () => apiFetch<{ staff: StaffRow[] }>('/api/v1/staff'),
  });

  const { data: auditData } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => apiFetch<{ logs: AuditRow[] }>('/api/v1/audit-logs'),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/staff', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role }),
      }),
    onSuccess: () => {
      setName('');
      setEmail('');
      setPassword('');
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add staff'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/api/v1/staff/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Staff & Audit Logs</h1>
        <p className="text-sm text-slate-500">
          Role-based access control and security audit trail
        </p>
      </div>

      {canEdit && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Add Staff Member</h2>
          {errorMsg && <div className="text-xs text-rose-600">{errorMsg}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full Name"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (8+ chars)"
              type="password"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              <option value="WAITER">WAITER</option>
              <option value="KITCHEN_STAFF">KITCHEN_STAFF</option>
              <option value="MANAGER">MANAGER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="OWNER">OWNER</option>
            </select>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!name || !email || password.length < 8}
              className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg disabled:opacity-50"
            >
              Create User
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600 uppercase">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              {canEdit && <th className="px-4 py-3 text-right">Action</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staffData?.staff.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                <td className="px-4 py-3 text-slate-600">{s.email}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-xs font-medium">
                    {s.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs font-medium ${
                      s.isActive ? 'text-emerald-700' : 'text-slate-400'
                    }`}
                  >
                    {s.isActive ? 'Active' : 'Disabled'}
                  </span>
                </td>
                {canEdit && (
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() =>
                        toggleActiveMutation.mutate({ id: s.id, isActive: !s.isActive })
                      }
                      className="text-xs text-slate-600 hover:text-slate-900 underline"
                    >
                      {s.isActive ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Recent Audit Logs</h2>
        <div className="space-y-2 max-h-80 overflow-y-auto text-xs">
          {auditData?.logs.map((l) => (
            <div key={l.id} className="flex justify-between py-2 border-b border-slate-100 last:border-0">
              <div>
                <span className="font-semibold text-slate-900">{l.action}</span> ·{' '}
                <span className="text-slate-600">
                  {l.entityType} {l.entityId ? `(${l.entityId.slice(-6)})` : ''}
                </span>{' '}
                — {l.actor ? `${l.actor.name} (${l.actor.role})` : 'System'}
              </div>
              <span className="text-slate-400">{formatDateTime(l.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
