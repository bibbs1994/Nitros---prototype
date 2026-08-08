import { analyzeSemanticImage } from '../semantic-analyzer-core.mjs';
import { allowedOrigin, clientAddress, enforceRateLimit, parseJsonBody, publicError, validateDeclaredLength, validateJsonContentType } from '../backend-http-security.mjs';

function safeServerDiagnostic(diagnostic = {}) {
  const allowed = ['diagnosticVersion','success','stage','requestId','requestReceived','methodAccepted','requestBodyParsed','imagePayloadFound','imagePayloadNonEmpty','imagePayloadValid','imageMimeType','imageByteLength','imageHashShort','payloadImageCount','openaiCredentialConfigured','openaiRequestConstructed','openaiRequestAttempted','openaiResponseReceived','openaiResponseOk','openaiResponseParsed','openaiHttpStatus','openaiElapsedMs','openaiModel','semanticOutputPresent','semanticObjectsReturned','componentIdentificationAttempted','componentIdentificationSkipped','componentResponseReceived','componentResponseOk','componentResponseParsed','componentHttpStatus','componentElapsedMs','componentResultPresent','componentConfidenceNormalized','componentStatus','componentErrorCategory','componentErrorMessage','wiringDiagramAnalysisAttempted','wiringDiagramAnalysisSkipped','wiringDiagramResponseReceived','wiringDiagramResponseOk','wiringDiagramResponseParsed','wiringDiagramHttpStatus','wiringDiagramElapsedMs','wiringDiagramResultPresent','wiringDiagramStatus','wiringDiagramErrorMessage','errorCategory','errorType','errorCode','errorMessage','responseReturned'];
  return Object.fromEntries(allowed.filter(key => diagnostic[key] !== undefined).map(key => [key, diagnostic[key]]));
}

export default async function handler(request, response) {
  const diagnostic = { diagnosticVersion: '10.12.7AN', success: false, stage: 'A_REQUEST_RECEIVED', requestReceived: true, methodAccepted: false, requestBodyParsed: false, imagePayloadFound: false, imagePayloadValid: false, payloadImageCount: 0, openaiCredentialConfigured: null, openaiRequestConstructed: false, openaiRequestAttempted: false, openaiResponseReceived: false, openaiResponseOk: false, openaiResponseParsed: false, semanticOutputPresent: false, componentIdentificationAttempted: false, componentResultPresent: false, wiringDiagramAnalysisAttempted: false, wiringDiagramResultPresent: false, responseReturned: false };
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = request.headers?.origin;
  if (!allowedOrigin(origin)) return response.status(403).json({ error: 'Origin is not allowed.', code: 'ORIGIN_FORBIDDEN' });
  response.setHeader('Access-Control-Allow-Origin', origin);
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control');
    response.setHeader('Access-Control-Max-Age', '600');
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST, OPTIONS');
    return response.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }
  diagnostic.stage = 'B_HTTP_METHOD_ACCEPTED';
  diagnostic.methodAccepted = true;
  try {
    enforceRateLimit(`${origin}|${clientAddress(request.headers)}`);
    validateJsonContentType(request.headers?.['content-type']);
    validateDeclaredLength(request.headers?.['content-length']);
    const body = parseJsonBody(request.body);
    diagnostic.stage = 'C_REQUEST_BODY_PARSED';
    diagnostic.requestBodyParsed = true;
    diagnostic.requestId = typeof body?.transactionId === 'string' ? body.transactionId : 'invalid';
    diagnostic.imagePayloadFound = typeof body?.imageBase64 === 'string' && body.imageBase64.length > 0;
    const result = await analyzeSemanticImage(body, { diagnostic });
    diagnostic.stage = 'L_RESPONSE_RETURNED';
    diagnostic.success = true;
    diagnostic.responseReturned = true;
    return response.status(200).json({ ...result, serverDiagnostic: safeServerDiagnostic(diagnostic) });
  } catch (error) {
    const failure = publicError(error);
    const failedDiagnostic = error?.serverDiagnostic || diagnostic;
    if (!failedDiagnostic.errorCategory) failedDiagnostic.errorCategory = error?.code || 'VERCEL_REQUEST_ERROR';
    if (!failedDiagnostic.errorMessage) failedDiagnostic.errorMessage = error?.publicMessage || failure.body.error;
    if (failedDiagnostic.stage === 'B_HTTP_METHOD_ACCEPTED') failedDiagnostic.stage = 'C_REQUEST_BODY_PARSE_FAILED';
    failedDiagnostic.responseReturned = true;
    if (failure.status === 429) response.setHeader('Retry-After', '60');
    return response.status(failure.status).json({ ...failure.body, serverDiagnostic: safeServerDiagnostic(failedDiagnostic) });
  }
}
