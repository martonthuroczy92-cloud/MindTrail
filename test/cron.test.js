import { afterEach, describe, expect, it } from 'vitest';
import { POST } from '../api/cron.js';

const req = (auth) => new Request('https://x/api/cron', { method: 'POST', headers: auth ? { authorization: auth } : {} });

describe('cron endpoint auth', () => {
  afterEach(() => { delete process.env.CRON_SECRET; });
  it('rejects missing or wrong secrets', async () => {
    process.env.CRON_SECRET = 'a'.repeat(40);
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req(`Bearer ${'b'.repeat(40)}`))).status).toBe(401);
  });
  it('refuses to run with a short or unset secret, even if the caller matches it', async () => {
    process.env.CRON_SECRET = 'short';
    expect((await POST(req('Bearer short'))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await POST(req('Bearer '))).status).toBe(401);
  });
});
