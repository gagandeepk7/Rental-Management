import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { supabase } from '../../lib/supabase.js';

async function attachPhotos(requestId, photos, token) {
  const uploaded = [];
  for (const file of photos) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectPath = `${requestId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from('maintenance-photos').upload(objectPath, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    uploaded.push({ object_path: objectPath, file_name: file.name, content_type: file.type });
  }
  await apiFetch(`/maintenance/${requestId}/photos`, { method: 'POST', body: JSON.stringify({ photos: uploaded }) }, token);
}

function validPhotos(photos, remaining = 5) {
  return photos.length > 0 && photos.length <= remaining && photos.every((file) =>
    ['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(file.type) && file.size > 0 && file.size <= 10 * 1024 * 1024);
}

export function MaintenancePage({ maintenance, profile, session, staff, onRefresh }) {
  return (
    <div className="card rounded-2xl p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Operations</p>
          <h3 className="mt-1 text-xl font-semibold text-white">Maintenance requests</h3>
        </div>
        {profile?.role === 'tenant' && (
          <Link to="/maintenance/new" className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500">
            <ArrowRight className="h-4 w-4" /> New request
          </Link>
        )}
      </div>
      <div className="space-y-3">
        {maintenance.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">No maintenance requests found.</div>
        ) : maintenance.map((request) => (
            <MaintenanceRequestCard key={request.id} request={request} profile={profile} session={session} staff={staff} onRefresh={onRefresh} />
        ))}
      </div>
    </div>
  );
}

function MaintenanceRequestCard({ request, profile, session, staff, onRefresh }) {
  const isManager = profile?.role === 'manager';
  const canWork = isManager || (profile?.role === 'maintenance_staff' && request.assigned_to === session.user?.id);
  const [comments, setComments] = useState([]);
  const [comment, setComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState(request.resolution_notes || '');
  const [staffId, setStaffId] = useState(request.assigned_to || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadComments = useCallback(async () => {
    try {
      const response = await apiFetch(`/maintenance/${request.id}/comments`, {}, session.access_token);
      setComments(response.comments || []);
    } catch (loadError) { setError(loadError.message || 'Unable to load request updates.'); }
  }, [request.id, session.access_token]);

  useEffect(() => {
    void Promise.resolve().then(loadComments);
    const channel = supabase.channel(`request-comments-${request.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_comments', filter: `request_id=eq.${request.id}` }, () => void loadComments())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadComments, request.id]);

  const uploadPhotos = async (event) => {
    const photos = Array.from(event.target.files || []);
    event.target.value = '';
    if (!photos.length) return;
    if (!validPhotos(photos, 5 - (request.photos?.length || 0))) {
      setError('Choose supported images up to 10 MB each, with at most five photos per request.');
      return;
    }
    setBusy(true); setError('');
    try { await attachPhotos(request.id, photos, session.access_token); await onRefresh(); }
    catch (uploadError) { setError(uploadError.message || 'Unable to attach photos.'); }
    finally { setBusy(false); }
  };

  const postComment = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await apiFetch(`/maintenance/${request.id}/comments`, { method: 'POST', body: JSON.stringify({ body: comment, is_internal: isInternal }) }, session.access_token);
      setComment(''); await loadComments(); await onRefresh();
    } catch (submitError) { setError(submitError.message || 'Unable to post update.'); }
    finally { setBusy(false); }
  };

  const updateStatus = async (status) => {
    setBusy(true); setError('');
    try {
      await apiFetch(`/maintenance/${request.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, resolution_notes: resolutionNotes }) }, session.access_token);
      await onRefresh(); await loadComments();
    } catch (updateError) { setError(updateError.message || 'Unable to update task.'); }
    finally { setBusy(false); }
  };

  const assignStaff = async (event) => {
    const nextStaffId = event.target.value;
    setStaffId(nextStaffId); setBusy(true); setError('');
    try {
      await apiFetch(`/manager/maintenance/${request.id}/assignment`, { method: 'PATCH', body: JSON.stringify({ staff_id: nextStaffId || null }) }, session.access_token);
      await onRefresh();
    } catch (assignError) { setError(assignError.message || 'Unable to assign staff.'); }
    finally { setBusy(false); }
  };

  return <article className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0"><h4 className="font-semibold text-white">{request.title}</h4><p className="mt-1 text-sm text-slate-300">{request.description}</p><p className="mt-2 text-xs text-slate-400">{request.property?.name || 'Property'} · {request.property?.address || ''}{request.unit?.unit_number ? ` · Unit ${request.unit.unit_number}` : ''}{isManager && request.tenant?.full_name ? ` · ${request.tenant.full_name}` : ''}</p></div>
      <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200">{request.status.replace('_', ' ')}</span><span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200">{request.priority}</span></div>
    </div>
    {request.photos?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{request.photos.map((photo) => photo.url && <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.file_name} className="h-20 w-20 rounded-lg border border-slate-700 object-cover" /></a>)}</div>}
    {(request.photos?.length || 0) < 5 && <label className="mt-3 block text-sm text-slate-300">Attach issue photos<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple disabled={busy} className="input mt-1" onChange={uploadPhotos} /></label>}
    {request.resolution_notes && <p className="mt-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-100"><strong>Resolution:</strong> {request.resolution_notes}</p>}
    {(isManager || profile?.role === 'maintenance_staff') && <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-800 pt-4">
      {isManager && <label className="min-w-52 flex-1 text-sm text-slate-300">Assigned staff<select className="input mt-1" value={staffId} onChange={assignStaff} disabled={busy}><option value="">Unassigned</option>{staff.filter((member) => member.property_ids?.includes(request.property_id)).map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label>}
      {canWork && request.status === 'pending' && <button type="button" onClick={() => updateStatus('in_progress')} disabled={busy} className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-200 disabled:opacity-50">Start task</button>}
      {canWork && request.status !== 'completed' && <label className="min-w-52 flex-1 text-sm text-slate-300">Resolution notes<textarea className="input mt-1 min-h-16" value={resolutionNotes} onChange={(event) => setResolutionNotes(event.target.value)} placeholder="Required to complete this task" /></label>}
      {canWork && request.status !== 'completed' && <button type="button" onClick={() => updateStatus('completed')} disabled={busy || !resolutionNotes.trim()} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Mark completed</button>}
    </div>}
    <div className="mt-4 border-t border-slate-800 pt-4"><h5 className="text-sm font-semibold text-white">Updates</h5><div className="mt-2 space-y-2">{comments.map((item) => <div key={item.id} className="rounded-lg bg-slate-900 px-3 py-2"><p className="text-xs text-sky-200">{item.author?.full_name || 'User'}{item.is_internal ? ' · Staff only' : ''} · {new Date(item.created_at).toLocaleString()}</p><p className="mt-1 text-sm text-slate-200">{item.body}</p></div>)}{comments.length === 0 && <p className="text-xs text-slate-500">No updates yet.</p>}</div>
      <form onSubmit={postComment} className="mt-3 flex flex-col gap-2 sm:flex-row"><input className="input flex-1" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a progress update or comment" required /><button disabled={busy} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">Post update</button></form>
      {(isManager || profile?.role === 'maintenance_staff') && <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={isInternal} onChange={(event) => setIsInternal(event.target.checked)} />Staff-only note</label>}
      {error && <p className="mt-2 text-sm text-rose-200">{error}</p>}
    </div>
  </article>;
}

export function CreateMaintenancePage({ session, onRefresh }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium' });
  const [tenantProperty, setTenantProperty] = useState(null);
  const [propertyLoading, setPropertyLoading] = useState(true);
  const [propertyError, setPropertyError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [createdId, setCreatedId] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const loadTenantProperty = async () => {
      try {
        const response = await apiFetch('/tenant/property', { method: 'GET' }, session.access_token);
        if (!isMounted) return;
        setTenantProperty(response.property || null);
        setPropertyError('');
      } catch (loadError) {
        if (!isMounted) return;
        setTenantProperty(null);
        setPropertyError(loadError.message || 'Unable to load your property information.');
      } finally {
        if (isMounted) setPropertyLoading(false);
      }
    };
    void loadTenantProperty();
    return () => { isMounted = false; };
  }, [session.access_token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!tenantProperty) {
      setError('You are not currently linked to an active property.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    let createdRequestId = null;
    try {
      const response = await apiFetch('/maintenance', { method: 'POST', body: JSON.stringify(form) }, session.access_token);
      const requestId = response.maintenanceRequest.id;
      createdRequestId = requestId;
      setCreatedId(requestId);
      if (photos.length) {
        await attachPhotos(requestId, photos, session.access_token);
      }
      await onRefresh?.();
      setSuccess('Maintenance request submitted successfully.');
      setForm({ title: '', description: '', priority: 'medium' });
      setPhotos([]);
      setTimeout(() => navigate('/maintenance'), 750);
    } catch (submitError) {
      if (createdRequestId) {
        await onRefresh?.();
        setError(`Request created, but the photo upload failed: ${submitError.message || 'Please try attaching photos again.'}`);
      } else {
        setError(submitError.message || 'Unable to create maintenance request.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card rounded-2xl p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Create request</p>
      <h3 className="mt-1 text-xl font-semibold text-white">Log a maintenance issue</h3>
      <div className="mt-5">
        {propertyLoading ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">Loading your linked property...</div>
        ) : tenantProperty ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
            <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Linked property</p>
            <p className="mt-2 font-medium text-white">{tenantProperty.name}</p>
            <p className="text-sm text-slate-400">{tenantProperty.address}{tenantProperty.unit ? ` · Unit ${tenantProperty.unit.unit_number}` : ''}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {propertyError || 'You are not currently linked to an active property.'}
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div><label className="mb-1 block text-sm text-slate-300">Title</label><input required className="input" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Leaking kitchen sink" /></div>
        <div><label className="mb-1 block text-sm text-slate-300">Description</label><textarea required className="input min-h-28" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe the issue, location, and urgency." /></div>
        <div><label className="mb-1 block text-sm text-slate-300">Priority</label><select className="input" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
        <div><label className="mb-1 block text-sm text-slate-300">Issue photos (up to 5, 10 MB each)</label><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple className="input" disabled={loading} onChange={(event) => { const selected = Array.from(event.target.files || []); const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']; if (selected.length > 5) { setPhotos([]); setError('Choose no more than five photos.'); return; } if (selected.some((file) => !supportedTypes.includes(file.type) || file.size > 10 * 1024 * 1024)) { setPhotos([]); setError('Photos must be JPEG, PNG, WebP, or HEIC and no larger than 10 MB each.'); return; } setError(''); setPhotos(selected); }} /></div>
        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}
        {createdId && error && <Link to="/maintenance" className="block text-sm text-sky-300 underline">Open your created request to retry photo attachments</Link>}
        {success && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{success}</div>}
        <button type="submit" className="rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white hover:bg-sky-500 disabled:opacity-60" disabled={loading || propertyLoading || !tenantProperty || Boolean(createdId)}>{loading ? 'Submitting...' : 'Submit request'}</button>
      </form>
    </div>
  );
}
