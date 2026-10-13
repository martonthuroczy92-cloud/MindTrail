import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDir } from '../scripts/check-bundle.mjs';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.c2lnbmF0dXJlc2lnbmF0dXJl`;

async function withDist(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dist-'));
  try {
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('bundle secret check', () => {
  it('passes a clean bundle that only holds the anon key', async () => {
    const findings = await withDist({ 'a.js': `const k="${fakeJwt('anon')}";` }, (d) => scanDir(d, {}));
    expect(findings).toEqual([]);
  });

  it('flags a service_role JWT', async () => {
    const findings = await withDist({ 'a.js': `const k="${fakeJwt('service_role')}";` }, (d) => scanDir(d, {}));
    expect(findings.join()).toMatch(/service_role/);
  });

  it('flags the literal value of a secret env var', async () => {
    const env = { RESEND_API_KEY: 'resend-secret-value-123456' };
    const findings = await withDist({ 'a.js': 'x="resend-secret-value-123456"' }, (d) => scanDir(d, env));
    expect(findings.join()).toMatch(/RESEND_API_KEY/);
  });

  it('flags key-shaped strings', async () => {
    const findings = await withDist({ 'a.js': 'x="sk-ant-api03-abcdefghijklmnopqrstuvwxyz"' }, (d) => scanDir(d, {}));
    expect(findings.join()).toMatch(/Anthropic/);
  });
});

describe('bundle secret check with prefixed variables', () => {
  it('flags the value of a prefixed service key', async () => {
    const env = { mindtrail_SUPABASE_SERVICE_ROLE_KEY: 'prefixed-service-key-value-123' };
    const findings = await withDist({ 'a.js': 'x="prefixed-service-key-value-123"' }, (d) => scanDir(d, env));
    expect(findings.join()).toMatch(/mindtrail_SUPABASE_SERVICE_ROLE_KEY/);
  });
});
