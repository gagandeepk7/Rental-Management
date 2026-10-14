import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';

export default function TenantManagementPage({ session }) {
  const [tenants, setTenants] = useState([]);
  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [inviteForm, setInviteForm] = useState({ full_name: '', email: '', property_id: '', unit_id: '', lease_start: new Date().toISOString().slice(0, 10), lease_end: '' });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ tenant_id: '', property_id: '', lease_start: new Date().toISOString().slice(0, 10), lease_end: '', status: 'active' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const refreshData = useCallback(async () => {
    try {
      const [tenantResponse, propertyResponse, assignmentResponse] = await Promise.all([
        apiFetch('/manager/tenants', { method: 'GET' }, session.access_token),
        apiFetch('/manager/properties', { method: 'GET' }, session.access_token),
        apiFetch('/manager/assignments', { method: 'GET' }, session.access_token),
      ]);
      setTenants(tenantResponse.tenants || []);
      setProperties(propertyResponse.properties || []);
      setAssignments(assignmentResponse.assignments || []);
      if (!inviteForm.property_id && propertyResponse.properties?.length) {
        setInviteForm((current) => ({ ...current, property_id: propertyResponse.properties[0].id }));
      }
      setErrorMessage('');
    } catch (fetchError) {
      setErrorMessage(fetchError.message || 'Unable to load tenant assignments.');
    } finally {
      setLoading(false);
    }
  }, [session.access_token, inviteForm.property_id]);

  useEffect(() => {
    void Promise.resolve().then(refreshData);
  }, [refreshData]);

  const filteredTenants = tenants.filter((tenant) => {
    const query = search.trim().toLowerCase();
    return !query || tenant.full_name?.toLowerCase().includes(query) || tenant.email?.toLowerCase().includes(query);
  });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setStatusMessage('');
    setErrorMessage('');
    try {
      await apiFetch('/tenant-assignments', { method: 'POST', body: JSON.stringify(form) }, session.access_token);
      setStatusMessage('Tenant assigned successfully.');
      setForm({ tenant_id: '', property_id: '', lease_start: new Date().toISOString().slice(0, 10), lease_end: '', status: 'active' });
      await refreshData();
    } catch (submitError) {
      setErrorMessage(submitError.message || 'Unable to assign the tenant.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInvite = async (event) => {
    event.preventDefault();
    setSubmitting(true); setStatusMessage(''); setErrorMessage('');
    try {
      await apiFetch('/manager/tenants/invite', { method: 'POST', body: JSON.stringify(inviteForm) }, session.access_token);
      setStatusMessage('Invitation sent and tenant assigned.');
      setInviteForm((current) => ({ ...current, full_name: '', email: '', unit_id: '' }));
      await refreshData();
    } catch (inviteError) { setErrorMessage(inviteError.message || 'Unable to invite tenant.'); }
    finally { setSubmitting(false); }
  };

  const loadUnits = async (propertyId) => {
    setUnits([]);
    setForm((current) => ({ ...current, property_id: propertyId, unit_id: '' }));
    setInviteForm((current) => ({ ...current, property_id: propertyId, unit_id: '' }));
    if (!propertyId) return;
    try {
      const response = await apiFetch(`/manager/properties/${propertyId}/units`, {}, session.access_token);
      setUnits((response.units || []).filter((unit) => unit.is_active));
    } catch (loadError) { setErrorMessage(loadError.message || 'Unable to load units.'); }
  };

  const handleEndAssignment = async (assignmentId) => {
    try {
      await apiFetch(`/tenant-assignments/${assignmentId}`, { method: 'PATCH', body: JSON.stringify({ status: 'ended', lease_end: new Date().toISOString().slice(0, 10) }) }, session.access_token);
      setStatusMessage('Assignment ended successfully.');
      await refreshData();
    } catch (endError) {
      setErrorMessage(endError.message || 'Unable to end the assignment.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="card rounded-2xl p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-sky-300">New resident</p>
        <h3 className="mt-1 text-xl font-semibold text-white">Invite and assign a tenant</h3>
        <form onSubmit={handleInvite} className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-300">Full name<input required className="input mt-1" value={inviteForm.full_name} onChange={(event) => setInviteForm((current) => ({ ...current, full_name: event.target.value }))} /></label>
          <label className="text-sm text-slate-300">Email<input required type="email" className="input mt-1" value={inviteForm.email} onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))} /></label>
          <label className="text-sm text-slate-300">Property<select required className="input mt-1" value={inviteForm.property_id} onChange={(event) => void loadUnits(event.target.value)}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
          <label className="text-sm text-slate-300">Unit<select className="input mt-1" value={inviteForm.unit_id} onChange={(event) => setInviteForm((current) => ({ ...current, unit_id: event.target.value }))}><option value="">No unit selected</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}</select></label>
          <label className="text-sm text-slate-300">Lease start<input required type="date" className="input mt-1" value={inviteForm.lease_start} onChange={(event) => setInviteForm((current) => ({ ...current, lease_start: event.target.value }))} /></label>
          <label className="text-sm text-slate-300">Lease end<input type="date" className="input mt-1" value={inviteForm.lease_end} onChange={(event) => setInviteForm((current) => ({ ...current, lease_end: event.target.value }))} /></label>
          <button type="submit" disabled={submitting || loading || !properties.length} className="rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white disabled:opacity-50">{submitting ? 'Sending...' : 'Invite and assign'}</button>
        </form>
      </section>
      <section className="card rounded-2xl p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Tenant management</p>
        <h3 className="mt-1 text-xl font-semibold text-white">Assign a tenant to a property</h3>
        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
          <div><label className="mb-1 block text-sm text-slate-300">Tenant</label><select required className="input" value={form.tenant_id} onChange={(event) => setForm((current) => ({ ...current, tenant_id: event.target.value }))}><option value="">Select tenant</option>{filteredTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.full_name} ({tenant.email || 'No email'})</option>)}</select></div>
          <div><label className="mb-1 block text-sm text-slate-300">Property</label><select required className="input" value={form.property_id} onChange={(event) => void loadUnits(event.target.value)}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></div>
          <div><label className="mb-1 block text-sm text-slate-300">Unit</label><select className="input" value={form.unit_id || ''} onChange={(event) => setForm((current) => ({ ...current, unit_id: event.target.value }))}><option value="">No unit selected</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}</select></div>
          <div><label className="mb-1 block text-sm text-slate-300">Lease start</label><input required type="date" className="input" value={form.lease_start} onChange={(event) => setForm((current) => ({ ...current, lease_start: event.target.value }))} /></div>
          <div><label className="mb-1 block text-sm text-slate-300">Lease end</label><input type="date" className="input" value={form.lease_end} onChange={(event) => setForm((current) => ({ ...current, lease_end: event.target.value }))} /></div>
          <div className="md:col-span-2"><label className="mb-1 block text-sm text-slate-300">Status</label><select className="input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="active">Active</option><option value="pending">Pending</option></select></div>
          <div className="md:col-span-2 flex gap-3"><input className="input flex-1" placeholder="Search by tenant name or email" value={search} onChange={(event) => setSearch(event.target.value)} /><button type="submit" className="rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white hover:bg-sky-500 disabled:opacity-60" disabled={submitting || loading || !properties.length}>{submitting ? 'Saving...' : 'Assign tenant'}</button></div>
        </form>
        {!loading && properties.length === 0 && <p className="mt-3 text-sm text-amber-200">Add a property to your manager account before assigning tenants.</p>}
        {statusMessage && <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{statusMessage}</div>}
        {errorMessage && <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{errorMessage}</div>}
      </section>
      <section className="card rounded-2xl p-5">
        <h3 className="mb-4 text-lg font-semibold text-white">Rental assignments</h3>
        {loading ? <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">Loading assignments...</div> : assignments.length === 0 ? <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">No rental assignments yet.</div> : (
          <div className="space-y-3">{assignments.map((assignment) => <div key={assignment.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div><p className="font-medium text-white">{assignment.tenant?.full_name || 'Tenant'} · {assignment.property?.name || 'Property'}</p><p className="text-sm text-slate-400">{assignment.property?.address || 'Address unavailable'}{assignment.unit ? ` · Unit ${assignment.unit.unit_number}` : ''} · {assignment.lease_start} to {assignment.lease_end || 'Ongoing'}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-200">{assignment.status}</span>{assignment.status !== 'ended' && <button type="button" onClick={() => handleEndAssignment(assignment.id)} className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800">End lease</button>}</div></div></div>)}</div>
        )}
      </section>
    </div>
  );
}
