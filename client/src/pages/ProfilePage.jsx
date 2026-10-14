import { useState } from 'react';
import { apiFetch } from '../lib/api.js';

export default function ProfilePage({ session, profile }) {
  const [fullName, setFullName] = useState(profile.full_name || 'Resident');
  const [status, setStatus] = useState('');

  const handleUpdate = async (event) => {
    event.preventDefault();
    try {
      await apiFetch('/profile', { method: 'PATCH', body: JSON.stringify({ full_name: fullName }) }, session.access_token);
      setStatus('Profile updated successfully.');
    } catch (error) {
      setStatus(error.message || 'Unable to update profile.');
    }
  };

  return (
    <div className="card rounded-2xl p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Account</p><h3 className="mt-1 text-xl font-semibold text-white">Profile and settings</h3>
      <form onSubmit={handleUpdate} className="mt-5 space-y-4">
        <div><label className="mb-1 block text-sm text-slate-300">Email</label><input className="input" value={session.user?.email || ''} disabled /></div>
        <div><label className="mb-1 block text-sm text-slate-300">Full name</label><input className="input" value={fullName} onChange={(event) => setFullName(event.target.value)} /></div>
        <div><label className="mb-1 block text-sm text-slate-300">Role</label><input className="input" value={profile.role || 'tenant'} disabled /></div>
        {status && <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{status}</div>}
        <button type="submit" className="rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white hover:bg-sky-500">Save changes</button>
      </form>
    </div>
  );
}
