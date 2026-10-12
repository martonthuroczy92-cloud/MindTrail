// Error logging that never includes transcript text, audio, emails or request bodies.
// Only the error class, a code, and a message truncated and scrubbed of anything quote-like.

export function safeErrorMessage(err) {
  const raw = String(err?.message ?? err ?? 'unknown error');
  return raw
    .replace(/"[^"]{20,}"/g, '"…"') // long quoted strings may echo user content
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .slice(0, 300);
}

export function logError(context, err, extra = {}) {
  console.error(
    JSON.stringify({
      level: 'error',
      context,
      name: err?.name,
      code: err?.code ?? err?.statusCode ?? err?.status,
      message: safeErrorMessage(err),
      ...extra, // ids only — callers must not pass content
    }),
  );
}
