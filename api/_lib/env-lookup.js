// Finds a variable by its standard name, or by that name with a prefix. The Vercel ↔ Supabase
// integration lets you choose a prefix when connecting (e.g. `mindtrail_SUPABASE_URL`), and
// older integrations used `NEXT_PUBLIC_…` names. Exact names win; otherwise the shortest
// prefixed match is used.
export function findEnv(source, baseNames) {
  for (const base of baseNames) {
    const exact = source[base]?.trim();
    if (exact) return { name: base, value: exact };
  }
  for (const base of baseNames) {
    const match = Object.keys(source)
      .filter((k) => k !== base && k.endsWith(base) && source[k]?.trim())
      .sort((a, b) => a.length - b.length)[0];
    if (match) return { name: match, value: source[match].trim() };
  }
  return undefined;
}

export const SUPABASE_URL_NAMES = ['SUPABASE_URL'];
export const SUPABASE_BROWSER_KEY_NAMES = ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'];
export const SUPABASE_SERVER_KEY_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'];
