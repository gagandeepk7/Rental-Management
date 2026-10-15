import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';

const emptyForm = { property_id: '', name: '', description: '', opening_time: '09:00', closing_time: '21:00', slot_duration_minutes: 60, is_active: true };

export default function AmenityManagementPage({ session }) {
  const [properties, setProperties] = useState([]);
  const [amenities, setAmenities] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [propertyResponse, amenityResponse] = await Promise.all([
      apiFetch('/manager/properties', {}, session.access_token),
      apiFetch('/amenities', {}, session.access_token),
    ]);
    setProperties(propertyResponse.properties || []);
    setAmenities(amenityResponse.amenities || []);
    setForm((current) => ({ ...current, property_id: current.property_id || propertyResponse.properties?.[0]?.id || '' }));
  }, [session.access_token]);

  useEffect(() => { void Promise.resolve().then(refresh).catch((loadError) => setError(loadError.message)); }, [refresh]);

  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const payload = { ...form, slot_duration_minutes: Number(form.slot_duration_minutes) };
    try {
      await apiFetch(editingId ? `/amenities/${editingId}` : '/amenities', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) }, session.access_token);
      setMessage(editingId ? 'Amenity updated.' : 'Amenity added.'); setEditingId(''); setForm({ ...emptyForm, property_id: form.property_id }); await refresh();
    } catch (submitError) { setError(submitError.message || 'Unable to save amenity.'); }
    finally { setBusy(false); }
  };

  const edit = (amenity) => {
    setEditingId(amenity.id);
    setForm({ property_id: amenity.property_id, name: amenity.name, description: amenity.description || '', opening_time: amenity.opening_time?.slice(0, 5) || '09:00', closing_time: amenity.closing_time?.slice(0, 5) || '21:00', slot_duration_minutes: amenity.slot_duration_minutes || 60, is_active: amenity.is_active });
  };

  return <div className="space-y-6">
    <section className="card rounded-2xl p-5"><p className="text-xs uppercase tracking-[0.2em] text-sky-300">Facilities</p><h3 className="mt-1 text-xl font-semibold text-white">Manage amenities</h3>
      <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-sm text-slate-300">Property<select required className="input mt-1" value={form.property_id} onChange={(event) => setForm((current) => ({ ...current, property_id: event.target.value }))}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
        <label className="text-sm text-slate-300">Amenity name<input required className="input mt-1" placeholder="Gym, pool, community hall" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="text-sm text-slate-300 md:col-span-2">Description<input className="input mt-1" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
        <label className="text-sm text-slate-300">Opens<input required type="time" className="input mt-1" value={form.opening_time} onChange={(event) => setForm((current) => ({ ...current, opening_time: event.target.value }))} /></label>
        <label className="text-sm text-slate-300">Closes<input required type="time" className="input mt-1" value={form.closing_time} onChange={(event) => setForm((current) => ({ ...current, closing_time: event.target.value }))} /></label>
        <label className="text-sm text-slate-300">Slot duration (minutes)<input required type="number" min="30" step="15" className="input mt-1" value={form.slot_duration_minutes} onChange={(event) => setForm((current) => ({ ...current, slot_duration_minutes: event.target.value }))} /></label>
        {editingId && <label className="flex items-center gap-2 self-end text-sm text-slate-300"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />Available for booking</label>}
        <div className="flex gap-2 md:col-span-2"><button disabled={busy || !properties.length} className="rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white disabled:opacity-50">{busy ? 'Saving...' : editingId ? 'Save amenity' : 'Add amenity'}</button>{editingId && <button type="button" onClick={() => { setEditingId(''); setForm({ ...emptyForm, property_id: form.property_id }); }} className="rounded-xl border border-slate-700 px-4 py-2.5 text-slate-200">Cancel edit</button>}</div>
      </form>{message && <p className="mt-3 text-sm text-emerald-200">{message}</p>}{error && <p className="mt-3 text-sm text-rose-200">{error}</p>}
    </section>
    <section className="card rounded-2xl p-5"><h3 className="text-lg font-semibold text-white">Current amenities</h3><div className="mt-4 divide-y divide-slate-800">{amenities.length ? amenities.map((amenity) => <div key={amenity.id} className="flex flex-wrap items-center justify-between gap-4 py-3"><div><p className="font-medium text-white">{amenity.name} · {properties.find((property) => property.id === amenity.property_id)?.name || 'Property'}</p><p className="text-sm text-slate-400">{amenity.opening_time?.slice(0, 5)}–{amenity.closing_time?.slice(0, 5)} · {amenity.slot_duration_minutes} min · {amenity.is_active ? 'Active' : 'Inactive'}</p></div><button type="button" onClick={() => edit(amenity)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200">Edit</button></div>) : <p className="py-4 text-sm text-slate-400">No amenities configured.</p>}</div></section>
  </div>;
}
