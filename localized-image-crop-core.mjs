import sharp from 'sharp';

const MIN_REGION = 0.01;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function validateNormalizedRegion(region) {
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(region?.[key]));
  if (!values.every(Number.isFinite)) return null;
  let [x, y, width, height] = values;
  if (width <= 0 || height <= 0) return null;
  x = clamp(x, 0, 1); y = clamp(y, 0, 1);
  width = clamp(width, MIN_REGION, 1 - x); height = clamp(height, MIN_REGION, 1 - y);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function regionToPixels(region, sourceWidth, sourceHeight, padding = 0) {
  const normalized = validateNormalizedRegion(region);
  if (!normalized || !Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const expanded = {
    x: clamp(normalized.x - padding, 0, 1), y: clamp(normalized.y - padding, 0, 1),
    width: 0, height: 0
  };
  expanded.width = clamp(normalized.x + normalized.width + padding, 0, 1) - expanded.x;
  expanded.height = clamp(normalized.y + normalized.height + padding, 0, 1) - expanded.y;
  const left = Math.floor(expanded.x * sourceWidth), top = Math.floor(expanded.y * sourceHeight);
  const width = Math.max(1, Math.min(sourceWidth - left, Math.ceil(expanded.width * sourceWidth)));
  const height = Math.max(1, Math.min(sourceHeight - top, Math.ceil(expanded.height * sourceHeight)));
  return { left, top, width, height };
}

export async function createLocalizedCrops(sourceBytes, region) {
  const source = sharp(sourceBytes, { failOn: 'none' }).rotate();
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) throw new Error('Source image dimensions are unavailable.');
  const detailRegion = regionToPixels(region, metadata.width, metadata.height, 0.08);
  const contextRegion = regionToPixels(region, metadata.width, metadata.height, 0.24);
  if (!detailRegion || !contextRegion) throw new Error('Candidate region is invalid.');
  const detail = await sharp(sourceBytes, { failOn: 'none' }).rotate().extract(detailRegion).png().toBuffer();
  const context = await sharp(sourceBytes, { failOn: 'none' }).rotate().extract(contextRegion).png().toBuffer();
  const [detailMetadata, contextMetadata] = await Promise.all([sharp(detail).metadata(), sharp(context).metadata()]);
  if (!detailMetadata.width || !detailMetadata.height || !contextMetadata.width || !contextMetadata.height) throw new Error('Generated crop could not be decoded.');
  return { source: { width: metadata.width, height: metadata.height }, normalizedRegion: validateNormalizedRegion(region), detailRegion, contextRegion, detail, context, detailMetadata: { width: detailMetadata.width, height: detailMetadata.height }, contextMetadata: { width: contextMetadata.width, height: contextMetadata.height } };
}

export const localizedInspectionSchema = {
  type: 'object', additionalProperties: false,
  required: ['candidate_id', 'candidate_class', 'localized_visual_verification', 'connection_state', 'defect_state', 'confidence', 'evidence_observed', 'contradictory_evidence', 'visibility_limitations'],
  properties: {
    candidate_id: { type: 'string' }, candidate_class: { type: 'string' }, localized_visual_verification: { type: 'boolean' },
    connection_state: { type: 'string', enum: ['CONNECTED', 'DISCONNECTED', 'PARTIALLY_SEATED', 'NOT_APPLICABLE', 'UNCERTAIN'] },
    defect_state: { type: 'string', enum: ['CONFIRMED_VISIBLE_DEFECT', 'LIKELY_VISIBLE_DEFECT', 'NO_VISIBLE_DEFECT_CONFIRMED', 'UNCERTAIN'] },
    confidence: { anyOf: [{ type: 'number' }, { type: 'null' }] }, evidence_observed: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    contradictory_evidence: { type: 'array', items: { type: 'string' }, maxItems: 8 }, visibility_limitations: { type: 'array', items: { type: 'string' }, maxItems: 8 }
  }
};

export const candidateRegionSchema = { type: 'object', additionalProperties: false, required: ['candidates'], properties: { candidates: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['candidate_id', 'candidate_class', 'candidate_description', 'confidence', 'inspection_priority', 'region', 'region_basis'], properties: { candidate_id: { type: 'string' }, candidate_class: { type: 'string' }, candidate_description: { type: 'string' }, confidence: { anyOf: [{ type: 'number' }, { type: 'null' }] }, inspection_priority: { type: 'integer', minimum: 1, maximum: 6 }, region_basis: { type: 'string' }, region: { type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'], properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } } } } } } } };

export function validateLocalizedInspection(raw, candidate) {
  if (!raw || raw.candidate_id !== candidate.id || !['CONNECTED', 'DISCONNECTED', 'PARTIALLY_SEATED', 'NOT_APPLICABLE', 'UNCERTAIN'].includes(raw.connection_state) || !['CONFIRMED_VISIBLE_DEFECT', 'LIKELY_VISIBLE_DEFECT', 'NO_VISIBLE_DEFECT_CONFIRMED', 'UNCERTAIN'].includes(raw.defect_state)) throw new Error('Localized inspection result is invalid.');
  return { candidateId: candidate.id, candidateClass: String(raw.candidate_class || candidate.type), localizedVisualVerification: raw.localized_visual_verification === true, connectionState: raw.connection_state, defectState: raw.defect_state, confidence: Number.isFinite(raw.confidence) ? raw.confidence : null, evidenceObserved: Array.isArray(raw.evidence_observed) ? raw.evidence_observed.map(String).slice(0, 12) : [], contradictoryEvidence: Array.isArray(raw.contradictory_evidence) ? raw.contradictory_evidence.map(String).slice(0, 8) : [], visibilityLimitations: Array.isArray(raw.visibility_limitations) ? raw.visibility_limitations.map(String).slice(0, 8) : [] };
}
