import { useState } from 'react';
import { apiFetch } from '../lib/api.js';

export default function NotificationsPage({ session, notifications, onRefresh }) {
  const [error, setError] = useState('');
  const markRead = async (notification) => {
    if (notification.read_at) return;
    try {
      await apiFetch(`/notifications/${notification.id}/read`, { method: 'PATCH' }, session.access_token);
      await onRefresh();
    } catch (readError) { setError(readError.message || 'Unable to update notification.'); }
  };
  return <section className="card rounded-2xl p-5"><p className="text-xs uppercase tracking-[0.2em] text-sky-300">Updates</p><h3 className="mt-1 text-xl font-semibold text-white">Notifications</h3>{error && <p className="mt-3 text-sm text-rose-200">{error}</p>}<div className="mt-5 divide-y divide-slate-800">{notifications.length ? notifications.map((item) => <button key={item.id} type="button" onClick={() => markRead(item)} className={`block w-full py-4 text-left ${item.read_at ? 'opacity-60' : ''}`}><span className="flex items-center justify-between gap-3"><span className="font-medium text-white">{item.title}</span><span className="text-xs text-slate-400">{new Date(item.created_at).toLocaleString()}</span></span><span className="mt-1 block text-sm text-slate-300">{item.message}</span>{!item.read_at && <span className="mt-2 block text-xs text-sky-300">Mark as read</span>}</button>) : <p className="py-4 text-sm text-slate-400">You’re all caught up.</p>}</div></section>;
}
