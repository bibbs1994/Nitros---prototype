import { analyzeSemanticImage } from '../semantic-analyzer-core.mjs';
import { allowedOrigin, clientAddress, enforceRateLimit, parseJsonBody, publicError, validateDeclaredLength, validateJsonContentType } from '../backend-http-security.mjs';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = request.headers?.origin;
  if (!allowedOrigin(origin)) return response.status(403).json({ error: 'Origin is not allowed.', code: 'ORIGIN_FORBIDDEN' });
  response.setHeader('Access-Control-Allow-Origin', origin);
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '600');
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST, OPTIONS');
    return response.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    enforceRateLimit(`${origin}|${clientAddress(request.headers)}`);
    validateJsonContentType(request.headers?.['content-type']);
    validateDeclaredLength(request.headers?.['content-length']);
    const body = parseJsonBody(request.body);
    return response.status(200).json(await analyzeSemanticImage(body));
  } catch (error) {
    const failure = publicError(error);
    if (failure.status === 429) response.setHeader('Retry-After', '60');
    return response.status(failure.status).json(failure.body);
  }
}
