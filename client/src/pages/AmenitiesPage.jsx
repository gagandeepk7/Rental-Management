import { useRef, useState } from 'react';
import { useEffect } from 'react';
import { apiFetch } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';

function minutes(time) {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function timeValue(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export default function AmenitiesPage({ session, amenities, properties, onRefresh }) {
  const [form, setForm] = useState({ amenity_id: '', property_id: '', booking_date: new Date().toISOString().slice(0, 10), check_in_time: '', check_out_time: '' });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [availability, setAvailability] = useState([]);
  const [localNow, setLocalNow] = useState(null);
  const [availabilityKey, setAvailabilityKey] = useState('');
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityRefresh, setAvailabilityRefresh] = useState(0);
  const submissionLock = useRef(false);
  const selectedPropertyAmenities = amenities.filter((amenity) => amenity.property_id === form.property_id && amenity.is_active);
  const selectedAmenity = selectedPropertyAmenities.find((amenity) => amenity.id === form.amenity_id);
  const slotMinutes = Number(selectedAmenity?.slot_duration_minutes) || 60;
  const openingMinutes = selectedAmenity ? minutes(selectedAmenity.opening_time.slice(0, 5)) : 0;
  const closingMinutes = selectedAmenity ? minutes(selectedAmenity.closing_time.slice(0, 5)) : 0;
  const currentAvailability = availabilityKey === `${form.amenity_id}:${form.booking_date}` ? availability : [];
  const availableStartTimes = [];
  if (selectedAmenity) {
    for (let start = openingMinutes; start + slotMinutes <= closingMinutes; start += slotMinutes) {
      const end = start + slotMinutes;
      const occupied = currentAvailability.some((booking) => start < minutes(booking.check_out_time.slice(0, 5)) && minutes(booking.check_in_time.slice(0, 5)) < end);
      const started = localNow && (form.booking_date < localNow.date || (form.booking_date === localNow.date && start <= localNow.minutes));
      if (!occupied && !started) availableStartTimes.push(timeValue(start));
    }
  }

  useEffect(() => {
    if (!form.amenity_id) return;
    const refresh = () => setAvailabilityRefresh((current) => current + 1);
    const channel = supabase.channel(`availability-${form.amenity_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'amenity_bookings', filter: `amenity_id=eq.${form.amenity_id}` }, refresh)
      .subscribe();
    // Other tenants' reservations are private under RLS. Poll the sanitized
    // availability endpoint too, so their bookings still remove occupied slots.
    const timer = setInterval(refresh, 15000);
    return () => { clearInterval(timer); void supabase.removeChannel(channel); };
  }, [form.amenity_id]);

  useEffect(() => {
    let active = true;
    if (!form.amenity_id || !form.booking_date) {
      return () => { active = false; };
    }
    const loadAvailability = async () => {
      setLoadingAvailability(true);
      setAvailabilityError('');
      try {
        const result = await apiFetch(`/amenities/${form.amenity_id}/availability?date=${form.booking_date}`, {}, session.access_token);
        if (active) {
          setAvailability(result.slots || []);
          setLocalNow(result.local_now || null);
          setAvailabilityKey(`${form.amenity_id}:${form.booking_date}`);
        }
      } catch {
        if (active) {
          setAvailability([]);
          setAvailabilityError('Could not check slot availability. Refresh and try again.');
        }
      } finally {
        if (active) setLoadingAvailability(false);
      }
    };
    void Promise.resolve().then(loadAvailability);
    return () => { active = false; };
  }, [availabilityRefresh, form.amenity_id, form.booking_date, session.access_token]);

  const handleBooking = async (event) => {
    event.preventDefault();
    if (submissionLock.current) return;

    submissionLock.current = true;
    setSubmitting(true);
    setError('');
    setStatus('');
    try {
      const response = await apiFetch('/bookings', { method: 'POST', body: JSON.stringify(form) }, session.access_token);
      setStatus(response.booking ? 'Booking confirmed.' : 'Booking created.');
      setForm((current) => ({ ...current, check_in_time: '', check_out_time: '' }));
      setAvailabilityRefresh((current) => current + 1);
      await onRefresh?.();
    } catch (submitError) {
      setError(submitError.message || 'Booking could not be created.');
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="card rounded-2xl p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Facilities</p><h3 className="mt-1 text-xl font-semibold text-white">Amenity directory</h3>
        <div className="mt-5 space-y-3">{amenities.length === 0 ? <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">No amenities available yet.</div> : amenities.map((amenity) => <div key={amenity.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><div className="flex items-center justify-between gap-3"><div><h4 className="font-semibold text-white">{amenity.name}</h4><p className="text-sm text-slate-400">{amenity.description || 'Amenity available for booking.'}</p></div><span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${amenity.is_active ? 'bg-emerald-500/10 text-emerald-200' : 'bg-slate-700 text-slate-300'}`}>{amenity.is_active ? 'Active' : 'Inactive'}</span></div><p className="mt-3 text-xs text-slate-400">Hours: {amenity.opening_time || '09:00'} - {amenity.closing_time || '21:00'}</p></div>)}</div>
      </section>
      <section className="card rounded-2xl p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Book now</p><h3 className="mt-1 text-xl font-semibold text-white">Reserve a slot</h3>
        <form onSubmit={handleBooking} className="mt-5 space-y-4">
          <div><label className="mb-1 block text-sm text-slate-300">Property</label><select required className="input" value={form.property_id} disabled={submitting} onChange={(event) => setForm((current) => ({ ...current, property_id: event.target.value, amenity_id: '', check_in_time: '', check_out_time: '' }))}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name} · {property.address}</option>)}</select>{properties.length === 0 && <p className="mt-1 text-xs text-amber-200">No linked properties are available for booking.</p>}</div>
          <div><label className="mb-1 block text-sm text-slate-300">Amenity</label><select required className="input" value={form.amenity_id} onChange={(event) => setForm((current) => ({ ...current, amenity_id: event.target.value, check_in_time: '', check_out_time: '' }))} disabled={!form.property_id || submitting}><option value="">Select amenity</option>{selectedPropertyAmenities.map((amenity) => <option key={amenity.id} value={amenity.id}>{amenity.name}</option>)}</select>{form.property_id && selectedPropertyAmenities.length === 0 && <p className="mt-1 text-xs text-slate-400">No active amenities are available at this property.</p>}</div>
          <div><label className="mb-1 block text-sm text-slate-300">Booking date</label><input required type="date" className="input" value={form.booking_date} disabled={submitting} onChange={(event) => setForm((current) => ({ ...current, booking_date: event.target.value, check_in_time: '', check_out_time: '' }))} /></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1 block text-sm text-slate-300">Available check-in</label><select required className="input" value={form.check_in_time} disabled={!selectedAmenity || submitting || loadingAvailability} onChange={(event) => setForm((current) => ({ ...current, check_in_time: event.target.value, check_out_time: event.target.value ? timeValue(minutes(event.target.value) + slotMinutes) : '' }))}><option value="">{loadingAvailability ? 'Checking slots...' : 'Select time'}</option>{availableStartTimes.map((time) => <option key={time} value={time}>{time}</option>)}</select></div><div><label className="mb-1 block text-sm text-slate-300">Check-out</label><input type="time" className="input" value={form.check_out_time} readOnly /></div></div>
          {selectedAmenity && !loadingAvailability && availableStartTimes.length === 0 && <p className="text-sm text-amber-200">No available slots for this amenity on the selected date.</p>}
          {availabilityError && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{availabilityError}</div>}
          {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}{status && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{status}</div>}
          <button type="submit" className="w-full rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50" disabled={submitting || loadingAvailability || Boolean(availabilityError) || !form.property_id || !form.amenity_id || !form.check_in_time}>{submitting ? 'Booking...' : 'Confirm booking'}</button>
        </form>
      </section>
    </div>
  );
}
