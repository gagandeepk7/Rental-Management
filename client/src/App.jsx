import AppShell from './app/AppShell.jsx';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.jsx';
import AuthScreen from './auth/AuthScreen.jsx';
import { useAuth } from './auth/useAuth.js';
import LandingPage from './pages/LandingPage.jsx';

export default function App() {
  return <AuthProvider><AuthenticatedApp /></AuthProvider>;
}

function AuthenticatedApp() {
  const { session, loading, signOut } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-sky-500 border-t-transparent" />
          <p>Loading property portal...</p>
        </div>
      </div>
    );
  }

  if (!session || window.location.pathname === '/reset-password') {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<AuthScreen key="login" initialMode="login" />} />
          <Route path="/forgot-password" element={<AuthScreen key="forgot" initialMode="forgot" />} />
          <Route path="/register" element={<AuthScreen key="register" initialMode="register" />} />
          <Route path="/reset-password" element={<AuthScreen initialMode="reset" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return <AppShell session={session} onSignOut={signOut} />;
}
