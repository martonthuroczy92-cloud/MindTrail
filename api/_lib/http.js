import { logError } from './log.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}

// Wraps a handler so unexpected errors return a generic 500 and are logged without payloads.
export function handler(fn, name) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      logError(name, err);
      return json({ error: 'Something went wrong. Try again.' }, 500);
    }
  };
}
