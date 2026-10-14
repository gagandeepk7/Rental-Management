import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'tenant' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (authError) throw authError;
      } else {
        const { error: authError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: form.full_name, role: 'tenant' } },
        });
        if (authError) throw authError;
        setSuccess('Verification email sent. Please check your inbox and confirm your account before signing in.');
      }
    } catch (submitError) {
      setError(submitError.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="card w-full max-w-md rounded-2xl p-6">
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
            <Building2 className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-bold text-white">PropertyFlow</h1>
          <p className="mt-2 text-sm text-slate-300">Rental, maintenance, and amenity management</p>
        </div>

        <div className="mb-5 flex rounded-xl border border-slate-800 bg-slate-900/70 p-1">
          {['login', 'register'].map((value) => (
            <button
              key={value}
              type="button"
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${mode === value ? 'bg-sky-600 text-white' : 'text-slate-300'}`}
              onClick={() => setMode(value)}
            >
              {value === 'login' ? 'Login' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-sm text-slate-300">Full name</label>
              <input className="input" placeholder="Jordan Lee" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm text-slate-300">Email</label>
            <input type="email" className="input" placeholder="tenant@example.com" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-300">Password</label>
            <input type="password" className="input" placeholder="Password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
          </div>
          {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}
          {success && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{success}</div>}
          <button type="submit" className="w-full rounded-xl bg-sky-600 px-4 py-2.5 font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
