// Minimal in-memory stand-in for the supabase-js calls used by api/_lib/jobs.js.
export function createFakeSupabase(seed = {}) {
  const tables = structuredClone(seed.tables ?? {});
  const files = new Map(Object.entries(seed.files ?? {}));
  const removed = [];

  function query(table) {
    const rows = () => (tables[table] ??= []);
    let filters = [];
    let op = { kind: 'select' };
    let order = null;
    let limit = null;
    let returning = false;

    const matches = (r) => filters.every((f) => f(r));
    const api = {
      select() { returning = true; return api; },
      eq(col, v) { filters.push((r) => r[col] === v); return api; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return api; },
      or(expr) {
        const parts = expr.split(',').map((p) => {
          const [col, opName, ...rest] = p.split('.');
          const val = rest.join('.');
          if (opName === 'is' && val === 'null') return (r) => r[col] == null;
          if (opName === 'lt') return (r) => r[col] != null && r[col] < val;
          throw new Error(`fake: unsupported or() ${p}`);
        });
        filters.push((r) => parts.some((f) => f(r)));
        return api;
      },
      order(col) { order = col; return api; },
      limit(n) { limit = n; return api; },
      update(obj) { op = { kind: 'update', obj }; return api; },
      insert(obj) { op = { kind: 'insert', obj }; return api; },
      upsert(obj) { op = { kind: 'upsert', obj }; return api; },
      delete() { op = { kind: 'delete' }; return api; },
      maybeSingle() { return run().then(({ data, error }) => ({ data: data?.[0] ?? null, error })); },
      single() { return run().then(({ data, error }) => ({ data: data?.[0] ?? null, error: data?.[0] ? error : new Error('no rows') })); },
      then(res, rej) { return run().then(res, rej); },
    };

    async function run() {
      const list = rows();
      if (op.kind === 'insert' || op.kind === 'upsert') {
        const items = Array.isArray(op.obj) ? op.obj : [op.obj];
        for (const item of items) {
          const key = table === 'audio_chunks'
            ? (r) => r.recording_id === item.recording_id && r.idx === item.idx
            : ['transcripts', 'summaries'].includes(table) ? (r) => r.recording_id === item.recording_id : () => false;
          const existing = op.kind === 'upsert' ? list.find(key) : null;
          if (existing) Object.assign(existing, item);
          else list.push({ ...item });
        }
        return { data: items, error: null };
      }
      let out = list.filter(matches);
      if (op.kind === 'delete') {
        tables[table] = list.filter((r) => !matches(r));
        return { data: null, error: null };
      }
      if (op.kind === 'update') {
        out.forEach((r) => Object.assign(r, op.obj));
        return { data: returning ? out.map((r) => ({ ...r })) : null, error: null };
      }
      if (order) out = [...out].sort((a, b) => (a[order] > b[order] ? 1 : -1));
      if (limit != null) out = out.slice(0, limit);
      return { data: out.map((r) => ({ ...r })), error: null };
    }
    return api;
  }

  const storage = {
    from: () => ({
      async download(path) {
        if (!files.has(path)) return { data: null, error: new Error('not found') };
        const buf = files.get(path);
        return { data: { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }, error: null };
      },
      async upload(path, body) { files.set(path, new Uint8Array(body)); return { data: { path }, error: null }; },
      async remove(paths) { paths.forEach((p) => { files.delete(p); removed.push(p); }); return { data: [], error: null }; },
    }),
  };

  return { client: { from: query, storage }, tables, files, removed };
}
