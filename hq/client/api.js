// Fetch helper for /api/joya. Throws ApiError with the server's message and code.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `request failed (${status})`);
    this.status = status;
    this.code = body?.code || null;
    this.details = body?.details || null;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/joya${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** ?a=1&b=2 from an object, skipping null/undefined/''. */
export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v != null && v !== '') p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
