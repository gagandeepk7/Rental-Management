import { formatDateTime } from '../../../../shared/time.mjs';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import { supabase } from '../../lib/supabase.js';

export default function ActivityPage({ session }) {
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const loadActivity = () => apiFetch('/manager/activity', {}, session.access_token).then((result) => { if (live) { setActivity(result.activity || []); setError(''); } }).catch((loadError) => { if (live) setError(loadError.message || 'Unable to load activity.'); });
    void loadActivity();
    const channel = supabase.channel('manager-activity').on('postgres_changes', { event: '*', schema: 'public', table: 'activity_events' }, () => void loadActivity()).subscribe();
    return () => { live = false; void supabase.removeChannel(channel); };
  }, [session.access_token]);
  return <section className="card rounded-2xl p-5"><p className="text-xs uppercase tracking-[0.2em] text-sky-300">Portfolio history</p><h3 className="mt-1 text-xl font-semibold text-white">Recent activity</h3>{error && <p className="mt-3 text-sm text-rose-200">{error}</p>}<div className="mt-5 divide-y divide-slate-800">{activity.length ? activity.map((event) => <div key={event.id} className="py-3"><p className="font-medium text-white">{event.action.replaceAll('_', ' ')}</p><p className="text-sm text-slate-400">{event.entity_type} · {formatDateTime(event.created_at)}</p></div>) : !error && <p className="py-4 text-sm text-slate-400">No recorded activity yet.</p>}</div></section>;
}
