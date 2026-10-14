import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';

export default function MyPropertyPage({ session }) {
  const [property, setProperty] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const loadProperty = async () => {
      try {
        const result = await apiFetch('/tenant/property', {}, session.access_token);
        if (!live) return;
        setProperty(result.property || null);
        setAssignment(result.assignment || null);
      } catch (loadError) {
        if (live) setError(loadError.message || 'Unable to load your property.');
      } finally {
        if (live) setLoading(false);
      }
    };
    void Promise.resolve().then(loadProperty);
    return () => { live = false; };
  }, [session.access_token]);

  if (loading) return <div className="card rounded-2xl p-5 text-sm text-slate-300">Loading your property...</div>;
  if (error || !property) return <div className="card rounded-2xl p-5 text-sm text-amber-200">{error || 'No active property assignment was found.'}</div>;

  return <div className="space-y-6">
    <section className="card rounded-2xl p-5"><p className="text-xs uppercase tracking-[0.2em] text-sky-300">Your residence</p><h3 className="mt-1 text-2xl font-semibold text-white">{property.name}</h3><p className="mt-2 text-slate-300">{property.address}</p>
      <dl className="mt-6 grid gap-4 border-t border-slate-800 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs uppercase text-slate-500">Unit</dt><dd className="mt-1 font-medium text-white">{property.unit?.unit_number || 'Not specified'}</dd></div>
        {property.unit && <><div><dt className="text-xs uppercase text-slate-500">Bedrooms</dt><dd className="mt-1 font-medium text-white">{property.unit.bedrooms}</dd></div><div><dt className="text-xs uppercase text-slate-500">Bathrooms</dt><dd className="mt-1 font-medium text-white">{property.unit.bathrooms}</dd></div></>}
        <div><dt className="text-xs uppercase text-slate-500">Property manager</dt><dd className="mt-1 font-medium text-white">{property.manager_name || 'Management team'}</dd></div>
      </dl>
    </section>
    <section className="card rounded-2xl p-5"><h3 className="text-lg font-semibold text-white">Lease</h3><div className="mt-4 grid gap-4 sm:grid-cols-3"><div><p className="text-xs uppercase text-slate-500">Start date</p><p className="mt-1 text-slate-200">{assignment?.lease_start || 'Not available'}</p></div><div><p className="text-xs uppercase text-slate-500">End date</p><p className="mt-1 text-slate-200">{assignment?.lease_end || 'Ongoing'}</p></div><div><p className="text-xs uppercase text-slate-500">Status</p><p className="mt-1 capitalize text-slate-200">{assignment?.status || 'Active'}</p></div></div></section>
  </div>;
}
