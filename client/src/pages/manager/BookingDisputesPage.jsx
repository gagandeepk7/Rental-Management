import { formatTime } from '../../../../shared/time.mjs';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';

export default function BookingDisputesPage({ session }) {
  const [disputes, setDisputes] = useState([]);
  const [resolutions, setResolutions] = useState({});
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const refresh = async () => {
    const response = await apiFetch('/manager/booking-disputes', {}, session.access_token);
    setDisputes(response.disputes || []);
  };
  useEffect(() => { let live = true; apiFetch('/manager/booking-disputes', {}, session.access_token).then((data) => { if (live) setDisputes(data.disputes || []); }).catch((loadError) => { if (live) setError(loadError.message || 'Unable to load disputes.'); }); return () => { live = false; }; }, [session.access_token]);

  const resolve = async (dispute, status) => {
    setBusyId(dispute.id); setError('');
    try {
      await apiFetch(`/manager/booking-disputes/${dispute.id}`, { method: 'PATCH', body: JSON.stringify({ status, resolution: resolutions[dispute.id] || '' }) }, session.access_token);
      await refresh();
    } catch (resolveError) { setError(resolveError.message || 'Unable to resolve dispute.'); }
    finally { setBusyId(''); }
  };

  return <section className="card rounded-2xl p-5"><p className="text-xs uppercase tracking-[0.2em] text-sky-300">Reservations</p><h3 className="mt-1 text-xl font-semibold text-white">Booking disputes</h3>{error && <p className="mt-3 text-sm text-rose-200">{error}</p>}<div className="mt-5 space-y-3">{disputes.length ? disputes.map((dispute) => <article key={dispute.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-white">{dispute.amenity?.name || 'Amenity'} · {dispute.tenant?.full_name || 'Tenant'}</p><p className="text-sm text-slate-400">{dispute.booking?.booking_date} · {formatTime(dispute.booking?.check_in_time)}–{formatTime(dispute.booking?.check_out_time)}</p></div><span className="rounded-full bg-slate-800 px-2 py-1 text-xs capitalize text-slate-200">{dispute.status}</span></div><p className="mt-3 text-sm text-slate-200">{dispute.details}</p>{dispute.status === 'open' ? <div className="mt-4 space-y-3"><textarea className="input min-h-20" placeholder="Resolution notes required" value={resolutions[dispute.id] || ''} onChange={(event) => setResolutions((current) => ({ ...current, [dispute.id]: event.target.value }))} /><div className="flex gap-2"><button disabled={busyId === dispute.id || !resolutions[dispute.id]?.trim()} onClick={() => resolve(dispute, 'resolved')} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Resolve</button><button disabled={busyId === dispute.id || !resolutions[dispute.id]?.trim()} onClick={() => resolve(dispute, 'dismissed')} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">Dismiss</button></div></div> : <p className="mt-3 text-sm text-emerald-200">{dispute.resolution}</p>}</article>) : <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">No booking disputes.</p>}</div></section>;
}
