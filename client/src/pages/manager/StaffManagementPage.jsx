import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';

export default function StaffManagementPage({ session }) {
  const [properties, setProperties] = useState([]);
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState({ full_name: '', email: '', property_id: '', can_manage_bookings: false });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [propertyResponse, staffResponse] = await Promise.all([
      apiFetch('/manager/properties', {}, session.access_token),
      apiFetch('/manager/staff', {}, session.access_token),
    ]);
    setProperties(propertyResponse.properties || []);
    setStaff(staffResponse.staff || []);
    setForm((current) => ({ ...current, property_id: current.property_id || propertyResponse.properties?.[0]?.id || '' }));
  }, [session.access_token]);
  useEffect(() => { void Promise.resolve().then(refresh).catch((loadError) => setError(loadError.message)); }, [refresh]);

  const invite = async (event) => {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      await apiFetch('/manager/staff', { method: 'POST', body: JSON.stringify(form) }, session.access_token);
      setMessage('Staff invitation sent. They will receive an email to finish account setup.');
      setForm((current) => ({ ...current, full_name: '', email: '' }));
      await refresh();
    } catch (inviteError) { setError(inviteError.message || 'Unable to invite staff.'); }
    finally { setBusy(false); }
  };

  const toggleBookingPermission = async (member, propertyId, enabled) => {
    try {
      await apiFetch(`/manager/staff/${member.id}/permissions`, { method: 'PATCH', body: JSON.stringify({ property_id: propertyId, can_manage_bookings: enabled }) }, session.access_token);
      await refresh();
    } catch (permissionError) { setError(permissionError.message || 'Unable to update staff permission.'); }
  };

  const removeFromProperty = async (member, propertyId) => {
    try {
      await apiFetch(`/manager/staff/${member.id}/properties/${propertyId}`, { method: 'DELETE' }, session.access_token);
      await refresh();
    } catch (removeError) { setError(removeError.message || 'Unable to remove staff from property.'); }
  };

  return <div className="space-y-6"><section className="card rounded-2xl p-5"><p className="text-xs uppercase tracking-[0.2em] text-sky-300">Team</p><h3 className="mt-1 text-xl font-semibold text-white">Invite maintenance staff</h3><form onSubmit={invite} className="mt-5 grid gap-4 md:grid-cols-3"><label className="text-sm text-slate-300">Full name<input required className="input mt-1" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} /></label><label className="text-sm text-slate-300">Email<input required type="email" className="input mt-1" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label><label className="text-sm text-slate-300">Property<select required className="input mt-1" value={form.property_id} onChange={(event) => setForm((current) => ({ ...current, property_id: event.target.value }))}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label><label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.can_manage_bookings} onChange={(event) => setForm((current) => ({ ...current, can_manage_bookings: event.target.checked }))} />Can check in/out amenity bookings at this property</label><button disabled={busy || !properties.length} className="rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white disabled:opacity-50">{busy ? 'Sending...' : 'Send invitation'}</button></form>{message && <p className="mt-3 text-sm text-emerald-200">{message}</p>}{error && <p className="mt-3 text-sm text-rose-200">{error}</p>}</section><section className="card rounded-2xl p-5"><h3 className="text-lg font-semibold text-white">Property staff</h3><div className="mt-4 divide-y divide-slate-800">{staff.length ? staff.map((member) => <div key={member.id} className="py-3"><p className="font-medium text-white">{member.full_name}</p><p className="text-sm text-slate-400">{member.email || 'Invitation pending'}</p><div className="mt-2 flex flex-wrap gap-4">{(member.property_ids || []).map((id) => <div key={id} className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={(member.booking_permission_property_ids || []).includes(id)} onChange={(event) => void toggleBookingPermission(member, id, event.target.checked)} />{properties.find((property) => property.id === id)?.name || 'Property'}: booking desk</label><button type="button" onClick={() => void removeFromProperty(member, id)} className="text-xs text-rose-200">Remove</button></div>)}</div></div>) : <p className="py-4 text-sm text-slate-400">No staff members yet.</p>}</div></section></div>;
}
