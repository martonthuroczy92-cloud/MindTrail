import { describe, expect, it } from 'vitest';
import { extract, groundItems, locateQuote, OUTPUT_JSON_SCHEMA, buildSystemPrompt, tokenCost } from '../api/_lib/extract.js';

const segments = [
  { start: 0, end: 4, text: 'Szia! Na, mi a helyzet a kazánnal?' },
  { start: 4, end: 11, text: 'Holnap megnézem a nyomást, és küldök egy árajánlatot péntekig.' },
  { start: 11, end: 15, text: 'Okay, and I will call the insurance company on Monday.' },
];

const item = (over = {}) => ({
  text: 'Biztosító felhívása',
  owner: 'me',
  owner_label: null,
  due_date: '2026-10-26',
  due_date_source: 'stated',
  priority: 'normal',
  source_quote: 'I will call the insurance company on Monday',
  source_timestamp: 99,
  confidence: 0.9,
  ...over,
});

const output = (items) => ({ summary: 'A kazánról beszéltünk.', decisions: [], open_questions: [], action_items: items });

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        async create(req) {
          calls.push(req);
          const r = responses[Math.min(calls.length - 1, responses.length - 1)];
          return {
            model: 'claude-sonnet-5-5',
            stop_reason: r.stop_reason ?? 'end_turn',
            usage: { input_tokens: 1000, output_tokens: 200 },
            content: [{ type: 'text', text: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) }],
          };
        },
      },
    },
  };
}

const args = { segments, recordingDate: '2026-10-19', title: 'Kazán', outputLanguage: 'hu' };

describe('locateQuote / groundItems', () => {
  it('finds a quote despite punctuation and case differences, and returns its segment start', () => {
    expect(locateQuote(segments, 'holnap megnézem a nyomást és küldök')).toEqual({ start: 4 });
    expect(locateQuote(segments, '"Okay, and I will CALL the insurance"')).toEqual({ start: 11 });
  });
  it('rejects quotes that are not in the transcript', () => {
    expect(locateQuote(segments, 'I will repaint the fence')).toBeNull();
  });
  it('drops ungrounded and duplicate items and fixes timestamps from the transcript', () => {
    const { items, dropped } = groundItems(
      [item(), item({ source_quote: 'invented sentence' }), item()],
      segments,
    );
    expect(items).toHaveLength(1);
    expect(items[0].source_timestamp).toBe(11);
    expect(dropped).toBe(2);
  });
  it('strips labels from my own items', () => {
    const { items } = groundItems([item({ owner_label: 'Anna' })], segments);
    expect(items[0].owner_label).toBeNull();
  });
});

describe('extract', () => {
  it('returns grounded items and asks for the configured model, schema and fallback', async () => {
    const client = fakeClient([{ body: output([item(), item({ text: 'x', source_quote: 'not said' })]) }]);
    const res = await extract(args, { anthropic: client });
    expect(res.output.action_items).toHaveLength(1);
    expect(res.dropped).toBe(1);
    const req = client.calls[0];
    expect(req.model).toBe('claude-sonnet-5-5');
    expect(req.output_config.format).toEqual({ type: 'json_schema', schema: OUTPUT_JSON_SCHEMA });
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toContain('server-side-fallback-2026-07-01');
    expect(req.messages[0].content).toContain('[4] Holnap megnézem');
    expect(req.messages[0].content).toContain('Conversation date: 2026-10-19');
  });

  it('retries once on invalid output, then succeeds', async () => {
    const client = fakeClient([{ body: '{"summary": "' }, { body: output([item()]) }]);
    const res = await extract(args, { anthropic: client });
    expect(client.calls).toHaveLength(2);
    expect(res.usages).toHaveLength(2);
    expect(res.output.action_items).toHaveLength(1);
  });

  it('rejects a date without a source, and fails after the second invalid answer', async () => {
    const bad = output([item({ due_date_source: null })]);
    const client = fakeClient([{ body: bad }, { body: bad }]);
    await expect(extract(args, { anthropic: client })).rejects.toThrow(/failed twice.*schema/);
    expect(client.calls).toHaveLength(2);
  });

  it('reports a refusal without retrying', async () => {
    const client = fakeClient([{ body: '', stop_reason: 'refusal' }]);
    await expect(extract(args, { anthropic: client })).rejects.toThrow(/declined/);
    expect(client.calls).toHaveLength(1);
  });

  it('skips the API for an empty transcript', async () => {
    const client = fakeClient([]);
    const res = await extract({ ...args, segments: [] }, { anthropic: client });
    expect(client.calls).toHaveLength(0);
    expect(res.output.action_items).toEqual([]);
  });
});

describe('prompt and pricing', () => {
  it('writes in the chosen language and forbids inferring emotions', () => {
    const p = buildSystemPrompt({ outputLanguage: 'en', ownerName: 'Márton' });
    expect(p).toContain('in English');
    expect(p).toContain('Márton');
    expect(p).toMatch(/emotions, mood, tone of voice, personality/);
  });
  it('prices tokens', () => {
    expect(tokenCost('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 })).toBeCloseTo(3, 5);
    expect(tokenCost('unknown-model', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4, 5);
  });
});
