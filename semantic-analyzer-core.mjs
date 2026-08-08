import { createHash } from 'node:crypto';

export const ALLOWED_CATEGORIES = Object.freeze([
  'AUTOMOTIVE_GRAPH',
  'AUTOMOTIVE_COMPONENT_OR_VEHICLE',
  'DOCUMENT_OR_TEXT_SCREENSHOT',
  'GENERAL_NON_AUTOMOTIVE_PHOTO',
  'UNKNOWN_OR_ANALYSIS_UNAVAILABLE'
]);

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o';

const semanticSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'confidence', 'objects', 'evidence', 'description', 'automotiveEvidence', 'graphEvidence', 'documentEvidence'],
  properties: {
    category: { type: 'string', enum: ALLOWED_CATEGORIES },
    confidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'null' }] },
    objects: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    evidence: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    description: { type: 'string', maxLength: 1200 },
    automotiveEvidence: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    graphEvidence: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    documentEvidence: { type: 'array', items: { type: 'string' }, maxItems: 16 }
  }
};

function cleanStringArray(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`Analyzer field ${field} is invalid.`);
  return value.map(item => item.trim()).filter(Boolean).slice(0, 24);
}

function validateSemanticPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Analyzer returned no structured semantic object.');
  if (!ALLOWED_CATEGORIES.includes(raw.category)) throw new Error('Analyzer returned an unsupported category.');
  if (raw.confidence !== null && (!Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 100)) throw new Error('Analyzer confidence is invalid.');
  const result = {
    category: raw.category,
    confidence: raw.confidence === null ? null : Math.round(raw.confidence),
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

export async function analyzeSemanticImage(body, { apiKey = process.env.OPENAI_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw Object.assign(new Error('Semantic analyzer is not configured on the server.'), { statusCode: 503 });
  const fields = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
  const requiredFields = ['transactionId', 'imageHash', 'mimeType', 'imageBase64'];
  if (fields.length !== requiredFields.length || requiredFields.some(field => !fields.includes(field))) {
    throw Object.assign(new Error('Request fields are invalid.'), { statusCode: 400 });
  }
  const transactionId = typeof body?.transactionId === 'string' ? body.transactionId : '';
  const imageHash = typeof body?.imageHash === 'string' ? body.imageHash.toLowerCase() : '';
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
  const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : '';
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(transactionId) || !/^[a-f0-9]{64}$/.test(imageHash)) throw Object.assign(new Error('Transaction identity is invalid.'), { statusCode: 400 });
  if (!IMAGE_TYPES.has(mimeType)) throw Object.assign(new Error('Unsupported image type.'), { statusCode: 415 });
  if (!imageBase64 || imageBase64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(imageBase64)) {
    throw Object.assign(new Error('Image payload is invalid.'), { statusCode: 400 });
  }
  let bytes;
  try { bytes = Buffer.from(imageBase64, 'base64'); } catch { throw Object.assign(new Error('Image payload is invalid.'), { statusCode: 400 }); }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('Image payload size is unsupported.'), { statusCode: 413 });
  if (bytes.toString('base64') !== imageBase64) throw Object.assign(new Error('Image payload is invalid.'), { statusCode: 400 });
  const signatures = {
    'image/jpeg': bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    'image/png': bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/webp': bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
    'image/gif': bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')
  };
  if (!signatures[mimeType]) throw Object.assign(new Error('Image content does not match its declared type.'), { statusCode: 415 });
  if (createHash('sha256').update(bytes).digest('hex') !== imageHash) throw Object.assign(new Error('Server image hash verification failed.'), { statusCode: 409 });

  const prompt = `Analyze only the pixels of this current image. Do not use filenames, metadata, prior images, or OCR words as proof of automotive content. Return exactly one category. AUTOMOTIVE_GRAPH requires multiple independent visible graph indicators such as axes or gridlines plus plotted traces, repeated scale markings, panels, legends, or time-series structure. AUTOMOTIVE_COMPONENT_OR_VEHICLE requires positive visible automotive subjects such as a vehicle, brake/engine/suspension component, connector, wiring, dashboard, scan tool, or diagnostic equipment. General photos of animals, people, food, furniture, scenery, or buildings without automotive evidence are GENERAL_NON_AUTOMOTIVE_PHOTO. Documents, screenshots, wiring diagrams, invoices, text screens, and data tables are DOCUMENT_OR_TEXT_SCREENSHOT. Use UNKNOWN_OR_ANALYSIS_UNAVAILABLE when visual evidence is inadequate or conflicting. Evidence and object names must describe visible pixel-supported content. Confidence must reflect the genuine visual classification; use null if a defensible value is unavailable.`;
  const openAIResponse = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      max_output_tokens: 1400,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' }] }],
      text: { format: { type: 'json_schema', name: 'nitros_image_semantics', strict: true, schema: semanticSchema } }
    })
  });
  const transportStatus = openAIResponse.status;
  const responseBody = await openAIResponse.json().catch(() => null);
  if (!openAIResponse.ok) {
    const safeMessage = responseBody?.error?.message || `OpenAI request failed with HTTP ${transportStatus}.`;
    throw Object.assign(new Error(safeMessage), { statusCode: 502, transportStatus });
  }
  let parsed;
  try { parsed = JSON.parse(extractOutputText(responseBody)); } catch (error) { throw Object.assign(new Error(`Malformed semantic response: ${error.message}`), { statusCode: 502, transportStatus }); }
  return {
    transactionId,
    imageHash,
    analyzer: `OpenAI ${MODEL}`,
    transportStatus,
    semanticResult: validateSemanticPayload(parsed)
  };
}
