import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { findEnv, SUPABASE_BROWSER_KEY_NAMES, SUPABASE_URL_NAMES } from './api/_lib/env-lookup.js';

// Only these two values reach the browser bundle, by explicit allowlist (not by env prefix).
// Both are public by design: the anon/publishable key can do nothing that RLS does not allow.
function publicSupabaseConfig(mode) {
  const all = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const url = findEnv(all, SUPABASE_URL_NAMES)?.value ?? '';
  const key = findEnv(all, SUPABASE_BROWSER_KEY_NAMES)?.value ?? '';
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
    throw new Error('Refusing to build: the Supabase key chosen for the browser is a secret/service key.');
  }
  // On Vercel, fail the deploy instead of shipping an app that cannot start.
  if (process.env.VERCEL && (!url || !key)) {
    const present = Object.keys(all).filter((n) => /SUPABASE/i.test(n)).sort();
    throw new Error(
      'Supabase settings are missing at build time, so the app cannot start. ' +
        'Connect the Supabase database to this project (Vercel → Storage → your database → Connect Project, ' +
        'tick Production and Preview) and redeploy. Names must end in SUPABASE_URL and SUPABASE_ANON_KEY ' +
        '(or SUPABASE_PUBLISHABLE_KEY). ' +
        `Supabase-related variables found: ${present.length ? present.join(', ') : 'none'}.`,
    );
  }
  return { url, key };
}

function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role;
  } catch {
    return undefined;
  }
}

export default defineConfig(({ mode }) => {
  const supa = publicSupabaseConfig(mode);
  return {
    define: {
      __SUPABASE_URL__: JSON.stringify(supa.url),
      __SUPABASE_ANON_KEY__: JSON.stringify(supa.key),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'MindTrail',
          short_name: 'MindTrail',
          description: 'Personal conversation memory and action items',
          start_url: '/',
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#1f3a5f',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Cache the app shell only. API and Supabase responses are never cached.
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [],
        },
      }),
    ],
    server: {
      // `vercel dev` serves /api; plain `vite` dev proxies to it.
      proxy: { '/api': 'http://localhost:3000' },
    },
  };
});
