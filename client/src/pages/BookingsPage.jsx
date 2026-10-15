import { formatTime, formatDateTime } from '../../../shared/time.mjs';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { getBookingTimeState } from '../lib/bookingTime.js';

export default function BookingsPage({ bookings, session, profile, staffCapabilities = [], onRefresh }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refreshTime = () => setNow(new Date());
    const timer = setInterval(refreshTime, 1000);
    window.addEventListener('focus', refreshTime);
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshTime); };
  }, []);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [disputeFormId, setDisputeFormId] = useState('');
  const [disputeDetails, setDisputeDetails] = useState('');
  const handleAction = async (booking, action) => {
    setBusyId(booking.id); setError('');
    try {
      await apiFetch(`/bookings/${booking.id}`, { method: 'PATCH', body: JSON.stringify({ action }) }, session.access_token);
      await onRefresh();
    } catch (actionError) { setError(actionError.message || 'Unable to update booking.'); }
    finally { setBusyId(''); }
  };
  const raiseDispute = async (event, booking) => {
    event.preventDefault(); setBusyId(booking.id); setError('');
    try {
      await apiFetch(`/bookings/${booking.id}/disputes`, { method: 'POST', body: JSON.stringify({ details: disputeDetails }) }, session.access_token);
      setDisputeFormId(''); setDisputeDetails(''); await onRefresh();
    } catch (disputeError) { setError(disputeError.message || 'Unable to raise dispute.'); }
    finally { setBusyId(''); }
  };

  return (
    <div className="card rounded-2xl p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Reservations</p>
      <h3 className="mt-1 text-xl font-semibold text-white">{profile.role === 'manager' ? 'Property bookings' : profile.role === 'maintenance_staff' ? 'Amenity operations' : 'My bookings'}</h3>
      {error && <p className="mt-3 text-sm text-rose-200">{error}</p>}
      <div className="mt-5 space-y-3">
        {bookings.length === 0 ? <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">No bookings yet.</div> : bookings.map((booking) => (
          (() => {
            const timeState = getBookingTimeState(booking, profile.role, now);
            const showExpired = timeState.isExpired;
            const statusLabel = showExpired ? 'Expired' : booking.status === 'confirmed' && booking.checked_in_at ? 'Checked in' : booking.status.replace('_', ' ');
            return <div key={booking.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-medium text-white">{booking.amenity?.name || `Booking #${booking.id.slice(0, 8)}`}</p><p className="text-sm text-slate-300">{booking.property?.name || 'Property'}{profile.role !== 'tenant' && booking.user?.full_name ? ` · ${booking.user.full_name}` : ''}</p><p className="mt-1 text-sm text-slate-400">{booking.booking_date} · {formatTime(booking.check_in_time)}–{formatTime(booking.check_out_time)}</p></div><span className={`rounded-full px-2 py-1 text-xs uppercase ${showExpired ? 'bg-slate-700/70 text-slate-300' : 'bg-emerald-500/10 text-emerald-200'}`}>{statusLabel}</span></div>
            {(booking.checked_in_at || booking.checked_out_at) && <p className="mt-2 text-xs text-slate-400">{booking.checked_in_at && `Checked in ${formatDateTime(booking.checked_in_at, booking.property?.timezone)}`}{booking.checked_in_at && booking.checked_out_at && ' · '}{booking.checked_out_at && `Checked out ${formatDateTime(booking.checked_out_at, booking.property?.timezone)}`}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {timeState.canCheckIn && (profile.role !== 'maintenance_staff' || staffCapabilities.includes(booking.property_id)) && <button type="button" disabled={busyId === booking.id} onClick={() => handleAction(booking, 'check_in')} className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-200 disabled:opacity-50">Check in</button>}
              {timeState.canCheckOut && (profile.role !== 'maintenance_staff' || staffCapabilities.includes(booking.property_id)) && <button type="button" disabled={busyId === booking.id} onClick={() => handleAction(booking, 'check_out')} className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-200 disabled:opacity-50">Check out</button>}
              {timeState.canCancel && <button type="button" disabled={busyId === booking.id} onClick={() => handleAction(booking, 'cancel')} className="rounded-lg border border-rose-500/40 px-3 py-2 text-sm text-rose-200 disabled:opacity-50">Cancel booking</button>}
              {showExpired && <p className="self-center text-xs text-slate-400">This reservation has expired.</p>}

              {profile.role === 'tenant' && !booking.disputes?.some((dispute) => dispute.status === 'open') && <button type="button" onClick={() => setDisputeFormId(disputeFormId === booking.id ? '' : booking.id)} className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-100">Report a problem</button>}
              {booking.status === 'confirmed' && !timeState.hasStarted && !timeState.canCheckIn && <p className="self-center text-xs text-slate-400">Check-in is available during the reserved time.</p>}
            </div>
            {booking.disputes?.map((dispute) => <div key={dispute.id} className="mt-3 rounded-lg border border-slate-700 p-3"><p className="text-xs uppercase text-slate-400">Dispute · {dispute.status}</p><p className="mt-1 text-sm text-slate-200">{dispute.details}</p>{dispute.resolution && <p className="mt-2 text-sm text-emerald-200">Resolution: {dispute.resolution}</p>}</div>)}
            {disputeFormId === booking.id && <form onSubmit={(event) => raiseDispute(event, booking)} className="mt-3 space-y-2"><textarea required className="input min-h-20" value={disputeDetails} onChange={(event) => setDisputeDetails(event.target.value)} placeholder="Describe the booking issue" /><div className="flex gap-2"><button disabled={busyId === booking.id || !disputeDetails.trim()} className="rounded-lg bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-50">Submit dispute</button><button type="button" onClick={() => setDisputeFormId('')} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200">Dismiss</button></div></form>}
          </div>;
          })()
        ))}
      </div>
    </div>
  );
}
