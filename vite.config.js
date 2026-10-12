import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Only these two values reach the browser bundle, by explicit allowlist (not by env prefix).
// Both are public by design: the anon/publishable key can do nothing that RLS does not allow.
function publicSupabaseConfig(mode) {
  const all = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const pick = (...names) => names.map((n) => all[n]).find((v) => v && v.trim())?.trim() ?? '';
  const url = pick('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = pick(
    'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY',
  );
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
    throw new Error('Refusing to build: the Supabase key chosen for the browser is a secret/service key.');
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
