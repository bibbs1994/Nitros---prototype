import { createHash } from 'node:crypto';

export const ALLOWED_CATEGORIES = Object.freeze([
  'AUTOMOTIVE_GRAPH',
  'AUTOMOTIVE_COMPONENT_OR_VEHICLE',
  'DOCUMENT_OR_TEXT_SCREENSHOT',
  'GENERAL_NON_AUTOMOTIVE_PHOTO',
  'UNKNOWN_OR_ANALYSIS_UNAVAILABLE'
]);

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
export const OPENAI_TIMEOUT_MS = 45_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o';

const semanticSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'confidence', 'objects', 'evidence', 'description', 'automotiveEvidence', 'graphEvidence', 'documentEvidence'],
  properties: {
    category: { type: 'string', enum: ALLOWED_CATEGORIES },
    confidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'string', pattern: '^\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%?\\s*$' }, { type: 'null' }] },
    objects: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    evidence: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    description: { type: 'string', maxLength: 1200 },
    automotiveEvidence: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    graphEvidence: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    documentEvidence: { type: 'array', items: { type: 'string' }, maxItems: 16 }
  }
};

const automotiveComponentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'primaryComponent', 'componentConfidence', 'system', 'secondaryComponents', 'supportingEvidence', 'possibleAlternatives', 'uncertaintyReason'],
  properties: {
    status: { type: 'string', enum: ['IDENTIFIED', 'UNCERTAIN'] },
    primaryComponent: { type: 'string', maxLength: 160 },
    componentConfidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'string', pattern: '^\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%?\\s*$' }, { type: 'null' }] },
    system: { anyOf: [{ type: 'string', maxLength: 160 }, { type: 'null' }] },
    secondaryComponents: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    supportingEvidence: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    possibleAlternatives: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    uncertaintyReason: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] }
  }
};

export function normalizeSemanticConfidence(rawConfidence) {
  if (rawConfidence === null || rawConfidence === undefined) return null;
  let numeric;
  if (typeof rawConfidence === 'number') numeric = rawConfidence;
  else if (typeof rawConfidence === 'string') {
    const cleaned = rawConfidence.trim().replace(/%$/, '').trim();
    if (!cleaned || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(cleaned)) return null;
    numeric = Number(cleaned);
  } else return null;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric <= 1) numeric *= 100;
  return Math.round(Math.min(100, numeric));
}

function cleanStringArray(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`Analyzer field ${field} is invalid.`);
  return value.map(item => item.trim()).filter(Boolean).slice(0, 24);
}

function validateAutomotiveComponent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Component analyzer returned no structured result.');
  if (!['IDENTIFIED', 'UNCERTAIN'].includes(raw.status)) throw new Error('Component analyzer status is invalid.');
  const primaryComponent = typeof raw.primaryComponent === 'string' ? raw.primaryComponent.trim().slice(0, 160) : '';
  if (!primaryComponent) throw new Error('Component analyzer returned no primary identification state.');
  const normalizedConfidence = normalizeSemanticConfidence(raw.componentConfidence);
  const result = {
    status: raw.status,
    primaryComponent,
    componentConfidence: normalizedConfidence,
    rawComponentConfidence: raw.componentConfidence ?? null,
    normalizedComponentConfidence: normalizedConfidence,
    system: typeof raw.system === 'string' ? raw.system.trim().slice(0, 160) || null : null,
    secondaryComponents: cleanStringArray(raw.secondaryComponents, 'secondaryComponents').slice(0, 12),
    supportingEvidence: cleanStringArray(raw.supportingEvidence, 'supportingEvidence').slice(0, 16),
    possibleAlternatives: cleanStringArray(raw.possibleAlternatives, 'possibleAlternatives').slice(0, 8),
    uncertaintyReason: typeof raw.uncertaintyReason === 'string' ? raw.uncertaintyReason.trim().slice(0, 500) || null : null
  };
  if (result.status === 'IDENTIFIED' && !result.supportingEvidence.length) throw new Error('Component identification has no visible supporting evidence.');
  if (result.status === 'UNCERTAIN' && !result.uncertaintyReason) throw new Error('Component uncertainty reason is missing.');
  return result;
}

function validateSemanticPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Analyzer returned no structured semantic object.');
  if (!ALLOWED_CATEGORIES.includes(raw.category)) throw new Error('Analyzer returned an unsupported category.');
  const normalizedConfidence = normalizeSemanticConfidence(raw.confidence);
  const result = {
    category: raw.category,
    confidence: normalizedConfidence,
    rawConfidence: raw.confidence ?? null,
    normalizedConfidence,
    objects: cleanStringArray(raw.objects, 'objects'),
    evidence: cleanStringArray(raw.evidence, 'evidence'),
    description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 1200) : '',
    automotiveEvidence: cleanStringArray(raw.automotiveEvidence, 'automotiveEvidence'),
    graphEvidence: cleanStringArray(raw.graphEvidence, 'graphEvidence'),
    documentEvidence: cleanStringArray(raw.documentEvidence, 'documentEvidence')
  };
  if (!result.description) throw new Error('Analyzer description is missing.');
  if (result.category !== 'UNKNOWN_OR_ANALYSIS_UNAVAILABLE' && !result.evidence.length) throw new Error('Analyzer supplied no visual evidence.');
  if (result.category === 'AUTOMOTIVE_GRAPH' && result.graphEvidence.length < 2) throw new Error('Graph classification lacks independent structural evidence.');
  if (result.category === 'AUTOMOTIVE_COMPONENT_OR_VEHICLE' && !result.automotiveEvidence.length) throw new Error('Automotive classification lacks positive visual evidence.');
  return result;
}

function extractOutputText(response) {
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
  }
  throw new Error('OpenAI returned no structured output text.');
}

function sanitizeDiagnosticText(value) {
  if (value === undefined || value === null) return null;
  return String(value)
    .replace(/Bearer[\s\S]*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]')
    .replace(/OPENAI_API_KEY\s*[=:]\s*\S+/gi, 'OPENAI_API_KEY=[REDACTED]')
    .replace(/data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[REDACTED_IMAGE_DATA]')
    .replace(/\b[A-Za-z0-9+/]{64,}={0,2}\b/g, '[REDACTED_ENCODED_DATA]')
    .slice(0, 500);
}

function markDiagnostic(diagnostic, stage, updates = {}) {
  if (!diagnostic) return;
  diagnostic.stage = stage;
  Object.assign(diagnostic, updates);
}

function diagnosticFailure(diagnostic, message, statusCode, stage, errorCategory, updates = {}) {
  markDiagnostic(diagnostic, stage, { success: false, errorCategory, errorMessage: sanitizeDiagnosticText(message), ...updates });
  return Object.assign(new Error(message), { statusCode, serverDiagnostic: diagnostic });
}

function classifyOpenAIError(status, body) {
  const code = String(body?.error?.code || '');
  if (status === 401) return 'AUTHENTICATION';
  if (status === 403 || code === 'model_not_found') return 'MODEL_OR_PROJECT_ACCESS';
  if (status === 429 && code === 'insufficient_quota') return 'BILLING_OR_QUOTA';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 400 || status === 413 || status === 415) return 'MALFORMED_OR_UNSUPPORTED_REQUEST';
  if (status >= 500) return 'OPENAI_SERVER_ERROR';
  return 'OPENAI_API_ERROR';
}

export async function analyzeSemanticImage(body, { apiKey = process.env.OPENAI_API_KEY, fetchImpl = fetch, diagnostic = {}, timeoutMs = OPENAI_TIMEOUT_MS } = {}) {
  const fields = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
  const requiredFields = ['transactionId', 'imageHash', 'mimeType', 'imageBase64'];
  if (fields.length !== requiredFields.length || requiredFields.some(field => !fields.includes(field))) {
    throw diagnosticFailure(diagnostic, 'Request fields are invalid.', 400, 'C_REQUEST_BODY_PARSED', 'MALFORMED_REQUEST');
  }
  const transactionId = typeof body?.transactionId === 'string' ? body.transactionId : '';
  const imageHash = typeof body?.imageHash === 'string' ? body.imageHash.toLowerCase() : '';
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
  const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : '';
  markDiagnostic(diagnostic, 'C_REQUEST_BODY_PARSED', { requestId: transactionId || 'invalid', requestBodyParsed: true, imagePayloadFound: Boolean(imageBase64), imageMimeType: mimeType || 'unknown' });
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(transactionId) || !/^[a-f0-9]{64}$/.test(imageHash)) throw diagnosticFailure(diagnostic, 'Transaction identity is invalid.', 400, 'C_REQUEST_BODY_PARSED', 'MALFORMED_REQUEST');
  if (!IMAGE_TYPES.has(mimeType)) throw diagnosticFailure(diagnostic, 'Unsupported image type.', 415, 'D_IMAGE_PAYLOAD_FOUND', 'UNSUPPORTED_IMAGE_TYPE');
  if (!imageBase64 || imageBase64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(imageBase64)) {
    throw diagnosticFailure(diagnostic, 'Image payload is invalid.', 400, 'D_IMAGE_PAYLOAD_FOUND', 'INVALID_IMAGE_PAYLOAD', { imagePayloadFound: Boolean(imageBase64) });
  }
  let bytes;
  try { bytes = Buffer.from(imageBase64, 'base64'); } catch { throw diagnosticFailure(diagnostic, 'Image payload is invalid.', 400, 'D_IMAGE_PAYLOAD_FOUND', 'INVALID_IMAGE_PAYLOAD'); }
  markDiagnostic(diagnostic, 'D_IMAGE_PAYLOAD_FOUND', { imagePayloadFound: true, imagePayloadNonEmpty: bytes.length > 0, imageByteLength: bytes.length, imageMimeType: mimeType, imageHashShort: imageHash.slice(0, 12) });
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw diagnosticFailure(diagnostic, 'Image payload size is unsupported.', 413, 'D_IMAGE_PAYLOAD_FOUND', 'REQUEST_TOO_LARGE', { imageByteLength: bytes.length });
  if (bytes.toString('base64') !== imageBase64) throw diagnosticFailure(diagnostic, 'Image payload is invalid.', 400, 'D_IMAGE_PAYLOAD_FOUND', 'INVALID_IMAGE_PAYLOAD');
  const signatures = {
    'image/jpeg': bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    'image/png': bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/webp': bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
    'image/gif': bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')
  };
  if (!signatures[mimeType]) throw diagnosticFailure(diagnostic, 'Image content does not match its declared type.', 415, 'E_IMAGE_PAYLOAD_VALID', 'INVALID_IMAGE_PAYLOAD');
  if (createHash('sha256').update(bytes).digest('hex') !== imageHash) throw diagnosticFailure(diagnostic, 'Server image hash verification failed.', 409, 'E_IMAGE_PAYLOAD_VALID', 'IMAGE_HASH_MISMATCH');
  markDiagnostic(diagnostic, 'E_IMAGE_PAYLOAD_VALID', { imagePayloadValid: true });

  if (!apiKey) throw diagnosticFailure(diagnostic, 'Semantic analyzer is not configured on the server.', 503, 'F_OPENAI_CONFIGURATION', 'CONFIGURATION', { openaiCredentialConfigured: false });
  markDiagnostic(diagnostic, 'F_OPENAI_CONFIGURATION', { openaiCredentialConfigured: true });

  const prompt = `Analyze only the pixels of this current image. Do not use filenames, metadata, prior images, or OCR words as proof of automotive content. Return exactly one category. AUTOMOTIVE_GRAPH requires multiple independent visible graph indicators such as axes or gridlines plus plotted traces, repeated scale markings, panels, legends, or time-series structure. AUTOMOTIVE_COMPONENT_OR_VEHICLE requires positive visible automotive subjects such as a vehicle, brake/engine/suspension component, connector, wiring, dashboard, scan tool, or diagnostic equipment. General photos of animals, people, food, furniture, scenery, or buildings without automotive evidence are GENERAL_NON_AUTOMOTIVE_PHOTO. Documents, screenshots, wiring diagrams, invoices, text screens, and data tables are DOCUMENT_OR_TEXT_SCREENSHOT. Use UNKNOWN_OR_ANALYSIS_UNAVAILABLE when visual evidence is inadequate or conflicting. Evidence and object names must describe visible pixel-supported content. Confidence must reflect the genuine visual classification; use null if a defensible value is unavailable.`;
  markDiagnostic(diagnostic, 'G_OPENAI_REQUEST_CONSTRUCTED', { openaiRequestConstructed: true, openaiModel: MODEL, payloadImageCount: 1 });
  const openAIStartedAt = Date.now();
  const analysisSignal = AbortSignal.timeout(timeoutMs);
  let openAIResponse;
  try {
    markDiagnostic(diagnostic, 'H_OPENAI_API_CONTACTED', { openaiRequestAttempted: true, openaiResponseReceived: false });
    openAIResponse = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        max_output_tokens: 1400,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' }] }],
        text: { format: { type: 'json_schema', name: 'nitros_image_semantics', strict: true, schema: semanticSchema } }
      }),
      signal: analysisSignal
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timed out|timeout/i.test(String(error?.message || ''));
    markDiagnostic(diagnostic, 'H_OPENAI_API_CONTACTED', { success: false, openaiRequestAttempted: true, openaiResponseReceived: false, openaiElapsedMs: Math.max(0, Date.now() - openAIStartedAt), errorCategory: timedOut ? 'OPENAI_TIMEOUT' : 'OPENAI_NETWORK_ERROR', errorType: sanitizeDiagnosticText(error?.name), errorCode: sanitizeDiagnosticText(error?.code), errorMessage: timedOut ? 'Semantic analysis timeout.' : sanitizeDiagnosticText(error?.message) });
    console.error('OpenAI transport failure', {
      errorName: sanitizeDiagnosticText(error?.name),
      errorMessage: sanitizeDiagnosticText(error?.message),
      errorCode: sanitizeDiagnosticText(error?.code),
      causeName: sanitizeDiagnosticText(error?.cause?.name),
      causeCode: sanitizeDiagnosticText(error?.cause?.code),
      causeMessage: sanitizeDiagnosticText(error?.cause?.message),
      elapsedMs: Math.max(0, Date.now() - openAIStartedAt),
      responseReceived: false
    });
    throw Object.assign(error, { statusCode: 502, serverDiagnostic: diagnostic });
  }
  const transportStatus = openAIResponse.status;
  const responseBody = await openAIResponse.json().catch(() => null);
  markDiagnostic(diagnostic, 'I_OPENAI_RESPONSE_RECEIVED', { openaiResponseReceived: true, openaiResponseOk: openAIResponse.ok, openaiHttpStatus: transportStatus, openaiElapsedMs: Math.max(0, Date.now() - openAIStartedAt) });
  console.info('OpenAI upstream response', {
    upstreamStatus: transportStatus,
    errorType: sanitizeDiagnosticText(responseBody?.error?.type),
    errorCode: sanitizeDiagnosticText(responseBody?.error?.code)
  });
  if (!openAIResponse.ok) {
    const safeMessage = responseBody?.error?.message || `OpenAI request failed with HTTP ${transportStatus}.`;
    throw diagnosticFailure(diagnostic, safeMessage, 502, 'I_OPENAI_RESPONSE_RECEIVED', classifyOpenAIError(transportStatus, responseBody), { openaiRequestAttempted: true, openaiResponseReceived: true, openaiHttpStatus: transportStatus, errorType: sanitizeDiagnosticText(responseBody?.error?.type), errorCode: sanitizeDiagnosticText(responseBody?.error?.code), transportStatus });
  }
  if (!responseBody) throw diagnosticFailure(diagnostic, 'OpenAI response was not valid JSON.', 502, 'J_OPENAI_RESPONSE_PARSED', 'UNEXPECTED_OPENAI_RESPONSE', { openaiResponseParsed: false, transportStatus });
  markDiagnostic(diagnostic, 'J_OPENAI_RESPONSE_PARSED', { openaiResponseParsed: true });
  let parsed;
  try { parsed = JSON.parse(extractOutputText(responseBody)); } catch (error) { throw diagnosticFailure(diagnostic, `Malformed semantic response: ${error.message}`, 502, 'K_SEMANTIC_OUTPUT_EXTRACTED', 'UNEXPECTED_OPENAI_RESPONSE', { semanticOutputPresent: false, transportStatus }); }
  let semanticResult;
  try { semanticResult = validateSemanticPayload(parsed); }
  catch (error) { throw diagnosticFailure(diagnostic, `Malformed semantic response: ${error.message}`, 502, 'K_SEMANTIC_OUTPUT_EXTRACTED', 'UNEXPECTED_OPENAI_RESPONSE', { semanticOutputPresent: false, transportStatus }); }
  markDiagnostic(diagnostic, 'K_SEMANTIC_OUTPUT_EXTRACTED', { success: true, semanticOutputPresent: true, semanticObjectsReturned: semanticResult.objects.length, errorCategory: null, errorMessage: null });

  let componentIdentification = null;
  if (semanticResult.category === 'AUTOMOTIVE_COMPONENT_OR_VEHICLE') {
    const componentStartedAt = Date.now();
    const componentPrompt = `Identify the primary automotive component visible in this current image using only visible pixels. Do not use filenames, metadata, OCR text alone, prior images, prior cases, cached results, or the category confidence. Return the most specific component supported by visible evidence, its automotive system, secondary visible components, and pixel-supported evidence. Component confidence must be independent from category confidence. If the exact component is not visually defensible, use status UNCERTAIN, set primaryComponent to "Unable to determine exact component", list plausible alternatives only when visually supported, and explain what view or evidence is missing. Never force or invent a component.`;
    markDiagnostic(diagnostic, 'M_COMPONENT_REQUEST_CONSTRUCTED', { componentIdentificationAttempted: true, componentResponseReceived: false, componentResultPresent: false });
    try {
      const componentResponse = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          store: false,
          max_output_tokens: 1000,
          input: [{ role: 'user', content: [{ type: 'input_text', text: componentPrompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' }] }],
          text: { format: { type: 'json_schema', name: 'nitros_automotive_component', strict: true, schema: automotiveComponentSchema } }
        }),
        signal: analysisSignal
      });
      const componentBody = await componentResponse.json().catch(() => null);
      markDiagnostic(diagnostic, 'N_COMPONENT_RESPONSE_RECEIVED', { componentResponseReceived: true, componentResponseOk: componentResponse.ok, componentHttpStatus: componentResponse.status, componentElapsedMs: Math.max(0, Date.now() - componentStartedAt) });
      if (!componentResponse.ok) throw Object.assign(new Error(componentBody?.error?.message || `Component request failed with HTTP ${componentResponse.status}.`), { componentErrorCategory: classifyOpenAIError(componentResponse.status, componentBody), componentHttpStatus: componentResponse.status });
      if (!componentBody) throw new Error('Component response was not valid JSON.');
      const componentParsed = JSON.parse(extractOutputText(componentBody));
      componentIdentification = { ...validateAutomotiveComponent(componentParsed), semanticRequestId: transactionId, imageHash };
      markDiagnostic(diagnostic, 'O_COMPONENT_RESULT_EXTRACTED', { componentResponseParsed: true, componentResultPresent: true, componentConfidenceNormalized: componentIdentification.normalizedComponentConfidence !== null, componentStatus: componentIdentification.status, componentErrorCategory: null, componentErrorMessage: null });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timed out|timeout/i.test(String(error?.message || ''));
      const safeMessage = timedOut ? 'Specific component identification timeout.' : sanitizeDiagnosticText(error?.message) || 'Specific component identification failed.';
      componentIdentification = { status: 'FAILED', primaryComponent: 'Specific component identification failed', componentConfidence: null, rawComponentConfidence: null, normalizedComponentConfidence: null, system: null, secondaryComponents: [], supportingEvidence: [], possibleAlternatives: [], uncertaintyReason: safeMessage, semanticRequestId: transactionId, imageHash };
      markDiagnostic(diagnostic, 'O_COMPONENT_RESULT_FAILED', { componentIdentificationAttempted: true, componentResponseReceived: Boolean(diagnostic.componentResponseReceived), componentResponseParsed: false, componentResultPresent: false, componentConfidenceNormalized: false, componentErrorCategory: error?.componentErrorCategory || (timedOut ? 'OPENAI_TIMEOUT' : 'COMPONENT_ANALYSIS_ERROR'), componentErrorMessage: safeMessage, componentHttpStatus: error?.componentHttpStatus ?? diagnostic.componentHttpStatus ?? null, componentElapsedMs: Math.max(0, Date.now() - componentStartedAt) });
    }
  } else {
    markDiagnostic(diagnostic, 'K_SEMANTIC_OUTPUT_EXTRACTED', { componentIdentificationAttempted: false, componentIdentificationSkipped: true });
  }
  semanticResult.componentIdentification = componentIdentification;
  return {
    transactionId,
    imageHash,
    analyzer: `OpenAI ${MODEL}`,
    transportStatus,
    semanticResult,
    serverDiagnostic: diagnostic
  };
}
