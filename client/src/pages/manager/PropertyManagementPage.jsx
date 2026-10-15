import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';

export default function PropertyManagementPage({ session }) {
  const [properties, setProperties] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [units, setUnits] = useState([]);
  const [form, setForm] = useState({ name: '', address: '' });
  const [unitForm, setUnitForm] = useState({ unit_number: '', bedrooms: 0, bathrooms: 1 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = properties.find((property) => property.id === selectedId);

  const loadProperties = useCallback(async () => {
    const response = await apiFetch('/manager/properties', {}, session.access_token);
    setProperties(response.properties || []);
    if (!selectedId && response.properties?.length) setSelectedId(response.properties[0].id);
  }, [selectedId, session.access_token]);

  const loadUnits = useCallback(async (propertyId) => {
    if (!propertyId) return setUnits([]);
    try {
      const response = await apiFetch(`/manager/properties/${propertyId}/units`, {}, session.access_token);
      const loadedUnits = response.units || [];
      setUnits(loadedUnits);
      setProperties((current) => current.map((property) => property.id === propertyId
        ? {
            ...property,
            unit_count: loadedUnits.length,
            active_unit_count: loadedUnits.filter((unit) => unit.is_active).length,
          }
        : property));
    } catch (loadError) {
      setError(loadError.message || 'Could not load units. Run the workflow migration first.');
    }
  }, [session.access_token]);

  useEffect(() => {
    void Promise.resolve().then(loadProperties).catch((loadError) => setError(loadError.message || 'Unable to load properties.'));
  }, [loadProperties]);

  useEffect(() => {
    void Promise.resolve().then(() => loadUnits(selectedId));
  }, [loadUnits, selectedId]);

  const handleCreateProperty = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await apiFetch('/properties', { method: 'POST', body: JSON.stringify(form) }, session.access_token);
      setProperties((current) => [response.property, ...current]);
      setSelectedId(response.property.id);
      setForm({ name: '', address: '' });
      setMessage('Property added.');
    } catch (submitError) { setError(submitError.message || 'Unable to add property.'); }
    finally { setBusy(false); }
  };

  const handleSaveSettings = async (settings) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await apiFetch(`/manager/properties/${selectedId}`, { method: 'PATCH', body: JSON.stringify({ ...settings, booking_cancellation_hours: Number(settings.booking_cancellation_hours) }) }, session.access_token);
      setProperties((current) => current.map((property) => property.id === selectedId ? response.property : property));
      setMessage('Property settings saved.');
    } catch (saveError) { setError(saveError.message || 'Unable to save settings.'); }
    finally { setBusy(false); }
  };

  const handleCreateUnit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      await apiFetch(`/manager/properties/${selectedId}/units`, { method: 'POST', body: JSON.stringify({ ...unitForm, bedrooms: Number(unitForm.bedrooms), bathrooms: Number(unitForm.bathrooms) }) }, session.access_token);
      await loadUnits(selectedId);
      setUnitForm({ unit_number: '', bedrooms: 0, bathrooms: 1 });
      setMessage('Unit added.');
    } catch (unitError) { setError(unitError.message || 'Unable to add unit.'); }
    finally { setBusy(false); }
  };

  const toggleUnit = async (unit) => {
    try {
      await apiFetch(`/manager/units/${unit.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !unit.is_active }) }, session.access_token);
      await loadUnits(selectedId);
    } catch (unitError) { setError(unitError.message || 'Unable to update unit.'); }
  };

  return (
    <div className="space-y-6">
      <section className="card rounded-2xl p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Portfolio</p><h3 className="mt-1 text-xl font-semibold text-white">Properties and units</h3>
        <form onSubmit={handleCreateProperty} className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input required className="input" placeholder="Property name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          <input required className="input" placeholder="Street address" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
          <button disabled={busy} className="rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white disabled:opacity-50">Add property</button>
        </form>
        <div className="mt-5"><label className="mb-1 block text-sm text-slate-300">Manage property</label><select className="input" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name} · {property.address} · {property.active_unit_count ?? property.unit_count ?? 0} active units</option>)}</select></div>
        {message && <p className="mt-4 text-sm text-emerald-200">{message}</p>}{error && <p className="mt-4 text-sm text-rose-200">{error}</p>}
      </section>
      {selected && <>
        <section className="card rounded-2xl p-5">
          <h3 className="text-lg font-semibold text-white">Property settings</h3>
          <PropertySettingsForm key={selected.id} property={selected} busy={busy} onSave={handleSaveSettings} />
        </section>
        <section className="card rounded-2xl p-5">
          <h3 className="text-lg font-semibold text-white">Units <span className="ml-2 text-sm font-normal text-slate-400">{units.filter((unit) => unit.is_active).length} active · {units.length} total</span></h3>
          <form onSubmit={handleCreateUnit} className="mt-4 grid gap-3 sm:grid-cols-4">
            <input required className="input" placeholder="Unit or apartment number" value={unitForm.unit_number} onChange={(event) => setUnitForm((current) => ({ ...current, unit_number: event.target.value }))} />
            <label className="text-sm text-slate-300">Bedrooms<input type="number" min="0" className="input mt-1" value={unitForm.bedrooms} onChange={(event) => setUnitForm((current) => ({ ...current, bedrooms: event.target.value }))} /></label>
            <label className="text-sm text-slate-300">Bathrooms<input type="number" min="0" step="0.5" className="input mt-1" value={unitForm.bathrooms} onChange={(event) => setUnitForm((current) => ({ ...current, bathrooms: event.target.value }))} /></label>
            <button disabled={busy} className="self-end rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white disabled:opacity-50">Add unit</button>
          </form>
          <div className="mt-4 divide-y divide-slate-800">{units.length ? units.map((unit) => <div key={unit.id} className="flex flex-wrap items-center justify-between gap-4 py-3"><div><p className="font-medium text-white">Unit {unit.unit_number}</p><p className="text-sm text-slate-400">{unit.bedrooms} bedrooms · {unit.bathrooms} bathrooms</p></div><button type="button" onClick={() => toggleUnit(unit)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200">{unit.is_active ? 'Deactivate' : 'Activate'}</button></div>) : <p className="py-4 text-sm text-slate-400">No units added yet.</p>}</div>
        </section>
      </>}
    </div>
  );
}

function PropertySettingsForm({ property, busy, onSave }) {
  const [settings, setSettings] = useState({ name: property.name, address: property.address, timezone: property.timezone || 'UTC', booking_cancellation_hours: property.booking_cancellation_hours ?? 24 });
  const submit = (event) => { event.preventDefault(); onSave(settings); };
  return <form onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-2">
    <div><label className="mb-1 block text-sm text-slate-300">Name</label><input required className="input" value={settings.name} onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} /></div>
    <div><label className="mb-1 block text-sm text-slate-300">Address</label><input required className="input" value={settings.address} onChange={(event) => setSettings((current) => ({ ...current, address: event.target.value }))} /></div>
    <div><label className="mb-1 block text-sm text-slate-300">Tenant cancellation cutoff (hours)</label><input type="number" min="0" className="input" value={settings.booking_cancellation_hours} onChange={(event) => setSettings((current) => ({ ...current, booking_cancellation_hours: event.target.value }))} /></div>
    <div><label className="mb-1 block text-sm text-slate-300">Property timezone</label><input required className="input" value={settings.timezone} placeholder="Asia/Kolkata" onChange={(event) => setSettings((current) => ({ ...current, timezone: event.target.value }))} /></div>
    <div className="flex items-end"><button disabled={busy} className="rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white disabled:opacity-50">Save settings</button></div>
  </form>;
}
