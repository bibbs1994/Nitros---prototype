export const NITROS_PRODUCTION_ORIGINS = Object.freeze([
  'https://bibbs1994.github.io'
]);

export const MAX_JSON_BYTES = 4 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 12;
const rateBuckets = new Map();

export class HttpError extends Error {
  constructor(statusCode, code, publicMessage) {
    super(publicMessage);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function allowedOrigin(origin) {
  return typeof origin === 'string' && NITROS_PRODUCTION_ORIGINS.includes(origin);
}

export function clientAddress(headers = {}, fallback = 'unknown') {
  const forwarded = headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return typeof value === 'string' && value.trim() ? value.split(',')[0].trim().slice(0, 128) : fallback;
}

export function enforceRateLimit(key, now = Date.now()) {
  if (rateBuckets.size > 5_000) {
    for (const [entryKey, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(entryKey);
  }
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { limit: RATE_MAX_REQUESTS, remaining: RATE_MAX_REQUESTS - 1, resetAt: now + RATE_WINDOW_MS };
  }
  current.count += 1;
  if (current.count > RATE_MAX_REQUESTS) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.');
  return { limit: RATE_MAX_REQUESTS, remaining: RATE_MAX_REQUESTS - current.count, resetAt: current.resetAt };
}

export function validateJsonContentType(contentType) {
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType.trim())) {
    throw new HttpError(415, 'UNSUPPORTED_CONTENT_TYPE', 'Content-Type must be application/json.');
  }
}

export function validateDeclaredLength(contentLength) {
  if (contentLength === undefined || contentLength === null || contentLength === '') return;
  if (!/^\d+$/.test(String(contentLength))) throw new HttpError(400, 'INVALID_CONTENT_LENGTH', 'Content-Length is invalid.');
  if (Number(contentLength) > MAX_JSON_BYTES) throw new HttpError(413, 'REQUEST_TOO_LARGE', 'Request body is too large.');
}

export function parseJsonBody(body) {
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    if (bytes.length > MAX_JSON_BYTES) throw new HttpError(413, 'REQUEST_TOO_LARGE', 'Request body is too large.');
    try {
      body = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new HttpError(400, 'INVALID_JSON', 'Request body must contain valid JSON.');
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_JSON_BYTES) throw new HttpError(413, 'REQUEST_TOO_LARGE', 'Request body is too large.');
  return body;
}

export function publicError(error) {
  if (error instanceof HttpError) return { status: error.statusCode, body: { error: error.publicMessage, code: error.code } };
  const status = Number(error?.statusCode);
  if (status === 400 || status === 409 || status === 413 || status === 415) {
    return { status, body: { error: 'The image-analysis request is invalid.', code: 'INVALID_REQUEST' } };
  }
  if (status === 503) return { status: 503, body: { error: 'Image analysis is not configured.', code: 'SERVICE_UNAVAILABLE' } };
  return { status: 502, body: { error: 'Image analysis is temporarily unavailable.', code: 'ANALYSIS_UNAVAILABLE' } };
}

export function resetRateLimitsForTests() {
  rateBuckets.clear();
}
