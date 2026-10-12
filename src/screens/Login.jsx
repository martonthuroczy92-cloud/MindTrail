import { useState } from 'react';
import { api } from '../lib/api.js';

export default function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });

  async function submit(e) {
    e.preventDefault();
    setState({ status: 'sending', message: '' });
    try {
      const res = await api('login', { email });
      setState({ status: 'sent', message: res.message });
    } catch (err) {
      setState({ status: 'error', message: err.message });
    }
  }

  return (
    <main className="page">
      <h1>MindTrail</h1>
      <form onSubmit={submit} className="stack">
        <label>
          Email
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={state.status === 'sending'}>
          {state.status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>
      {state.message && <p className={state.status === 'error' ? 'error' : 'note'}>{state.message}</p>}
      {state.status === 'sent' && (
        <p className="muted">Open the link on this phone. If you installed the app, open it again after signing in.</p>
      )}
    </main>
  );
}
