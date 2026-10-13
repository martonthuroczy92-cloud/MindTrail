// Fails the build if anything secret-looking ended up in the browser bundle (dist/).
// Runs automatically after `vite build`, so a Vercel deploy with a leaked secret fails.
//   node scripts/check-bundle.mjs [distDir]
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Values of these variables must never appear in the bundle.
export const SECRET_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_JWT_SECRET',
  'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PASSWORD',
  'ANTHROPIC_API_KEY', 'AI_GATEWAY_API_KEY', 'OPENAI_API_KEY', 'RESEND_API_KEY',
  'CRON_SECRET', 'VERCEL_OIDC_TOKEN',
];

// Key formats, in case a secret is pasted into code rather than read from env.
export const SECRET_PATTERNS = [
  { name: 'Anthropic key', re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'OpenAI key', re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: 'Resend key', re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/ },
  { name: 'Vercel AI Gateway key', re: /\bvck_[A-Za-z0-9]{20,}/ },
  { name: 'Postgres URL with password', re: /postgres(ql)?:\/\/[^:\s"']+:[^@\s"']+@/ },
];

function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role;
  } catch {
    return undefined;
  }
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(js|mjs|css|html|json|webmanifest|map|txt|svg)$/.test(entry.name)) yield p;
  }
}

// Also catches prefixed variants such as `mindtrail_SUPABASE_SERVICE_ROLE_KEY`.
const SECRET_NAME_SUFFIX = /(SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|JWT_SECRET|POSTGRES_(PRISMA_)?URL(_NON_POOLING)?|POSTGRES_PASSWORD|_API_KEY|CRON_SECRET|OIDC_TOKEN)$/;

export async function scanDir(dir, env = process.env) {
  const names = new Set([...SECRET_ENV_NAMES, ...Object.keys(env).filter((n) => SECRET_NAME_SUFFIX.test(n))]);
  const secrets = [...names].map((n) => [n, env[n]?.trim()]).filter(([, v]) => v && v.length >= 12);
  const findings = [];
  for await (const file of walk(dir)) {
    const text = await readFile(file, 'utf8');
    for (const [name, value] of secrets) {
      if (text.includes(value)) findings.push(`${file}: contains the value of ${name}`);
    }
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(text)) findings.push(`${file}: matches ${name} pattern`);
    }
    for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
      if (jwtRole(jwt) === 'service_role') findings.push(`${file}: contains a Supabase service_role JWT`);
    }
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? 'dist';
  const findings = await scanDir(dir);
  if (findings.length) {
    console.error('Secret check FAILED — do not deploy:\n' + findings.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
  console.log(`Secret check passed: no secrets found in ${dir}/.`);
}
