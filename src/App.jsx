import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { configError, supabase } from './lib/supabase.js';
import Login from './screens/Login.jsx';
import Upload from './screens/Upload.jsx';
import Recordings from './screens/Recordings.jsx';
import Recording from './screens/Recording.jsx';

export default function App() {
  if (configError) {
    return <main className="page"><h1>MindTrail</h1><p className="error">{configError}</p></main>;
  }
  return <SignedInApp />;
}

function SignedInApp() {
  const [session, setSession] = useState(undefined); // undefined = still loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <main className="page"><p>Loading…</p></main>;
  if (!session) return <Login />;

  return (
    <div className="app">
      <main className="page">
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/recordings" element={<Recordings />} />
          <Route path="/recordings/:id" element={<Recording />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="tabbar">
        <NavLink to="/" end>Add</NavLink>
        <NavLink to="/recordings">Recordings</NavLink>
        <button type="button" className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </nav>
    </div>
  );
}
