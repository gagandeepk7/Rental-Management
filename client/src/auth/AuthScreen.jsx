import { useState } from 'react';
import { ArrowLeft, ArrowRight, Building2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';

export default function AuthScreen({ initialMode = 'login' }) {
  const navigate = useNavigate();
  const mode = initialMode;
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'tenant' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;
    const email = form.email.trim().toLowerCase();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw resetError;
        setSuccess('If an account exists for that email, a password reset link is on its way.');
      } else if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password: form.password,
        });
        if (authError) throw authError;
      } else if (mode === 'reset') {
        const { error: updateError } = await supabase.auth.updateUser({ password: form.password });
        if (updateError) throw updateError;
        setSuccess('Your password has been updated. Continue to your workspace when you are ready.');
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password: form.password,
          options: { emailRedirectTo: `${window.location.origin}/login`, data: { full_name: form.full_name.trim(), role: 'tenant' } },
        });
        if (authError) throw authError;
        setSuccess(data.session
          ? 'Account created. Opening your workspace…'
          : 'Check your inbox (including spam) for a confirmation link. If you already have an account, sign in or reset your password.');
      }
    } catch (submitError) {
      setError(submitError.code === 'email_address_invalid'
        ? 'This email address was rejected by the email provider. Check the spelling and use a real, deliverable email address.'
        : submitError.code === 'over_email_send_rate_limit'
          ? 'Too many email requests. Please wait a few minutes before trying again.'
          : submitError.message === 'Failed to fetch'
            ? 'Unable to reach the account service. Check your connection and try again.'
            : submitError.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const changeMode = (value) => {
    setError('');
    setSuccess('');
    setForm((current) => ({ ...current, password: '' }));
    navigate(value === 'forgot' ? '/forgot-password' : value === 'login' ? '/login' : '/register');
  };

  return (
    <main className="auth-page">
      <div className="auth-image">
        <Link className="brand-lockup auth-brand" to="/">
          <span className="brand-mark"><Building2 aria-hidden="true" /></span>
          <span><strong>PropertyFlow</strong><small>Residential operations</small></span>
        </Link>
        <div className="auth-image__copy">
          <p className="eyebrow">Care starts at home</p>
          <h1>Spaces that work<br /><em>beautifully together.</em></h1>
          <p>One thoughtful place for residents and the people who care for their home.</p>
        </div>
      </div>
      <section className="auth-panel">
        <Link className="auth-back" to="/"><ArrowLeft aria-hidden="true" /> Back to home</Link>
        <div className="auth-card">
          <p className="eyebrow">{mode === 'register' ? 'Start your experience' : mode === 'forgot' || mode === 'reset' ? 'Account recovery' : 'Welcome back'}</p>
          <h2>{mode === 'register' ? 'Make yourself at home.' : mode === 'forgot' ? 'Reset your password.' : mode === 'reset' ? 'Choose a new password.' : 'Your home, in hand.'}</h2>
          <p className="auth-intro">
            {mode === 'register'
              ? 'Create a resident account to get started.'
              : mode === 'forgot'
                ? 'Enter your email and we’ll send a secure reset link.'
                : mode === 'reset'
                  ? 'Set a new password to secure your account.'
                : 'Sign in to continue to your workspace.'}
          </p>
          {(mode === 'login' || mode === 'register') && (
            <div className="auth-tabs" role="tablist" aria-label="Account access">
              {['login', 'register'].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  className={mode === value ? 'is-selected' : ''}
                  onClick={() => {
                    changeMode(value);
                  }}
                >
                  {value === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="auth-form" aria-busy={loading}>
            <fieldset disabled={loading} style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
            {mode === 'register' && (
              <div>
                <label htmlFor="full-name">Full name</label>
                <input id="full-name" required autoComplete="name" className="input" placeholder="Jordan Lee" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} />
              </div>
            )}
            {mode !== 'reset' && <div>
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" autoCapitalize="none" spellCheck={false} autoComplete="email" required className="input" placeholder="you@example.com" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            </div>}
            {mode !== 'forgot' && (
              <div>
                <div className="auth-label-row">
                  <label htmlFor="password">{mode === 'reset' ? 'New password' : 'Password'}</label>
                  {mode === 'login' && <button type="button" className="text-link" onClick={() => changeMode('forgot')}>Forgot password?</button>}
                </div>
                <input id="password" minLength={mode === 'login' ? undefined : 6} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required className="input" placeholder={mode === 'reset' ? 'Choose a new password' : 'Password'} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
              </div>
            )}
            {error && <div role="alert" className="auth-message auth-message--error">{error}</div>}
            {success && <div role="status" className="auth-message auth-message--success">{success}</div>}
            <button type="submit" className="button-primary auth-submit" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in securely' : mode === 'register' ? 'Create account' : mode === 'reset' ? 'Update password' : 'Send reset link'}
              {!loading && <ArrowRight aria-hidden="true" />}
            </button>
            {mode === 'forgot' && <button type="button" className="text-link auth-return" onClick={() => changeMode('login')}>Return to sign in</button>}
            {mode === 'reset' && success && <Link className="text-link auth-return" to="/">Continue to your workspace</Link>}
            </fieldset>
          </form>
          <p className="auth-footnote">Your account and property information stay protected.</p>
        </div>
      </section>
    </main>
  );
}
