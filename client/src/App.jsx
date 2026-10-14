import AppShell from './app/AppShell.jsx';
import { AuthProvider } from './auth/AuthProvider.jsx';
import AuthScreen from './auth/AuthScreen.jsx';
import { useAuth } from './auth/useAuth.js';

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

  if (!session) return <AuthScreen />;

  return <AppShell session={session} onSignOut={signOut} />;
}
