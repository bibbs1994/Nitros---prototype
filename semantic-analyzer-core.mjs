import { createHash } from 'node:crypto';
import { visualObservationSchema, validateVisualObservation, mergeObservationWithCondition, rawVisualObservationPrompt, globalVisualSweepInstruction } from './visual-observation-core.mjs';
import { createLocalizedCrops, createWholeImageRegions, candidateRegionSchema, localizedInspectionSchema, validateLocalizedInspection, validateNormalizedRegion } from './localized-image-crop-core.mjs';

export const ALLOWED_CATEGORIES = Object.freeze([
  'AUTOMOTIVE_GRAPH',
  'AUTOMOTIVE_WIRING_DIAGRAM',
  'AUTOMOTIVE_COMPONENT_OR_VEHICLE',
  'DOCUMENT_OR_TEXT_SCREENSHOT',
  'GENERAL_NON_AUTOMOTIVE_PHOTO',
  'UNKNOWN_OR_ANALYSIS_UNAVAILABLE'
]);

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const OPENAI_TIMEOUT_MS = 120_000;
const COMPONENT_TIMEOUT_MS = 30_000;
const VISUAL_CONDITION_TIMEOUT_MS = 16_000;
const VISUAL_CONDITION_RETRY_TIMEOUT_MS = 8_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
// Kept isolated so a later cost tier can change one policy without rewriting
// the inspection pipeline. These are current Responses API request fields.
const MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-sol';
const DEEP_VISION_REASONING = Object.freeze({ effort: 'max', mode: 'pro' });
const DEEP_VISION_DETAIL = 'original';
const deepVisionRequest = (request) => ({ ...request, model: MODEL, reasoning: DEEP_VISION_REASONING });

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

const automotiveGraphSchema = {
  type: 'object', additionalProperties: false,
  required: ['status','confidence','observed','interpretation','diagnosticSignificance','nextTest','pidNames','sensorNames','valuesAndScales','traceFindings','unreadableOrUncertain','visibleVehicle'],
  properties: {
    status: { type: 'string', enum: ['READY','PARTIAL','UNREADABLE'] },
    confidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'string', pattern: '^\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%?\\s*$' }, { type: 'null' }] },
    observed: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    interpretation: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    diagnosticSignificance: { type: 'string', enum: ['NORMAL_OR_EXPECTED','MILDLY_ABNORMAL','SIGNIFICANT','INCONCLUSIVE','INDETERMINATE'] },
    nextTest: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    pidNames: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    sensorNames: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    valuesAndScales: { type: 'array', description: 'Every genuinely readable numeric PID role. For Engine Speed, Engine Speed (RPM), Engine RPM, or RPM, inspect the complete PID-local region and emit separate canonical entries for Engine Speed Min, Engine Speed Current, and Engine Speed Max whenever visible. Do not stop at Current, copy Current into Min/Max, use Vehicle Speed, or borrow an adjacent PID value. Omit and mark uncertain any role not supported by visible source evidence.', items: { type: 'string' }, maxItems: 24 },
    traceFindings: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    unreadableOrUncertain: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    visibleVehicle: { type: 'object', additionalProperties: false, required: ['description','evidence'], properties: {
      description: { type: 'string', maxLength: 200 }, evidence: { type: 'array', items: { type: 'string' }, maxItems: 8 }
    } }
  }
};

const targetedPidRecoverySchema = {
  type: 'object', additionalProperties: false, required: ['recoveries'], properties: {
    recoveries: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false,
      required: ['pidName','current','minimum','maximum','unit','visibleEvidence','status'], properties: {
        pidName: { type: 'string', maxLength: 120 },
        current: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        minimum: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        maximum: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        unit: { type: 'string', maxLength: 20 },
        visibleEvidence: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        status: { type: 'string', enum: ['RECOVERED','UNREADABLE'] }
      }
    } }
  }
};

const automotiveComponentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'primaryComponent', 'componentConfidence', 'system', 'secondaryComponents', 'supportingEvidence', 'possibleAlternatives', 'likelyConnectionsOrDestinations', 'uncertaintyReason', 'drivetrainDiscrimination'],
  properties: {
    status: { type: 'string', enum: ['IDENTIFIED', 'UNCERTAIN'] },
    primaryComponent: { type: 'string', maxLength: 160 },
    componentConfidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'string', pattern: '^\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%?\\s*$' }, { type: 'null' }] },
    system: { anyOf: [{ type: 'string', maxLength: 160 }, { type: 'null' }] },
    secondaryComponents: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    supportingEvidence: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    possibleAlternatives: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    likelyConnectionsOrDestinations: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    uncertaintyReason: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
    drivetrainDiscrimination: {
      type: 'object', additionalProperties: false,
      required: ['applicable', 'candidateType', 'engineConnection', 'transmissionConnection', 'longitudinalShafts', 'lateralAxleOutputs', 'axleTubes', 'location', 'powerFlowRole', 'distinguishingFeaturesComplete', 'evidence', 'competingCandidate'],
      properties: {
        applicable: { type: 'boolean' },
        candidateType: { type: 'string', enum: ['TRANSFER_CASE', 'DIFFERENTIAL', 'TRANSMISSION', 'TRANSAXLE', 'OTHER'] },
        engineConnection: { type: 'string', enum: ['VISIBLE', 'NOT_VISIBLE', 'UNKNOWN'] },
        transmissionConnection: { type: 'string', enum: ['VISIBLE', 'NOT_VISIBLE', 'UNKNOWN'] },
        longitudinalShafts: { type: 'string', enum: ['NONE', 'ONE', 'MULTIPLE', 'UNKNOWN'] },
        lateralAxleOutputs: { type: 'string', enum: ['PRESENT', 'ABSENT', 'UNKNOWN'] },
        axleTubes: { type: 'string', enum: ['PRESENT', 'ABSENT', 'UNKNOWN'] },
        location: { type: 'string', enum: ['ENGINE_ATTACHED', 'VEHICLE_CENTERLINE', 'AXLE_POSITION', 'TRANSVERSE_DRIVETRAIN', 'UNKNOWN'] },
        powerFlowRole: { type: 'string', enum: ['PRIMARY_GEARBOX', 'TORQUE_DISTRIBUTION', 'FINAL_DRIVE', 'INTEGRATED_GEARBOX_FINAL_DRIVE', 'UNKNOWN'] },
        distinguishingFeaturesComplete: { type: 'boolean' },
        evidence: { type: 'array', items: { type: 'string' }, maxItems: 12 },
        competingCandidate: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] }
      }
    }
  }
};

const visualConditionInspectionSchema = {
  type: 'object', additionalProperties: false,
  required: ['status','conditionConfidence','observedCondition','possibleConcerns','connectionAssessments','noVisibleConcernMessage','unableToInspectReason','visibleEvidence','recommendedVerification','safetyDrivabilityImpact'],
  properties: {
    status: { type: 'string', enum: ['OBSERVED_CONDITION','POSSIBLE_CONCERN_DETECTED','UNVERIFIED_CONDITION','NO_VISIBLE_CONCERN_DETECTED','UNABLE_TO_INSPECT'] },
    conditionConfidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'string', pattern: '^\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%?\\s*$' }, { type: 'null' }] },
    observedCondition: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 },
    possibleConcerns: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['location','appearance','physicalConfirmationRequired','recommendedVerification'], properties: {
      location: { type: 'string', maxLength: 240 }, appearance: { type: 'string', maxLength: 500 }, physicalConfirmationRequired: { type: 'boolean' }, recommendedVerification: { type: 'string', maxLength: 500 }
    } }, maxItems: 8 },
    connectionAssessments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['location','seatingStatus','findingType','severity','findingConfidence','visibleEvidence','matingComponentVisible','directDamageVisible','missingContext','recommendedVerification','safetyDrivabilityImpact'], properties: {
      location: { type: 'string', maxLength: 240 }, seatingStatus: { type: 'string', enum: ['SEPARATION_OR_GAP_VISIBLE','POSSIBLE_IMPROPER_SEATING','NO_GAP_OR_SEPARATION_VISIBLE','NOT_RELIABLY_VISIBLE','COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE'] }, findingType: { type: 'string', enum: ['CLEAR_DEFECT','POSSIBLE_CONCERN','UNVERIFIED_CONDITION','RESIDUE_OR_STAINING','SEATING_NOT_RELIABLY_VISIBLE','NO_DEFECT_VISIBLE'] }, severity: { type: 'string', enum: ['CRITICAL','HIGH','MODERATE','LOW','UNDETERMINED'] }, findingConfidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'string', pattern: '^\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%?\\s*$' }, { type: 'null' }] }, visibleEvidence: { type: 'string', maxLength: 500 }, matingComponentVisible: { type: 'boolean' }, directDamageVisible: { type: 'boolean' }, missingContext: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] }, recommendedVerification: { type: 'string', maxLength: 500 }, safetyDrivabilityImpact: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] }
    } }, maxItems: 12 },
    noVisibleConcernMessage: { type: 'string', maxLength: 240 },
    unableToInspectReason: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
    visibleEvidence: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 16 },
    recommendedVerification: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 8 },
    safetyDrivabilityImpact: { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] }
  }
};

const vehicleAreaRelationshipSchema = {
  type: 'object', additionalProperties: false,
  required: ['status','vehicleAreaLocation','locationConfidence','locationEvidence','vehicleContextSupport','primaryVisibleAssembly','observedItems','expectedComponentCheck','whatPreventsConfirmation','recommendedNextPhotoVerification'],
  properties: {
    status: { type: 'string', enum: ['READY','INSUFFICIENT_CONTEXT'] },
    vehicleAreaLocation: { type: 'string', maxLength: 240 },
    locationConfidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'string', pattern: '^\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%?\\s*$' }, { type: 'null' }] },
    locationEvidence: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 },
    vehicleContextSupport: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 8 },
    primaryVisibleAssembly: { type: 'string', maxLength: 240 },
    observedItems: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['observedItem','itemLocationInImage','nearestIdentifiableAssembly','likelyRelationshipOrDestination','relationshipConfidence','intendedDestination','intendedRelationship','physicalConnectionState','physicalStateConfidence','visibleStateEvidence','visibleEvidence','vehicleContextEvidence','whatCannotBeConfirmed','recommendedNextPhotoVerification'], properties: {
      observedItem: { type: 'string', maxLength: 240 }, itemLocationInImage: { type: 'string', maxLength: 240 }, nearestIdentifiableAssembly: { type: 'string', maxLength: 240 }, likelyRelationshipOrDestination: { type: 'string', maxLength: 500 }, relationshipConfidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'string', pattern: '^\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%?\\s*$' }, { type: 'null' }] }, intendedDestination: { type: 'string', maxLength: 240 }, intendedRelationship: { type: 'string', maxLength: 500 }, physicalConnectionState: { type: 'string', enum: ['CONNECTED','DISCONNECTED','PARTIALLY_CONNECTED','LOOSE','CANNOT_VERIFY'] }, physicalStateConfidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'null' }] }, visibleStateEvidence: { type: 'string', maxLength: 500 }, visibleEvidence: { type: 'string', maxLength: 500 }, vehicleContextEvidence: { type: 'string', maxLength: 500 }, whatCannotBeConfirmed: { type: 'string', maxLength: 500 }, recommendedNextPhotoVerification: { type: 'string', maxLength: 500 }
    } } },
    expectedComponentCheck: { type: 'object', additionalProperties: false, required: ['expectedMajorComponents','visiblyAccountedFor','possibleMissingOrRemovedComponent','supportingVisualEvidence','vehicleContextSupport','confidence','whatPreventsConfirmation','recommendedTechnicianVerification','topologyInventory','missingAssemblyCandidates'], properties: {
      expectedMajorComponents:{type:'array',items:{type:'string',maxLength:240},maxItems:8}, visiblyAccountedFor:{type:'array',items:{type:'string',maxLength:240},maxItems:8}, possibleMissingOrRemovedComponent:{type:'string',maxLength:240}, supportingVisualEvidence:{type:'array',items:{type:'string',maxLength:500},maxItems:8}, vehicleContextSupport:{type:'array',items:{type:'string',maxLength:500},maxItems:8}, confidence:{anyOf:[{type:'number',minimum:0,maximum:100},{type:'null'}]}, whatPreventsConfirmation:{type:'string',maxLength:500}, recommendedTechnicianVerification:{type:'string',maxLength:500}, topologyInventory:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['component','expectedLocation','presenceStatus','evidence','confidence'],properties:{component:{type:'string',maxLength:240},expectedLocation:{type:'string',maxLength:240},presenceStatus:{type:'string',enum:['VISIBLY_PRESENT','PARTIALLY_VISIBLE','NOT_VISIBLE','POSSIBLY_MISSING_REMOVED','CANNOT_DETERMINE']},evidence:{type:'array',items:{type:'string',maxLength:500},maxItems:6},confidence:{anyOf:[{type:'number',minimum:0,maximum:100},{type:'null'}]}}}},missingAssemblyCandidates:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['component','expectedLocation','whyExpectedHere','supportingVisualEvidence','vehicleContextSupport','contradictoryEvidence','confidence','verificationStep'],properties:{component:{type:'string',maxLength:240},expectedLocation:{type:'string',maxLength:240},whyExpectedHere:{type:'string',maxLength:500},supportingVisualEvidence:{type:'array',items:{type:'string',maxLength:500},maxItems:6},vehicleContextSupport:{type:'array',items:{type:'string',maxLength:500},maxItems:6},contradictoryEvidence:{type:'array',items:{type:'string',maxLength:500},maxItems:6},confidence:{anyOf:[{type:'number',minimum:0,maximum:100},{type:'null'}]},verificationStep:{type:'string',maxLength:500}}}}
    } },
    whatPreventsConfirmation: { type: 'string', maxLength: 500 },
    recommendedNextPhotoVerification: { type: 'string', maxLength: 500 }
  }
};

const wiringDiagramSchema = {
  type: 'object', additionalProperties: false,
  required: ['status','circuitComponent','confidence','structuralEvidence','detectedComponents','connectorsAndPins','circuitPaths','fuses','relays','splices','wireDetails','importantObservations','unreadableFields','safetyWarning','testPlan'],
  properties: {
    status: { type: 'string', enum: ['READY','INSUFFICIENT_READABILITY'] },
    circuitComponent: { type: 'string', maxLength: 200 },
    confidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'string', pattern: '^\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%?\\s*$' }, { type: 'null' }] },
    structuralEvidence: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    detectedComponents: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    connectorsAndPins: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    circuitPaths: { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['label','path','function','functionConfirmed'], properties: {
      label: { type: 'string', maxLength: 80 }, path: { type: 'string', maxLength: 300 }, function: { type: 'string', maxLength: 200 }, functionConfirmed: { type: 'boolean' }
    } } },
    fuses: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    relays: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    splices: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    wireDetails: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    importantObservations: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    unreadableFields: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    safetyWarning: { anyOf: [{ type: 'string', maxLength: 600 }, { type: 'null' }] },
    testPlan: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['id','objective','tool','instructions','redLead','blackLead','connectorCondition','operatingCondition','loaded','expectedBehavior','evaluationType','expectedMin','expectedMax','specificationSource','nextOnPass','nextOnFail','passConclusion','failConclusion'], properties: {
      id: { type: 'string', maxLength: 40 }, objective: { type: 'string', maxLength: 200 }, tool: { type: 'string', maxLength: 120 }, instructions: { type: 'string', maxLength: 700 }, redLead: { type: 'string', maxLength: 240 }, blackLead: { type: 'string', maxLength: 240 }, connectorCondition: { type: 'string', maxLength: 160 }, operatingCondition: { type: 'string', maxLength: 160 }, loaded: { type: 'boolean' }, expectedBehavior: { type: 'string', maxLength: 300 }, evaluationType: { type: 'string', enum: ['POWER_PRESENT','GROUND_GOOD','CONTROL_PRESENT','SIGNAL_PRESENT','CONTINUITY_GOOD','VOLTAGE_DROP_LOW','OBSERVATION'] }, expectedMin: { anyOf: [{ type: 'number' }, { type: 'null' }] }, expectedMax: { anyOf: [{ type: 'number' }, { type: 'null' }] }, specificationSource: { type: 'string', enum: ['DIAGRAM','ELECTRICAL_PRINCIPLE','TECHNICIAN_SPEC','NONE'] }, nextOnPass: { anyOf: [{ type: 'integer', minimum: 0, maximum: 7 }, { type: 'null' }] }, nextOnFail: { anyOf: [{ type: 'integer', minimum: 0, maximum: 7 }, { type: 'null' }] }, passConclusion: { type: 'string', enum: ['CONTINUE','COMPONENT_PASSES_CURRENT_TESTS','VERIFIED_COMPONENT_FAILURE','VERIFIED_POWER_SUPPLY_FAULT','VERIFIED_GROUND_FAULT','VERIFIED_CONTROL_CIRCUIT_FAULT','VERIFIED_SIGNAL_CIRCUIT_FAULT','POSSIBLE_MODULE_DRIVER_FAULT_FURTHER_TESTING_REQUIRED','INSUFFICIENT_EVIDENCE'] }, failConclusion: { type: 'string', enum: ['CONTINUE','COMPONENT_PASSES_CURRENT_TESTS','VERIFIED_COMPONENT_FAILURE','VERIFIED_POWER_SUPPLY_FAULT','VERIFIED_GROUND_FAULT','VERIFIED_CONTROL_CIRCUIT_FAULT','VERIFIED_SIGNAL_CIRCUIT_FAULT','POSSIBLE_MODULE_DRIVER_FAULT_FURTHER_TESTING_REQUIRED','INSUFFICIENT_EVIDENCE'] }
    } } }
  }
};

const documentRepairInformationSchema = {
  type: 'object', additionalProperties: false,
  required: ['status','dtcApplicability','dtcs','testName','componentOrCircuit','testLocation','method','criterion','criterionEvidence','requestedResult','comparator','minimum','maximum','visibleTextEvidence','missingRequiredFields'],
  properties: {
    status: { type: 'string', enum: ['COMPLETE','INCOMPLETE','UNREADABLE'] },
    dtcApplicability: { type: 'string', enum: ['APPLICABLE','NOT APPLICABLE','UNKNOWN / CANNOT DETERMINE'] },
    dtcs: { type: 'array', items: { type: 'string', pattern: '^[PCBU][0-9A-F]{4}$' }, maxItems: 16 },
    testName: { type: 'string', maxLength: 200 },
    componentOrCircuit: { type: 'string', maxLength: 300 },
    testLocation: { type: 'string', maxLength: 400 },
    method: { type: 'string', maxLength: 700 },
    criterion: { type: 'string', maxLength: 300 },
    criterionEvidence: { type: 'string', maxLength: 500 },
    requestedResult: { type: 'string', maxLength: 300 },
    comparator: { type: 'string', enum: ['','<=','>=','range'] },
    minimum: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    maximum: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    visibleTextEvidence: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    missingRequiredFields: { type: 'array', items: { type: 'string', enum: ['DTC applicability','component or circuit','test location','test method','criterion','requested technician result'] }, maxItems: 6 }
  }
};

export function assertStrictOutputSchema(schema, path = '$') {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object' || schema.properties) {
    if (schema.additionalProperties !== false) throw new Error(`${path} must set additionalProperties to false.`);
    const propertyKeys = Object.keys(schema.properties || {}), required = schema.required;
    if (!Array.isArray(required)) throw new Error(`${path}.required must be an array containing every property key.`);
    const requiredKeys = new Set(required);
    const missing = propertyKeys.filter(key => !requiredKeys.has(key));
    const extra = required.filter(key => !propertyKeys.includes(key));
    if (missing.length || extra.length) throw new Error(`${path}.required must exactly match properties; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}.`);
    Object.entries(schema.properties || {}).forEach(([key, value]) => assertStrictOutputSchema(value, `${path}.properties.${key}`));
  }
  if (schema.items) assertStrictOutputSchema(schema.items, `${path}.items`);
  if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((value, index) => assertStrictOutputSchema(value, `${path}.anyOf[${index}]`));
}

export const STRICT_OUTPUT_SCHEMAS = Object.freeze({ semanticSchema, automotiveGraphSchema, targetedPidRecoverySchema, automotiveComponentSchema, visualConditionInspectionSchema, vehicleAreaRelationshipSchema, wiringDiagramSchema, documentRepairInformationSchema });
Object.entries(STRICT_OUTPUT_SCHEMAS).forEach(([name, schema]) => assertStrictOutputSchema(schema, name));

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

function wiringEntries(value) {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value.split(/\s*(?:->|→)\s*/).map(item => item.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(wiringEntries);
  if (typeof value === 'object') {
    for (const key of ['path','steps','nodes','components','testPoints','connectors']) if (value[key] !== undefined) return wiringEntries(value[key]);
    return [value];
  }
  return [];
}

export function normalizeWiringField(value) {
  return wiringEntries(value).map(entry => {
    if (typeof entry === 'string') return { component: entry.slice(0, 160), terminal: '', wire: '', circuit: '', voltageExpected: '', description: '' };
    const text = key => typeof entry?.[key] === 'string' || typeof entry?.[key] === 'number' ? String(entry[key]).trim() : '';
    const component = text('component') || text('name') || text('label') || text('node');
    const terminal = text('terminal') || text('pin');
    const wire = text('wire') || text('wireColor') || text('color');
    const circuit = text('circuit') || text('circuitId');
    const voltageExpected = text('voltageExpected') || text('expectedVoltage') || text('expected');
    const description = text('description') || text('detail');
    if (![component,terminal,wire,circuit,voltageExpected,description].some(Boolean)) return null;
    return { component: component.slice(0, 160), terminal: terminal.slice(0, 100), wire: wire.slice(0, 100), circuit: circuit.slice(0, 120), voltageExpected: voltageExpected.slice(0, 120), description: description.slice(0, 300) };
  }).filter(Boolean).slice(0, 24);
}

function tolerantWiringStrings(value) {
  return normalizeWiringField(value).map(node => node.component || node.description || [node.terminal,node.wire,node.circuit,node.voltageExpected].filter(Boolean).join(' — ')).filter(Boolean);
}

function validateAutomotiveComponent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Component analyzer returned no structured result.');
  if (!['IDENTIFIED', 'UNCERTAIN'].includes(raw.status)) throw new Error('Component analyzer status is invalid.');
  const primaryComponent = typeof raw.primaryComponent === 'string' ? raw.primaryComponent.trim().slice(0, 160) : '';
  if (!primaryComponent) throw new Error('Component analyzer returned no primary identification state.');
  let normalizedConfidence = normalizeSemanticConfidence(raw.componentConfidence);
  const drivetrain = raw.drivetrainDiscrimination;
  if (!drivetrain || typeof drivetrain !== 'object' || Array.isArray(drivetrain)) throw new Error('Drivetrain discrimination result is missing.');
  const drivetrainTypes = ['TRANSFER_CASE', 'DIFFERENTIAL', 'TRANSMISSION', 'TRANSAXLE'];
  const drivetrainEvidence = cleanStringArray(drivetrain.evidence, 'drivetrainDiscrimination.evidence').slice(0, 12);
  const primaryKey = primaryComponent.toLowerCase();
  const namedDrivetrainType = /transfer\s*case/.test(primaryKey) ? 'TRANSFER_CASE' : /transaxle/.test(primaryKey) ? 'TRANSAXLE' : /differential|final\s*drive/.test(primaryKey) ? 'DIFFERENTIAL' : /transmission/.test(primaryKey) ? 'TRANSMISSION' : null;
  if (drivetrainTypes.includes(drivetrain.candidateType) && !drivetrain.applicable) throw new Error('Drivetrain candidate was not discrimination-checked.');
  if (namedDrivetrainType && drivetrain.candidateType !== namedDrivetrainType) throw new Error('Primary drivetrain identification conflicts with the discrimination result.');
  if (drivetrain.applicable && !drivetrainEvidence.length) throw new Error('Drivetrain discrimination has no spatial evidence.');
  if (drivetrain.applicable && !drivetrain.distinguishingFeaturesComplete && normalizedConfidence !== null) normalizedConfidence = Math.min(84, normalizedConfidence);
  const likelyConnectionsOrDestinations = Array.isArray(raw.likelyConnectionsOrDestinations) ? cleanStringArray(raw.likelyConnectionsOrDestinations, 'likelyConnectionsOrDestinations').slice(0, 8) : [];
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
    likelyConnectionsOrDestinations,
    uncertaintyReason: typeof raw.uncertaintyReason === 'string' ? raw.uncertaintyReason.trim().slice(0, 500) || null : null,
    drivetrainDiscrimination: {
      applicable: Boolean(drivetrain.applicable),
      candidateType: drivetrainTypes.includes(drivetrain.candidateType) ? drivetrain.candidateType : 'OTHER',
      engineConnection: String(drivetrain.engineConnection || 'UNKNOWN'),
      transmissionConnection: String(drivetrain.transmissionConnection || 'UNKNOWN'),
      longitudinalShafts: String(drivetrain.longitudinalShafts || 'UNKNOWN'),
      lateralAxleOutputs: String(drivetrain.lateralAxleOutputs || 'UNKNOWN'),
      axleTubes: String(drivetrain.axleTubes || 'UNKNOWN'),
      location: String(drivetrain.location || 'UNKNOWN'),
      powerFlowRole: String(drivetrain.powerFlowRole || 'UNKNOWN'),
      distinguishingFeaturesComplete: Boolean(drivetrain.distinguishingFeaturesComplete),
      evidence: drivetrainEvidence,
      competingCandidate: typeof drivetrain.competingCandidate === 'string' ? drivetrain.competingCandidate.trim().slice(0, 120) || null : null
    }
  };
  // A wire or connector can suggest where a component normally connects, but it is not
  // the component housing. Keep that inference separate and prevent a confident starter
  // identification when the returned evidence only describes its wiring.
  if (/\bstarter(?:\s+(?:motor|assembly|solenoid))?\b/i.test(result.primaryComponent)) {
    const definingStarterFeature = /\b(?:starter\s+(?:housing|body|motor|case)|motor\s+housing|solenoid\s+(?:housing|body)|pinion|starter\s+mount(?:ing)?|bellhousing\s+mount(?:ing)?)\b/i;
    const evidenceText = result.supportingEvidence.join(' ');
    if (!definingStarterFeature.test(evidenceText)) {
      result.status = 'UNCERTAIN';
      result.primaryComponent = 'Starter assembly cannot be confirmed from this image';
      result.componentConfidence = result.normalizedComponentConfidence = result.normalizedComponentConfidence === null ? null : Math.min(45, result.normalizedComponentConfidence);
      result.possibleAlternatives = [...new Set([...result.possibleAlternatives, 'Disconnected starter power or exciter wiring; starter assembly may be removed, outside the frame, or obscured'])].slice(0, 8);
      result.likelyConnectionsOrDestinations = [...new Set([...result.likelyConnectionsOrDestinations, 'Visible heavy-gauge cable and smaller connector may normally connect to a starter/starter solenoid, but the destination is not confirmed'])].slice(0, 8);
      result.uncertaintyReason = 'The image evidence identifies wiring only; no starter housing or defining mounting/solenoid features are visibly supported.';
    }
  }
  if (/\btransmission\b/i.test(result.primaryComponent) && !/\b(?:transmission|gearbox|bellhousing|transmission pan|cooler lines?|shift mechanism)\b/i.test(result.supportingEvidence.join(' '))) {
    result.status = 'UNCERTAIN';
    result.primaryComponent = 'Transmission cannot be confirmed from this image';
    result.componentConfidence = result.normalizedComponentConfidence = result.normalizedComponentConfidence === null ? null : Math.min(45, result.normalizedComponentConfidence);
    result.uncertaintyReason = 'No defining transmission housing, bellhousing, pan, cooler-line, or shift-mechanism evidence is visibly supported.';
  }
  if (result.status === 'UNCERTAIN' && /\b(?:transmission|gearbox|engine(?:\s+block)?)\b/i.test(result.primaryComponent)) {
    result.primaryComponent = 'Drivetrain housing — exact assembly not confirmed';
    result.componentConfidence = result.normalizedComponentConfidence = result.normalizedComponentConfidence === null ? null : Math.min(45, result.normalizedComponentConfidence);
    result.uncertaintyReason = result.uncertaintyReason || 'Visible housing geometry does not establish one exact drivetrain assembly.';
  }
  if (result.status === 'IDENTIFIED' && !result.supportingEvidence.length) throw new Error('Component identification has no visible supporting evidence.');
  if (result.status === 'UNCERTAIN' && !result.uncertaintyReason) throw new Error('Component uncertainty reason is missing.');
  return result;
}

function deriveGeneralVehicleArea(evidence) {
  const text = String(evidence || '');
  if (/\b(?:battery|battery terminal|positive terminal|negative terminal)\b/i.test(text)) return 'Battery area';
  if (/\b(?:dashboard|instrument panel|steering column|interior)\b/i.test(text)) return 'Interior/dashboard area';
  if (/\b(?:wheel hub|wheel bearing|knuckle|ball joint|tie rod|cv boot|abs sensor)\b/i.test(text)) return 'Wheel-end / suspension area';
  if (/\b(?:underbody|propeller shaft|driveshaft|differential|transfer case)\b/i.test(text)) return 'Underbody / drivetrain area';
  if (/\b(?:intake manifold|throttle body|air intake|charge pipe|intercooler)\b/i.test(text)) return 'Intake side of engine';
  if (/\b(?:exhaust manifold|egr|oxygen sensor|catalyst|turbocharger|heat shield)\b/i.test(text)) return 'Exhaust side of engine';
  if (/\b(?:engine|underhood|hose|connector|wiring harness|vacuum line|coolant)\b/i.test(text)) return 'Engine compartment';
  return 'Automotive component area visible; precise vehicle position uncertain.';
}

function deriveRelationshipPhotoGuidance(state, evidence = '') {
  const text = String(evidence || '');
  if (state === 'DISCONNECTED' && /\b(?:connector|socket|terminal|plug|wiring)\b/i.test(text)) return 'Capture the connector and component-side electrical receptacle together at close range so the matching socket and physical disengagement are visible.';
  if (state === 'PARTIALLY_CONNECTED') return 'Capture the complete mating interface and retention feature from a closer side angle to verify insertion depth and latch engagement.';
  if (state === 'DISCONNECTED' && /\b(?:hose|line|pipe|port|nipple|fitting)\b/i.test(text)) return 'Capture the hose or line end and corresponding port from an angle showing both mating surfaces.';
  if (/\b(?:mount|bracket|fastener|attachment|retainer)\b/i.test(text)) return 'Capture the component mounting point and surrounding attachment from a closer angle.';
  return 'Capture additional angles of the area if verification of hidden connections or mounting points is required.';
}

export function validateVehicleAreaRelationship(raw, context = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !['READY','INSUFFICIENT_CONTEXT'].includes(raw.status)) throw new Error('Vehicle-area relationship analysis returned no valid structured result.');
  const itemText = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const component = context.componentIdentification || {}, semantic = context.semanticResult || {}, observation = context.observation || {};
  const contextualEvidence = [...(raw.locationEvidence || []), ...(component.supportingEvidence || []), ...(component.secondaryComponents || []), ...(semantic.automotiveEvidence || []), ...(semantic.objects || []), ...(observation.objects || []).flatMap(item => [item?.type, item?.location, item?.evidence])].filter(Boolean).map(String);
  const semanticLocation = itemText(raw.vehicleAreaLocation, 240);
  const derivedLocation = deriveGeneralVehicleArea(contextualEvidence.join(' '));
  const usefulSemanticLocation = semanticLocation && !/^(?:location\s+)?(?:unknown|uncertain|not determined)$/i.test(semanticLocation);
  const vehicleAreaSource = usefulSemanticLocation ? 'semantic' : derivedLocation.startsWith('Automotive component area visible') ? 'fallback' : 'derived';
  const vehicleAreaLocation = usefulSemanticLocation ? semanticLocation : derivedLocation;
  const primaryVisibleAssembly = itemText(raw.primaryVisibleAssembly,240) || itemText(component.primaryComponent,240) || vehicleAreaLocation;
  const rawItems = Array.isArray(raw.observedItems) ? raw.observedItems.filter(item => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 8) : [];
  const observedItems = rawItems.map((item) => {
    const fallbackEvidence = itemText(item.visibleStateEvidence,500) || itemText(item.visibleEvidence,500) || contextualEvidence[0]?.slice(0,500) || 'Visible automotive component geometry is present, but the complete mating interface is not shown.';
    const physicalConnectionState=['CONNECTED','DISCONNECTED','PARTIALLY_CONNECTED','LOOSE','CANNOT_VERIFY'].includes(item.physicalConnectionState)?item.physicalConnectionState:(hasVerifiedDisconnectionEvidence({visibleEvidence:fallbackEvidence})?'DISCONNECTED':'CANNOT_VERIFY');
    const observedItem=itemText(item.observedItem,240)||itemText(component.primaryComponent,240)||'Visible automotive component',itemLocationInImage=itemText(item.itemLocationInImage,240)||'Visible image area',nearestIdentifiableAssembly=itemText(item.nearestIdentifiableAssembly,240)||primaryVisibleAssembly,likelyRelationshipOrDestination=itemText(item.likelyRelationshipOrDestination,500)||'Physical relationship to the nearest visible mating or mounting point',visibleEvidence=itemText(item.visibleEvidence,500)||fallbackEvidence,vehicleContextEvidence=itemText(item.vehicleContextEvidence,500),whatCannotBeConfirmed=itemText(item.whatCannotBeConfirmed,500)||'The complete mating, routing, or mounting relationship is not visible from this angle.',recommendedNextPhotoVerification=itemText(item.recommendedNextPhotoVerification,500)||deriveRelationshipPhotoGuidance(physicalConnectionState,`${observedItem} ${visibleEvidence}`),relationshipConfidence=normalizeSemanticConfidence(item.relationshipConfidence),intendedDestination=itemText(item.intendedDestination,240)||nearestIdentifiableAssembly,intendedRelationship=itemText(item.intendedRelationship,500)||likelyRelationshipOrDestination,physicalStateConfidence=normalizeSemanticConfidence(item.physicalStateConfidence)??relationshipConfidence,visibleStateEvidence=itemText(item.visibleStateEvidence,500)||visibleEvidence;
    return { observedItem,itemLocationInImage,nearestIdentifiableAssembly,likelyRelationshipOrDestination,intendedDestination,intendedRelationship,physicalConnectionState,physicalStateConfidence,visibleStateEvidence,relationshipConfidence,visibleEvidence,vehicleContextEvidence,whatCannotBeConfirmed,recommendedNextPhotoVerification };
  });
  const gap=raw.expectedComponentCheck||{},visual=cleanStringArray(gap.supportingVisualEvidence||[],'expectedComponentCheck.supportingVisualEvidence').slice(0,8),support=cleanStringArray(gap.vehicleContextSupport||[],'expectedComponentCheck.vehicleContextSupport').slice(0,8),possible=itemText(gap.possibleMissingOrRemovedComponent,240),evidenceClasses=[visual.length>0,support.length>0].filter(Boolean).length,mountingSiteVisible=/\b(?:empty|unoccupied|vacant)\b[^.]{0,100}\b(?:mounting|mount|bracket|hole|boss|socket)\b|\b(?:mounting|mount|bracket|hole|boss|socket)\b[^.]{0,100}\b(?:empty|unoccupied|vacant|no\s+(?:sensor|component))\b/i.test(visual.join(' ')),missingConfirmed=evidenceClasses>=2&&mountingSiteVisible&&possible,expectedComponentCheck={expectedMajorComponents:cleanStringArray(gap.expectedMajorComponents||[],'expectedComponentCheck.expectedMajorComponents').slice(0,8),visiblyAccountedFor:cleanStringArray(gap.visiblyAccountedFor||[],'expectedComponentCheck.visiblyAccountedFor').slice(0,8),possibleMissingOrRemovedComponent:missingConfirmed?possible:'No visually supported missing component detected.',supportingVisualEvidence:missingConfirmed?visual:[],vehicleContextSupport:missingConfirmed?support:[],confidence:missingConfirmed?Math.min(normalizeSemanticConfidence(gap.confidence)??60,85):null,whatPreventsConfirmation:itemText(gap.whatPreventsConfirmation,500)||'No visually supported missing component can be confirmed from this image.',recommendedTechnicianVerification:itemText(gap.recommendedTechnicianVerification,500)||'Take a wider, well-lit image showing the mounting area and all nearby connectors.'};
  const locationEvidence=cleanStringArray(raw.locationEvidence||[],'vehicleArea.locationEvidence').slice(0,12),semanticGuidance=itemText(raw.recommendedNextPhotoVerification,500),derivedGuidance=observedItems.find(item=>item.recommendedNextPhotoVerification)?.recommendedNextPhotoVerification,photoGuidanceSource=semanticGuidance?'semantic':derivedGuidance?'derived':'fallback',relationshipSource=rawItems.length?'semantic':'fallback';
  const result={status:'READY',vehicleAreaLocation,locationConfidence:normalizeSemanticConfidence(raw.locationConfidence)??(vehicleAreaSource==='fallback'?null:60),locationEvidence:locationEvidence.length?locationEvidence:contextualEvidence.slice(0,12),vehicleContextSupport:cleanStringArray(raw.vehicleContextSupport||[],'vehicleArea.vehicleContextSupport').slice(0,8),primaryVisibleAssembly,observedItems,expectedComponentCheck,whatPreventsConfirmation:itemText(raw.whatPreventsConfirmation,500)||'Precise vehicle orientation or hidden mating relationships cannot be confirmed from this image.',recommendedNextPhotoVerification:semanticGuidance||derivedGuidance||deriveRelationshipPhotoGuidance('CANNOT_VERIFY',contextualEvidence.join(' ')),vehicleAreaSource,vehicleAreaReason:vehicleAreaSource==='semantic'?'Model supplied a usable generalized automotive area.':vehicleAreaSource==='derived'?'Generalized area derived from normalized component and scene evidence.':'Automotive content is visible but precise position is unsupported.',relationshipSource,relationshipReason:relationshipSource==='semantic'?'Normalized semantic observed-item relationships were available.':'No definite abnormal component relationship established from visible evidence.',photoGuidanceSource,photoGuidanceReason:photoGuidanceSource==='semantic'?'Model supplied finding-specific photo guidance.':photoGuidanceSource==='derived'?'Guidance derived from the normalized relationship state.':'General hidden-connection verification guidance applied.'};
  return result;
}

// Direct physical evidence may establish a broad area and mating relationship even
// when exact component identification remains uncertain.
export function reconcileVehicleAreaRelationship(relationship, condition) {
  if (!relationship || typeof relationship !== 'object') return relationship;
  const findings = Array.isArray(condition?.connectionAssessments) ? condition.connectionAssessments : [];
  const physicalFindings = findings.filter(item => ['CONNECTED_VERIFIED','DISCONNECTED_VERIFIED','PARTIALLY_SEATED'].includes(item?.connectionState));
  if (!physicalFindings.length) return { ...relationship, status:'READY', relationshipSource:relationship.relationshipSource||'fallback', relationshipReason:relationship.relationshipReason||'No definite abnormal component relationship established from visible evidence.', recommendedNextPhotoVerification:relationship.recommendedNextPhotoVerification||deriveRelationshipPhotoGuidance('CANNOT_VERIFY') };
  const relationshipText = [relationship.vehicleAreaLocation, relationship.primaryVisibleAssembly, ...(relationship.locationEvidence || [])].join(' ');
  const engineAreaVisible = /\b(?:engine|underhood|engine compartment|powertrain)\b/i.test(relationshipText);
  const broadArea = engineAreaVisible ? 'Engine compartment — visible electrical connector/component interface' : relationship.vehicleAreaLocation;
  const areaNeedsRepair = !String(relationship.vehicleAreaLocation || '').trim() || /\b(?:unknown|uncertain|unverified|skipped)\b/i.test(relationship.vehicleAreaLocation);
  const evidence = physicalFindings.map(item => item.directVisibleEvidence || item.visibleEvidence).filter(Boolean);
  const observedItems = [...(relationship.observedItems || [])];
  physicalFindings.forEach(item => {
    const itemText = `${item.observedObject || ''} ${item.directVisibleEvidence || item.visibleEvidence || ''}`;
    const connector=/\b(?:connector|plug|terminal|wiring|harness)\b/i.test(itemText),hose=/\b(?:hose|line|pipe|port|nipple|fitting)\b/i.test(itemText),state=item.connectionState==='CONNECTED_VERIFIED'?'CONNECTED':item.connectionState==='PARTIALLY_SEATED'?'PARTIALLY_CONNECTED':'DISCONNECTED';
    if(state==='DISCONNECTED'&&connector&&!directSeparationEvidence(item.directVisibleEvidence||item.visibleEvidence))return;
    const guidance=deriveRelationshipPhotoGuidance(state,itemText),match=connector?/\b(?:connector|plug|terminal|wiring|harness)\b/i:hose?/\b(?:hose|line|pipe|port|nipple|fitting)\b/i:/\b(?:mount|bracket|fastener|component)\b/i;
    const index = observedItems.findIndex(existing => match.test(`${existing.observedItem} ${existing.visibleEvidence}`));
    const intendedDestination = index >= 0 ? (observedItems[index].intendedDestination || observedItems[index].nearestIdentifiableAssembly) : engineAreaVisible ? broadArea : relationship.primaryVisibleAssembly || 'Visible component area';
    const intendedRelationship = connector?`Electrical connector for ${intendedDestination}`:hose?`Hose or line connection to ${intendedDestination}`:`Physical attachment to ${intendedDestination}`;
    const visibleStateEvidence = item.directVisibleEvidence || item.visibleEvidence;
    const physical = { intendedDestination, intendedRelationship, physicalConnectionState: state, physicalStateConfidence: item.connectionStateConfidence ?? item.findingConfidence, visibleStateEvidence, likelyRelationshipOrDestination: intendedRelationship, visibleEvidence: visibleStateEvidence, recommendedNextPhotoVerification: guidance };
    if (index >= 0) observedItems[index] = { ...observedItems[index], ...physical };
    else if (observedItems.length < 8) observedItems.push({ observedItem: item.observedObject || (connector?'Electrical connector':hose?'Hose or line':'Visible component'), itemLocationInImage: item.location || 'Visible component area', nearestIdentifiableAssembly: intendedDestination, relationshipConfidence: item.connectionStateConfidence ?? item.findingConfidence, vehicleContextEvidence: '', whatCannotBeConfirmed: 'Exact component identity may require confirmation; the reported physical state is independently evidence-bound.', ...physical });
  });
  const promoted=observedItems.filter(item=>['DISCONNECTED','PARTIALLY_CONNECTED','CONNECTED'].includes(item.physicalConnectionState)),guidance=promoted[0]?.recommendedNextPhotoVerification||relationship.recommendedNextPhotoVerification||deriveRelationshipPhotoGuidance('CANNOT_VERIFY');
  return { ...relationship, status: 'READY', vehicleAreaLocation: areaNeedsRepair && engineAreaVisible ? broadArea : relationship.vehicleAreaLocation, locationConfidence: areaNeedsRepair && engineAreaVisible ? Math.max(70, relationship.locationConfidence || 0) : relationship.locationConfidence, primaryVisibleAssembly: engineAreaVisible && /\b(?:unknown|uncertain|cannot be confirmed)\b/i.test(String(relationship.primaryVisibleAssembly || '')) ? broadArea : relationship.primaryVisibleAssembly, locationEvidence: [...new Set([...(relationship.locationEvidence || []), ...evidence])].slice(0, 12), observedItems, recommendedNextPhotoVerification: guidance, relationshipSource:promoted.length?'derived':relationship.relationshipSource||'fallback',relationshipReason:promoted.length?`Derived ${promoted.length} physical relationship state(s) from canonical visible-condition evidence.`:relationship.relationshipReason,photoGuidanceSource:promoted.length?'derived':relationship.photoGuidanceSource||'fallback',photoGuidanceReason:promoted.length?'Guidance derived from the strongest canonical physical relationship.':relationship.photoGuidanceReason };
}

export const NO_VISIBLE_DEFECT_MESSAGE = 'No visible defect can be confirmed from this image. Inspect the component physically before making a repair decision.';
const STARTER_CONTEXT_VERIFICATION = 'Widen the image to include the starter mounting location and verify whether the starter is installed before classifying the loose connections as a defect.';

const IMAGE_RELATIVE_LOCATION_UNDETERMINED = 'Image-relative location cannot be determined reliably.';
function normalizeImageRelativeLocation(rawLocation) {
  const location = String(rawLocation || '').trim().slice(0, 240);
  const unsupportedVehicleSide = /\b(?:driver'?s?|passenger'?s?|vehicle[- ]?(?:front|rear)|front[- ]?(?:left|right)|rear[- ]?(?:left|right))\b/i;
  const vagueHarnessReference = /^(?:the\s+)?(?:center|middle)(?:\s*(?:,|—|-)?\s*(?:near|by|beside)\s*(?:the\s+)?(?:visible\s+)?(?:harness|wiring|cable))?\.?$/i;
  return !location || unsupportedVehicleSide.test(location) || vagueHarnessReference.test(location) ? IMAGE_RELATIVE_LOCATION_UNDETERMINED : location;
}

function hasDistinctPhysicalConditionEvidence(finding) {
  const evidence = `${finding?.visibleEvidence || ''} ${finding?.appearance || ''}`;
  return /\b(?:gap|separat(?:ed|ion)|unmated|unplugged|unconnected|hanging\s+(?:free|loose)|exposed\s+(?:terminal|pin|wire|metal|connector)|(?:terminal|pin)s?\s+(?:are\s+)?(?:exposed|visible)|broken|crack(?:ed)?|damag(?:e|ed)|burn(?:ed|ing)?|corrosion|corroded|rust(?:ed|y|ing)?|leak(?:age|ing)?|fluid|residue|stain(?:ing|ed)?|wet(?:ness|-looking)?|backed[- ]out|disengaged|uneven(?:\s+\w+){0,2}\s+(?:insertion|seating)|misalign(?:ed|ment)|displaced|missing\s+(?:clamp|fastener|retainer)|outside\s+(?:the\s+)?coupler|rubbing|chaf(?:ed|ing))\b/i.test(evidence);
}

function hasAffirmativeMatingEvidence(finding) {
  const evidence = `${finding?.visibleEvidence || ''} ${finding?.appearance || ''}`;
  return /\b(?:fully\s+(?:mated|seated|engaged|installed)|mating\s+(?:halves|surfaces?|relationship)\s+(?:are\s+)?(?:visible|engaged|seated)|(?:connector|hose|terminal|clamp|fastener|fitting|coupler|joint)\b[^.]{0,100}\b(?:fully\s+)?(?:mated|seated|engaged|installed)|(?:locking|retention)\s+(?:tab|clip|relationship|feature)[^.]{0,80}\b(?:engaged|latched|in\s+place)|no\s+(?:abnormal\s+)?(?:gap|separation)\s+(?:is\s+)?visible)/i.test(evidence);
}

const VISUAL_CONNECTION_VERIFICATION = 'Unable to verify from this image. Obtain a close, well-lit photo that shows the full mating interface and retention feature, then physically verify seating, engagement, and retention.';

function hasVerifiedDisconnectionEvidence(finding) {
  const evidence = `${finding?.visibleEvidence || ''} ${finding?.appearance || ''}`;
  return /\b(?:air\s+gap|physical\s+separation|(?:connector|plug|housing|terminal|hose|tube|line)\s+(?:appears\s+|is\s+)?(?:clearly\s+|visibly\s+|physically\s+)?(?:disconnected|separated|unmated|unplugged|unconnected|displaced|hanging\s+(?:free|loose)|loose)|empty\s+(?:socket|receptacle|mating\s+cavity)|exposed\s+(?:mating\s+)?(?:cavity|terminal|pin)|(?:plug|connector)\s+(?:beside|next\s+to)\s+(?:an\s+)?(?:empty\s+)?(?:socket|receptacle)|not\s+(?:physically\s+)?inserted|latch[^.]{0,80}\bnot\s+engaged)\b/i.test(evidence);
}

function connectionStateFor(assessment) {
  const evidence = String(assessment?.visibleEvidence || '');
  if (hasVerifiedDisconnectionEvidence(assessment) || assessment?.seatingStatus === 'SEPARATION_OR_GAP_VISIBLE') return 'DISCONNECTED_VERIFIED';
  if (assessment?.seatingStatus === 'POSSIBLE_IMPROPER_SEATING') return 'PARTIALLY_SEATED_OR_SUSPECTED';
  if (assessment?.seatingStatus === 'NO_GAP_OR_SEPARATION_VISIBLE' && hasAffirmativeMatingEvidence(assessment)) return /\b(?:CPA|TPA|secondary\s+(?:lock|retention)|retention\s+(?:not|cannot)|lock(?:ing)?\s+(?:not|cannot)|latch\s+(?:not|cannot))\b/i.test(evidence) ? 'CONNECTED_BUT_RETENTION_NOT_VERIFIABLE' : 'CONNECTED_VERIFIED';
  return 'UNABLE_TO_DETERMINE_FROM_IMAGE';
}

export function normalizeVisualConditionConsistency(raw) {
  const normalized = { ...raw, connectionAssessments: Array.isArray(raw?.connectionAssessments) ? raw.connectionAssessments.map(item => ({ ...item })) : [], possibleConcerns: Array.isArray(raw?.possibleConcerns) ? raw.possibleConcerns.map(item => ({ ...item })) : [] };
  const corrections = [];
  for (const [kind, findings] of [['connection assessment', normalized.connectionAssessments], ['possible concern', normalized.possibleConcerns]]) {
    findings.forEach((finding, index) => {
      const original = String(finding?.location || '').trim();
      const location = normalizeImageRelativeLocation(original);
      if (location !== original) corrections.push(`${kind} ${index + 1} location normalized from "${original || 'missing'}" to "${location}" because the image-relative position was vague or unsupported.`);
      finding.location = location;
    });
  }
  const unsupportedAssessments = normalized.connectionAssessments.filter(item => ['CLEAR_DEFECT','POSSIBLE_CONCERN','RESIDUE_OR_STAINING'].includes(item?.findingType) && !hasDistinctPhysicalConditionEvidence(item));
  if (unsupportedAssessments.length) {
    normalized.connectionAssessments = normalized.connectionAssessments.filter(item => !unsupportedAssessments.includes(item));
    corrections.push(`${unsupportedAssessments.length} secondary visual finding${unsupportedAssessments.length === 1 ? '' : 's'} omitted because no distinct directly visible physical condition supported the reported defect or concern.`);
  }
  const unsupportedConcerns = normalized.possibleConcerns.filter(item => !hasDistinctPhysicalConditionEvidence(item));
  if (unsupportedConcerns.length) {
    normalized.possibleConcerns = normalized.possibleConcerns.filter(item => !unsupportedConcerns.includes(item));
    corrections.push(`${unsupportedConcerns.length} possible concern omitted because uncertainty or ordinary visible routing is not direct defect evidence.`);
  }
  const assessments = normalized.connectionAssessments;
  const contradictoryNormalClaims = assessments.filter(item => item?.findingType === 'NO_DEFECT_VISIBLE' && hasVerifiedDisconnectionEvidence(item));
  if (contradictoryNormalClaims.length) {
    contradictoryNormalClaims.forEach(item => { item.seatingStatus='SEPARATION_OR_GAP_VISIBLE'; item.findingType='CLEAR_DEFECT'; item.severity='HIGH'; item.findingConfidence=Math.max(normalizeSemanticConfidence(item.findingConfidence) ?? 0, 85); item.directDamageVisible=true; item.matingComponentVisible=true; item.recommendedVerification='Inspect the connector housing, terminals, locking tab/CPA where applicable, wiring condition, and mating receptacle. Reconnect correctly if appropriate and verify retention and system operation.'; });
    normalized.status='OBSERVED_CONDITION';
    corrections.push(`${contradictoryNormalClaims.length} no-visible-defect finding${contradictoryNormalClaims.length === 1 ? '' : 's'} changed to a visible disconnected-connection defect because separation, an empty receptacle, or a loose plug was directly described.`);
  }
  const unsupportedNoDefect = assessments.filter(item => item?.findingType === 'NO_DEFECT_VISIBLE' && (!item?.matingComponentVisible || item?.seatingStatus !== 'NO_GAP_OR_SEPARATION_VISIBLE' || !hasAffirmativeMatingEvidence(item)));
  if (unsupportedNoDefect.length) {
    unsupportedNoDefect.forEach(item => {
      item.seatingStatus = 'NOT_RELIABLY_VISIBLE'; item.findingType = 'SEATING_NOT_RELIABLY_VISIBLE'; item.severity = 'UNDETERMINED';
      item.findingConfidence = Math.min(normalizeSemanticConfidence(item.findingConfidence) ?? 50, 50);
      item.missingContext = item.missingContext || 'The full mating/retention relationship is not clearly visible.';
      item.recommendedVerification = item.recommendedVerification || VISUAL_CONNECTION_VERIFICATION;
      item.visibleEvidence = `${item.visibleEvidence} Unable to verify from this image that the full mating and retention relationship is engaged.`.trim();
    });
    normalized.status = 'UNABLE_TO_INSPECT'; normalized.unableToInspectReason = 'Unable to verify from this image that the relevant mating/retention relationship is fully visible and engaged.';
    corrections.push(`${unsupportedNoDefect.length} no-visible-defect finding${unsupportedNoDefect.length === 1 ? '' : 's'} changed to unable to verify because the image did not affirmatively show the full mating/retention relationship.`);
  }
  if (assessments.some(item => item?.findingType === 'CLEAR_DEFECT') && normalized.status !== 'OBSERVED_CONDITION') {
    normalized.status = 'OBSERVED_CONDITION';
    corrections.push('Inspection status changed to OBSERVED_CONDITION because a retained finding has direct visible clear-defect evidence.');
  }
  const hasAssessableConnection = assessments.some(item => !['NOT_RELIABLY_VISIBLE','COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE'].includes(item?.seatingStatus));
  const hasMeaningfulUnverifiedEvidence = assessments.some(item => item?.findingType === 'UNVERIFIED_CONDITION' && item?.seatingStatus === 'COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE' && String(item?.visibleEvidence || '').trim());
  const hasSpecificVisibleConcern = normalized.possibleConcerns.some(item => item?.location && item?.appearance && item?.recommendedVerification && item?.physicalConfirmationRequired === true && Array.isArray(normalized.visibleEvidence) && normalized.visibleEvidence.length > 0);
  if (normalized.status === 'POSSIBLE_CONCERN_DETECTED' && !hasAssessableConnection && !hasSpecificVisibleConcern) {
    if (hasMeaningfulUnverifiedEvidence) {
      normalized.status = 'UNVERIFIED_CONDITION';
      normalized.unableToInspectReason = null;
      normalized.possibleConcerns = [];
      corrections.push('POSSIBLE_CONCERN_DETECTED changed to UNVERIFIED_CONDITION because visible connection evidence exists but the mating component or installation context is not visible.');
    } else {
      normalized.status = 'UNABLE_TO_INSPECT';
      normalized.unableToInspectReason = 'No connection or defect can be reliably assessed from the visible image evidence.';
      normalized.possibleConcerns = [];
      corrections.push('POSSIBLE_CONCERN_DETECTED changed to UNABLE_TO_INSPECT because no specific visible condition or assessable connection was returned.');
    }
  }
  if (['OBSERVED_CONDITION','POSSIBLE_CONCERN_DETECTED','NO_VISIBLE_CONCERN_DETECTED'].includes(normalized.status)) {
    const evidenceConfidence = assessments.filter(item => ['POSSIBLE_CONCERN','CLEAR_DEFECT','RESIDUE_OR_STAINING','NO_DEFECT_VISIBLE'].includes(item?.findingType)).map(item => normalizeSemanticConfidence(item.findingConfidence)).filter(Number.isFinite);
    const reportedConfidence = normalizeSemanticConfidence(normalized.conditionConfidence);
    if (reportedConfidence !== null && evidenceConfidence.length) {
      const maximumEvidenceConfidence = Math.max(...evidenceConfidence);
      if (reportedConfidence > maximumEvidenceConfidence) {
        normalized.conditionConfidence = maximumEvidenceConfidence;
        corrections.push(`Condition confidence capped from ${reportedConfidence}% to ${maximumEvidenceConfidence}% because it exceeded supporting visible-finding confidence.`);
      }
    }
  }
  normalized.connectionAssessments = normalized.connectionAssessments.map(item => ({ ...item, connectionState: connectionStateFor(item), connectionStateConfidence: normalizeSemanticConfidence(item.findingConfidence) }));
  return { normalized, corrections };
}

function retainVisibleConnectionContext(rawCondition, componentIdentification) {
  const condition = { ...rawCondition, connectionAssessments: Array.isArray(rawCondition?.connectionAssessments) ? rawCondition.connectionAssessments : [] };
  if (condition.connectionAssessments.length || !['POSSIBLE_CONCERN_DETECTED','UNABLE_TO_INSPECT'].includes(condition.status)) return condition;
  const supportingEvidence = Array.isArray(componentIdentification?.supportingEvidence) ? componentIdentification.supportingEvidence : [];
  const likelyDestinations = Array.isArray(componentIdentification?.likelyConnectionsOrDestinations) ? componentIdentification.likelyConnectionsOrDestinations : [];
  const evidence = supportingEvidence.filter(item => /\b(?:cable|wire|connector|terminal|lead)\b/i.test(String(item)));
  const likelyStarterContext = /\bstarter(?:\s*(?:motor|solenoid|exciter))?\b/i.test([...likelyDestinations, ...evidence].join(' '));
  if (!evidence.length || !likelyStarterContext) return condition;
  const visibleEvidence = evidence.join(' ');
  return {
    ...condition,
    status: 'UNVERIFIED_CONDITION',
    observedCondition: [...new Set([...(Array.isArray(condition.observedCondition) ? condition.observedCondition : []), visibleEvidence, 'Visible wiring position is consistent with likely starter connections, but the destination is not confirmed.'])],
    connectionAssessments: [{
      location: IMAGE_RELATIVE_LOCATION_UNDETERMINED,
      seatingStatus: 'COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE',
      findingType: 'UNVERIFIED_CONDITION',
      severity: 'UNDETERMINED',
      findingConfidence: 45,
      visibleEvidence,
      matingComponentVisible: false,
      directDamageVisible: false,
      missingContext: 'The corresponding component is not visible in the photographed area and may be removed or outside the frame.',
      recommendedVerification: STARTER_CONTEXT_VERIFICATION,
      safetyDrivabilityImpact: null
    }],
    unableToInspectReason: null,
    recommendedVerification: [...new Set([...(Array.isArray(condition.recommendedVerification) ? condition.recommendedVerification : []), STARTER_CONTEXT_VERIFICATION])]
  };
}

function validateVisualConditionInspection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !['OBSERVED_CONDITION','POSSIBLE_CONCERN_DETECTED','UNVERIFIED_CONDITION','NO_VISIBLE_CONCERN_DETECTED','UNABLE_TO_INSPECT'].includes(raw.status)) throw new Error('Visual condition inspection returned no valid structured result.');
  const status = raw.status;
  const unique = values => [...new Map(values.map(value => [value.toLowerCase(), value])).values()];
  const visibleEvidence = unique(cleanStringArray(raw.visibleEvidence, 'visualCondition.visibleEvidence')).slice(0, 16);
  const observedCondition = unique(cleanStringArray(raw.observedCondition, 'visualCondition.observedCondition')).slice(0, 12);
  const recommendedVerification = cleanStringArray(raw.recommendedVerification, 'visualCondition.recommendedVerification').slice(0, 8);
  const possibleConcerns = Array.isArray(raw.possibleConcerns) ? raw.possibleConcerns.slice(0, 8).map((concern, index) => {
    if (!concern || typeof concern !== 'object' || Array.isArray(concern)) throw new Error(`Visual condition possible concern ${index + 1} is invalid.`);
    const location = String(concern.location || '').trim().slice(0, 240);
    const appearance = String(concern.appearance || '').trim().slice(0, 500);
    const verification = String(concern.recommendedVerification || '').trim().slice(0, 500);
    if (!location || !appearance || !verification || concern.physicalConfirmationRequired !== true) throw new Error(`Visual condition possible concern ${index + 1} lacks required physical verification.`);
    return { location, appearance, physicalConfirmationRequired: true, recommendedVerification: verification };
  }) : (() => { throw new Error('Analyzer field visualCondition.possibleConcerns is invalid.'); })();
  const connectionAssessments = Array.isArray(raw.connectionAssessments) ? raw.connectionAssessments.slice(0, 12).map((assessment, index) => {
    if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) throw new Error(`Visual condition connection assessment ${index + 1} is invalid.`);
    const location = String(assessment.location || '').trim().slice(0, 240);
    const seatingStatus = String(assessment.seatingStatus || 'NOT_RELIABLY_VISIBLE');
    const evidence = String(assessment.visibleEvidence || '').trim().slice(0, 500), findingType = String(assessment.findingType || ''), severity = String(assessment.severity || ''), verification = String(assessment.recommendedVerification || '').trim().slice(0, 500), findingConfidence = normalizeSemanticConfidence(assessment.findingConfidence), matingComponentVisible = assessment.matingComponentVisible === true, directDamageVisible = assessment.directDamageVisible === true, missingContext = typeof assessment.missingContext === 'string' ? assessment.missingContext.trim().slice(0, 500) || null : null;
    if (!location || !['SEPARATION_OR_GAP_VISIBLE','POSSIBLE_IMPROPER_SEATING','NO_GAP_OR_SEPARATION_VISIBLE','NOT_RELIABLY_VISIBLE','COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE'].includes(seatingStatus) || !['CLEAR_DEFECT','POSSIBLE_CONCERN','UNVERIFIED_CONDITION','RESIDUE_OR_STAINING','SEATING_NOT_RELIABLY_VISIBLE','NO_DEFECT_VISIBLE'].includes(findingType) || !['CRITICAL','HIGH','MODERATE','LOW','UNDETERMINED'].includes(severity) || !evidence || !verification || findingConfidence === null) throw new Error(`Visual condition connection assessment ${index + 1} lacks required finding evidence.`);
    if (seatingStatus === 'SEPARATION_OR_GAP_VISIBLE' && (findingType !== 'CLEAR_DEFECT' || !['CRITICAL','HIGH','MODERATE'].includes(severity))) throw new Error('Visible connection separation must be classified as a clear defect with operational severity.');
    if (seatingStatus === 'NOT_RELIABLY_VISIBLE' && (findingType !== 'SEATING_NOT_RELIABLY_VISIBLE' || severity !== 'UNDETERMINED')) throw new Error('Obscured connection seating must remain undetermined.');
    if (findingType === 'NO_DEFECT_VISIBLE' && (!matingComponentVisible || seatingStatus !== 'NO_GAP_OR_SEPARATION_VISIBLE' || !hasAffirmativeMatingEvidence(assessment))) throw new Error('No-visible-defect finding requires direct evidence of the complete mating and retention relationship.');
    if (!matingComponentVisible && !directDamageVisible && (seatingStatus !== 'COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE' || findingType !== 'UNVERIFIED_CONDITION' || severity !== 'UNDETERMINED' || !missingContext)) throw new Error('A connection without visible mating-component context must remain unverified unless direct damage is visible.');
    if (findingType === 'UNVERIFIED_CONDITION' && (severity !== 'UNDETERMINED' || !missingContext || assessment.safetyDrivabilityImpact)) throw new Error('Unverified connection context cannot carry severity or a safety/drivability claim.');
    const result={ location, seatingStatus, findingType, severity, findingConfidence, visibleEvidence: evidence, matingComponentVisible, directDamageVisible, missingContext, recommendedVerification: verification, safetyDrivabilityImpact: typeof assessment.safetyDrivabilityImpact === 'string' ? assessment.safetyDrivabilityImpact.trim().slice(0, 500) || null : null };
    return { ...result, connectionState: connectionStateFor(result), connectionStateConfidence: findingConfidence };
  }) : [];
  const priority = { CLEAR_DEFECT: 0, POSSIBLE_CONCERN: 1, UNVERIFIED_CONDITION: 2, RESIDUE_OR_STAINING: 3, SEATING_NOT_RELIABLY_VISIBLE: 4, NO_DEFECT_VISIBLE: 5 };
  const uniqueConnectionAssessments = [...new Map(connectionAssessments.map(assessment => [`${assessment.location.toLowerCase()}|${assessment.seatingStatus}|${assessment.visibleEvidence.toLowerCase()}`, assessment])).values()].sort((a, b) => priority[a.findingType] - priority[b.findingType]);
  const unableToInspectReason = typeof raw.unableToInspectReason === 'string' ? raw.unableToInspectReason.trim().slice(0, 500) || null : null;
  if ((status === 'OBSERVED_CONDITION' || status === 'POSSIBLE_CONCERN_DETECTED') && !visibleEvidence.length) throw new Error('Visual condition findings require visible evidence.');
  if (status === 'POSSIBLE_CONCERN_DETECTED' && !possibleConcerns.length) throw new Error('Possible visual concern requires a physical verification step.');
  if (status === 'UNVERIFIED_CONDITION' && !uniqueConnectionAssessments.some(assessment => assessment.findingType === 'UNVERIFIED_CONDITION')) throw new Error('Unverified visual condition requires missing component or connection context.');
  if (status === 'UNABLE_TO_INSPECT' && !unableToInspectReason) throw new Error('Unable-to-inspect status requires a reason.');
  if (status === 'NO_VISIBLE_CONCERN_DETECTED' && (!uniqueConnectionAssessments.length || uniqueConnectionAssessments.some(assessment => assessment.seatingStatus !== 'NO_GAP_OR_SEPARATION_VISIBLE' || assessment.findingType !== 'NO_DEFECT_VISIBLE' || !assessment.matingComponentVisible || !hasAffirmativeMatingEvidence(assessment)))) throw new Error('No-visible-concern status requires direct evidence that every visible connection mating and retention relationship is fully assembled.');
  if (uniqueConnectionAssessments.some(assessment => assessment.seatingStatus === 'SEPARATION_OR_GAP_VISIBLE') && status !== 'OBSERVED_CONDITION') throw new Error('Visible connection separation cannot be downgraded below an observed condition.');
  return { status, conditionConfidence: normalizeSemanticConfidence(raw.conditionConfidence), rawConditionConfidence: raw.rawConditionConfidence ?? raw.conditionConfidence ?? null, normalizedConditionConfidence: normalizeSemanticConfidence(raw.conditionConfidence), observedCondition, possibleConcerns, connectionAssessments: uniqueConnectionAssessments, noVisibleConcernMessage: status === 'NO_VISIBLE_CONCERN_DETECTED' ? NO_VISIBLE_DEFECT_MESSAGE : '', unableToInspectReason, visibleEvidence, recommendedVerification, safetyDrivabilityImpact: typeof raw.safetyDrivabilityImpact === 'string' ? raw.safetyDrivabilityImpact.trim().slice(0, 500) || null : null, consistencyCorrections: Array.isArray(raw.consistencyCorrections) ? raw.consistencyCorrections.slice(0, 8) : [] };
}

function validateWiringDiagram(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !['READY','INSUFFICIENT_READABILITY'].includes(raw.status)) throw new Error('Wiring diagram analyzer returned no valid structured result.');
  const confidence = normalizeSemanticConfidence(raw.confidence);
  const circuitComponent = typeof raw.circuitComponent === 'string' ? raw.circuitComponent.trim().slice(0, 200) : '';
  const structuralEvidence = cleanStringArray(raw.structuralEvidence, 'structuralEvidence');
  const arrays = Object.fromEntries(['detectedComponents','connectorsAndPins','fuses','relays','splices','wireDetails','importantObservations','unreadableFields'].map(field => [field, tolerantWiringStrings(raw[field])]));
  let circuitPaths = Array.isArray(raw.circuitPaths) ? raw.circuitPaths.slice(0, 16).map((path, index) => {
    if (!path || typeof path !== 'object') throw new Error(`Circuit path ${index + 1} is invalid.`);
    const functionConfirmed = Boolean(path.functionConfirmed);
    return { label: String(path.label || `Circuit Leg ${String.fromCharCode(65 + index)}`).slice(0, 80), path: String(path.path || 'Not reliably readable from supplied diagram.').slice(0, 300), function: functionConfirmed ? String(path.function || '').slice(0, 200) : 'Circuit function not reliably confirmed from supplied diagram.', functionConfirmed };
  }) : [];
  if (structuralEvidence.length < 2) throw new Error('Wiring diagram classification lacks structural schematic evidence.');
  const conclusionSet = new Set(['CONTINUE','COMPONENT_PASSES_CURRENT_TESTS','VERIFIED_COMPONENT_FAILURE','VERIFIED_POWER_SUPPLY_FAULT','VERIFIED_GROUND_FAULT','VERIFIED_CONTROL_CIRCUIT_FAULT','VERIFIED_SIGNAL_CIRCUIT_FAULT','POSSIBLE_MODULE_DRIVER_FAULT_FURTHER_TESTING_REQUIRED','INSUFFICIENT_EVIDENCE']);
  const testPlan = Array.isArray(raw.testPlan) ? raw.testPlan.slice(0, 8).map((step, index) => {
    if (!step || typeof step !== 'object') throw new Error(`Wiring test step ${index + 1} is invalid.`);
    if ((step.expectedMin !== null || step.expectedMax !== null) && step.specificationSource === 'NONE') throw new Error(`Wiring test step ${index + 1} contains an unsupported numeric specification.`);
    if (/ohm|resistance|continuity/i.test(`${step.tool} ${step.instructions} ${step.evaluationType}`) && !/key\s*off|de-energized|deenergized/i.test(`${step.instructions} ${step.operatingCondition}`)) throw new Error(`Wiring test step ${index + 1} attempts resistance or continuity testing without an explicit de-energized condition.`);
    if (!conclusionSet.has(step.passConclusion) || !conclusionSet.has(step.failConclusion)) throw new Error(`Wiring test step ${index + 1} conclusion is invalid.`);
    return { id: String(step.id || `step-${index + 1}`).slice(0, 40), objective: String(step.objective || '').slice(0, 200), tool: String(step.tool || '').slice(0, 120), instructions: String(step.instructions || '').slice(0, 700), redLead: String(step.redLead || '').slice(0, 240), blackLead: String(step.blackLead || '').slice(0, 240), connectorCondition: String(step.connectorCondition || '').slice(0, 160), operatingCondition: String(step.operatingCondition || '').slice(0, 160), loaded: Boolean(step.loaded), expectedBehavior: String(step.expectedBehavior || '').slice(0, 300), evaluationType: String(step.evaluationType || 'OBSERVATION'), expectedMin: Number.isFinite(step.expectedMin) ? step.expectedMin : null, expectedMax: Number.isFinite(step.expectedMax) ? step.expectedMax : null, specificationSource: String(step.specificationSource || 'NONE'), nextOnPass: Number.isInteger(step.nextOnPass) ? step.nextOnPass : null, nextOnFail: Number.isInteger(step.nextOnFail) ? step.nextOnFail : null, passConclusion: step.passConclusion, failConclusion: step.failConclusion };
  }) : [];
  if (raw.status === 'READY' && (!circuitComponent || !testPlan.length)) throw new Error('Readable wiring diagram has no component test plan.');
  const powerPath = normalizeWiringField(raw.powerPath);
  const groundPath = normalizeWiringField(raw.groundPath);
  const controlPath = normalizeWiringField(raw.controlPath ?? raw.signalPath);
  const testPoints = normalizeWiringField(raw.testPoints);
  if (!circuitPaths.length) circuitPaths = [['Reported power path',powerPath],['Reported ground path',groundPath],['Reported control/signal path',controlPath]].filter(([,nodes]) => nodes.length).map(([label,nodes]) => ({ label, path: nodes.map(node => [node.component,node.terminal,node.wire,node.circuit].filter(Boolean).join(' ')).join(' → '), function: 'Circuit function not reliably confirmed from supplied diagram.', functionConfirmed: false }));
  const detectedComponents = arrays.detectedComponents.length ? arrays.detectedComponents : tolerantWiringStrings(raw.components);
  const connectorsAndPins = arrays.connectorsAndPins.length ? arrays.connectorsAndPins : tolerantWiringStrings(raw.connectors);
  return { status: raw.status, circuitComponent: circuitComponent || 'Not reliably readable from supplied diagram.', confidence, rawConfidence: raw.confidence ?? null, normalizedConfidence: confidence, structuralEvidence, ...arrays, detectedComponents, connectorsAndPins, circuitPaths, powerPath, groundPath, controlPath, testPoints, safetyWarning: typeof raw.safetyWarning === 'string' ? raw.safetyWarning.trim().slice(0, 600) || null : null, testPlan };
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

function validateDocumentRepairInformation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Document extraction returned no structured result.');
  if (!['COMPLETE','INCOMPLETE','UNREADABLE'].includes(raw.status)) throw new Error('Document extraction status is invalid.');
  const text = (field, limit) => typeof raw[field] === 'string' ? raw[field].trim().slice(0, limit) : '';
  const allowedMissing = new Set(['DTC applicability','component or circuit','test location','test method','criterion','requested technician result']);
  const applicability=['APPLICABLE','NOT APPLICABLE','UNKNOWN / CANNOT DETERMINE'].includes(raw.dtcApplicability)?raw.dtcApplicability:'';
  const claimedCriterion=text('criterion',300),visibleTextEvidence=cleanStringArray(raw.visibleTextEvidence,'visibleTextEvidence'),criterionEvidence=text('criterionEvidence',500)||visibleTextEvidence.find(item=>claimedCriterion&&item.toLowerCase().includes(claimedCriterion.toLowerCase()))||'',criterionNumbers=claimedCriterion.match(/\d+(?:\.\d+)?/g)||[],evidenceNumbers=criterionEvidence.match(/\d+(?:\.\d+)?/g)||[],criterionEvidenceVisible=!!criterionEvidence&&visibleTextEvidence.some(item=>item.toLowerCase().includes(criterionEvidence.toLowerCase())||criterionEvidence.toLowerCase().includes(item.toLowerCase())),criterionGrounded=criterionEvidenceVisible&&criterionNumbers.every(number=>evidenceNumbers.includes(number));
  const result = {status:raw.status,dtcApplicability:applicability,dtcs:Array.isArray(raw.dtcs)?[...new Set(raw.dtcs.filter(code=>/^[PCBU][0-9A-F]{4}$/.test(code)))].slice(0,16):[],testName:text('testName',200),componentOrCircuit:text('componentOrCircuit',300),testLocation:text('testLocation',400),method:text('method',700),criterion:criterionGrounded?claimedCriterion:'',criterionEvidence:criterionGrounded?criterionEvidence:'',requestedResult:text('requestedResult',300),comparator:criterionGrounded&&['','<=','>=','range'].includes(raw.comparator)?raw.comparator:'',minimum:criterionGrounded&&Number.isFinite(raw.minimum)?raw.minimum:null,maximum:criterionGrounded&&Number.isFinite(raw.maximum)?raw.maximum:null,visibleTextEvidence,missingRequiredFields:Array.isArray(raw.missingRequiredFields)?[...new Set(raw.missingRequiredFields.filter(field=>allowedMissing.has(field)))]:[]};
  if(result.dtcApplicability)result.missingRequiredFields=result.missingRequiredFields.filter(field=>field!=='DTC applicability');
  const required=[['DTC applicability',result.dtcApplicability],['component or circuit',result.componentOrCircuit],['test location',result.testLocation],['test method',result.method],['criterion',result.criterion],['requested technician result',result.requestedResult]];
  result.missingRequiredFields=[...new Set([...result.missingRequiredFields,...required.filter(([,value])=>!value).map(([field])=>field)])];
  if(result.status==='COMPLETE'&&result.missingRequiredFields.length)result.status='INCOMPLETE';
  return result;
}

function validateAutomotiveGraph(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Automotive graph analysis returned no structured result.');
  if (!['READY','PARTIAL','UNREADABLE'].includes(raw.status)) throw new Error('Automotive graph analysis status is invalid.');
  const arrays = {};
  for (const field of ['observed','interpretation','nextTest','pidNames','sensorNames','valuesAndScales','traceFindings','unreadableOrUncertain']) arrays[field] = cleanStringArray(raw[field], field);
  const visibleVehicle = raw.visibleVehicle && typeof raw.visibleVehicle === 'object' ? { description: String(raw.visibleVehicle.description || '').trim().slice(0, 200), evidence: cleanStringArray(raw.visibleVehicle.evidence, 'visibleVehicle.evidence') } : { description: '', evidence: [] };
  const diagnosticSignificance=['NORMAL_OR_EXPECTED','MILDLY_ABNORMAL','SIGNIFICANT','INCONCLUSIVE','INDETERMINATE'].includes(raw.diagnosticSignificance)?raw.diagnosticSignificance:'INDETERMINATE';
  return { status: raw.status, confidence: normalizeSemanticConfidence(raw.confidence), rawConfidence: raw.confidence ?? null, ...arrays, diagnosticSignificance, visibleVehicle };
}

function graphNumber(text, label) {
  const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=normalizeAutomotiveNumericSigns(text).match(new RegExp(`\\b${escaped}\\b[^-+\\d]{0,24}([-+]?\\d+(?:\\.\\d+)?)\\s*(?:%|V|volts?|RPM|°?F)?`,'i'));
  return match?Number(match[1]):null;
}

function normalizeAutomotiveNumericSigns(text) {
  return String(text).replace(/[−–—]\s*(?=\d)/g,'-').replace(/([+-])\s+(?=\d)/g,'$1');
}

function graphPidMeasurement(text, labels) {
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),labelPattern=labels.map(escape).join('|'),rpmPid=labels.some(label=>/^Engine speed$/i.test(label)),tokens=String(text).split('|').map(token=>token.trim()).filter(Boolean);let segments=tokens.filter(segment=>new RegExp(`\\b(?:${labelPattern})\\b`,'i').test(segment));
  if(rpmPid){const knownPidPattern='(?:LTFT B1|Long FT #1|STFT B1|Short FT #1|O2S B1S2|B1S2|AFS B1S1|A\\/F B1S1|AFS Voltage B1S1|Engine Speed|Engine RPM|Vehicle Speed|Coolant|Pressure|Temperature)',rolePattern=/\b(?:current|currently|now|minimum|min|maximum|max)\b/i,roleOnlyPattern=/^(?:current|currently|now|minimum|min|maximum|max)\s*:?\s*$/i,isEngineSpeedLabel=token=>/\b(?:Engine Speed(?:\s*\(RPM\))?|Engine RPM)\b/i.test(token)||/^RPM\s*:?\s*$/i.test(token),ownedRegions=[];for(let index=0;index<tokens.length;index+=1){if(!isEngineSpeedLabel(tokens[index])||/\bVehicle Speed\b/i.test(tokens[index]))continue;const before=[];if(!rolePattern.test(tokens[index]))for(let nearby=index-1;nearby>=0&&before.length<6;nearby-=1){if(/[-+]?\d/.test(tokens[nearby])||new RegExp(`\\b${knownPidPattern}\\b`,'i').test(tokens[nearby])||/^RPM\b\s*:?\s*$/i.test(tokens[nearby]))break;before.unshift(tokens[nearby])}const owned=[...before,tokens[index]];for(let nearby=index+1;nearby<tokens.length;nearby+=1){if(rolePattern.test(tokens[index])&&roleOnlyPattern.test(tokens[nearby])||new RegExp(`\\b${knownPidPattern}\\b`,'i').test(tokens[nearby])||/^RPM\b\s*:?\s*$/i.test(tokens[nearby]))break;owned.push(tokens[nearby]);if(owned.length>=13)break}const region=owned.join(' ');if(rolePattern.test(region))ownedRegions.push(region)}if(ownedRegions.length)segments=[...new Set(ownedRegions)];}
  let current=null,minimum=null,maximum=null,rawCurrent=null,rawMinimum=null,rawMaximum=null,signNormalizationApplied=false,parseFailure=false;const fieldValues={current:[],minimum:[],maximum:[]};
  for(const rawSegment of segments){
    const signNormalizedSegment=normalizeAutomotiveNumericSigns(rawSegment),segment=rpmPid?signNormalizedSegment.replace(/(\d),(?=\d{3}\b)/g,'$1'):signNormalizedSegment;if(signNormalizedSegment!==rawSegment)signNormalizationApplied=true;
    const rawRoleCandidates=[...rawSegment.matchAll(/[+\-âˆ’â€“â€”]?\s*\d+(?:\.\d+)?/g)].map(match=>match[0].trim());
    const roleValue=(role,input=segment,sign='[-+]?')=>{const digits=rpmPid&&input===rawSegment?'\\d[\\d,]*(?:\\.\\d+)?':'\\d+(?:\\.\\d+)?';return rpmPid?(input.match(new RegExp(`\\b${role}\\b[^-+\\d]{0,24}(${sign}${digits})\\s*(?:RPM)?`,'i'))||input.match(new RegExp(`(${sign}${digits})\\s*(?:RPM)?[^-+\\d]{0,24}\\b${role}\\b`,'i'))):input.match(new RegExp(`(?:\\b(?:${labelPattern})\\b[^|]{0,48}\\b${role}\\b|\\b${role}\\b[^|]{0,48}\\b(?:${labelPattern})\\b)[^-+\\d]{0,24}(${sign}${digits})\\s*(?:%|V|RPM)?`,'i'))},currentRole=roleValue('(?:current|currently|now)'),minimumRole=roleValue('(?:minimum|min)'),maximumRole=roleValue('(?:maximum|max)'),rawSign='[+\\-\\u2212\\u2013\\u2014]?\\s*',rawCurrentRole=roleValue('(?:current|currently|now)',rawSegment,rawSign),rawMinimumRole=roleValue('(?:minimum|min)',rawSegment,rawSign),rawMaximumRole=roleValue('(?:maximum|max)',rawSegment,rawSign),hasExplicitRoles=currentRole||minimumRole||maximumRole;
    if(rpmPid){const orderedRoles=[...segment.matchAll(/\b(current|currently|now|minimum|min|maximum|max)\b/gi)].map(match=>/^min/i.test(match[1])?'minimum':/^max/i.test(match[1])?'maximum':'current'),orderedValues=[...segment.matchAll(/[-+]?\d+(?:\.\d+)?\s*(?:RPM)?/gi)].map(match=>Number(match[0].replace(/RPM/i,'').trim()));if(orderedRoles.length===3&&new Set(orderedRoles).size===3&&orderedValues.length===3){const rawOrderedValues=[...rawSegment.matchAll(/[+\-\u2212\u2013\u2014]?\s*\d[\d,]*(?:\.\d+)?\s*(?:RPM)?/gi)].map(match=>match[0].replace(/RPM/i,'').trim());for(let index=0;index<3;index+=1){const role=orderedRoles[index],value=orderedValues[index],raw=rawOrderedValues[index]||String(value);fieldValues[role].push(value);if(role==='current'){current=value;rawCurrent=raw}else if(role==='minimum'){minimum=value;rawMinimum=raw}else{maximum=value;rawMaximum=raw}}continue}}
    if(hasExplicitRoles){const roleCount=[currentRole,minimumRole,maximumRole].filter(Boolean).length,singleRaw=roleCount===1?rawSegment.match(/[:=]\s*(.*?)\s*(?:%|V|RPM)(?:\s|$)/i)?.[1]?.trim():null,bind=(match,rawMatch,role)=>{if(!match)return;const captured=match[1],rawCaptured=rawMatch?.[1],value=Number(captured);fieldValues[role].push(value);const raw=singleRaw||(rawCaptured||captured).trim();if(role==='current'){current=value;rawCurrent=raw}else if(role==='minimum'){minimum=value;rawMinimum=raw}else{maximum=value;rawMaximum=raw}};bind(currentRole,rawCurrentRole,'current');bind(minimumRole,rawMinimumRole,'minimum');bind(maximumRole,rawMaximumRole,'maximum');if(/\b(?:current|currently|now)\b/i.test(segment)&&!currentRole)parseFailure=true;if(/\b(?:minimum|min)\b/i.test(segment)&&!minimumRole)parseFailure=true;if(/\b(?:maximum|max)\b/i.test(segment)&&!maximumRole)parseFailure=true;continue;}
    const rawValues=[...rawSegment.matchAll(/[+\-−–—]?\s*\d+(?:\.\d+)?/g)].map(match=>match[0].trim());
    const rangeMatch=segment.match(/([-+]?\d+(?:\.\d+)?)\s*(?:%|V|RPM)?\s*(?:to|through|\u2013|\u2014)\s*([-+]?\d+(?:\.\d+)?)\s*(?:%|V|RPM)?/i);
    if(rangeMatch){minimum=Number(rangeMatch[1]);maximum=Number(rangeMatch[2]);fieldValues.minimum.push(minimum);fieldValues.maximum.push(maximum);rawMinimum=rawValues.at(-2)||rangeMatch[1];rawMaximum=rawValues.at(-1)||rangeMatch[2];continue;}
    const valueMatch=segment.match(new RegExp(`\\b(?:${labelPattern})\\b[^-+\\d]{0,32}([-+]?\\d+(?:\\.\\d+)?)`,'i'));
    const namedField=/\b(?:current|currently|now|minimum|min|maximum|max)\b/i.test(segment);if(!valueMatch){if(namedField)parseFailure=true;continue;}
    const value=Number(valueMatch[1]);
    const rawValue=rawValues.at(-1)||valueMatch[1];
    if(/\b(?:minimum|min)\b/i.test(segment)){minimum=value;fieldValues.minimum.push(value);rawMinimum=rawValue}
    else if(/\b(?:maximum|max)\b/i.test(segment)){maximum=value;fieldValues.maximum.push(value);rawMaximum=rawValue}
    else if(/\b(?:current|currently|now)\b/i.test(segment)||current===null){current=value;fieldValues.current.push(value);rawCurrent=rawValue}
  }
  const range=minimum!==null&&maximum!==null?{minimum,maximum}:null;
  const contradictoryDuplicate=Object.values(fieldValues).some(values=>new Set(values.map(value=>String(value))).size>1),finite=[current,minimum,maximum].filter(value=>value!==null).every(Number.isFinite),rangeValid=!range||(range.minimum<=range.maximum&&(current===null||(range.minimum<=current&&current<=range.maximum))),numericInvalid=parseFailure||!finite||contradictoryDuplicate||Boolean(range&&!rangeValid);
  const inconsistencyReason=parseFailure?'NUMERIC_PARSE_FAILURE':!finite?'NON_FINITE_VALUE':contradictoryDuplicate?'CONTRADICTORY_DUPLICATE_VALUES':!range||rangeValid?'NONE':range.minimum>range.maximum?'MIN_GREATER_THAN_MAX':current<range.minimum?'CURRENT_BELOW_MIN':'CURRENT_ABOVE_MAX';
  const acceptedReason='PID_LOCAL_EXPLICIT_ROLE_BINDING',candidateValues=role=>Object.freeze(fieldValues[role].map((value,index)=>Object.freeze({value,source:`PID_OWNED_SEGMENT_${Math.min(index,Math.max(segments.length-1,0))}`,status:'ACCEPTED_CANDIDATE'}))),candidateAudit=Object.freeze({canonicalPid:rpmPid?'Engine Speed':labels[0],canonicalPidName:rpmPid?'Engine Speed (RPM)':labels[0],rawEvidenceTokens:Object.freeze([...segments]),currentCandidates:candidateValues('current'),minimumCandidates:candidateValues('minimum'),maximumCandidates:candidateValues('maximum'),selectedCurrent:current,selectedMinimum:minimum,selectedMaximum:maximum,duplicateCanonicalRecordsRemoved:rpmPid?Math.max(0,segments.length-1):0,candidates:Object.freeze([{role:'current',raw:rawCurrent,value:current,status:current===null?'REJECTED':'ACCEPTED',reason:current===null?'NO_PID_LOCAL_PARSEABLE_EVIDENCE':acceptedReason},{role:'minimum',raw:rawMinimum,value:minimum,status:minimum===null?'REJECTED':'ACCEPTED',reason:minimum===null?'NO_PID_LOCAL_PARSEABLE_EVIDENCE':acceptedReason},{role:'maximum',raw:rawMaximum,value:maximum,status:maximum===null?'REJECTED':'ACCEPTED',reason:maximum===null?'NO_PID_LOCAL_PARSEABLE_EVIDENCE':acceptedReason}])});
  return {current,minimum,maximum,range:!numericInvalid?range:null,invalidRange:range&&numericInvalid?range:null,numericInvalid,rawCurrent,rawMinimum,rawMaximum,signNormalizationApplied,inconsistencyReason,sourceRegions:Object.freeze(segments.map((_,index)=>`PID_OWNED_SEGMENT_${index}`)),bindingStatus:current!==null&&minimum!==null&&maximum!==null?'COMPLETE':'INCOMPLETE',candidateAudit,rejectedCandidates:Object.freeze(candidateAudit.candidates.filter(candidate=>candidate.status==='REJECTED'))};
}

function canonicalNumericEvidence(name,unit,reading) {
  const tolerance=1e-6,sourceRange=reading.range||reading.invalidRange,minimum=reading.minimum??sourceRange?.minimum??null,maximum=reading.maximum??sourceRange?.maximum??null,current=reading.current;
  const hasRange=minimum!==null&&maximum!==null,consistent=!reading.numericInvalid&&(!hasRange||(minimum<=maximum&&(current===null||(minimum<=current&&current<=maximum)))),includesZero=hasRange&&minimum<=tolerance&&maximum>=-tolerance,crossesZero=hasRange&&minimum<-tolerance&&maximum>tolerance;
  const rangeSign=!hasRange?'NOT_AVAILABLE':minimum>tolerance?'POSITIVE_ONLY':maximum<-tolerance?'NEGATIVE_ONLY':Math.abs(minimum)<=tolerance&&Math.abs(maximum)<=tolerance?'ZERO_ONLY':'INCLUDES_ZERO';
  const numericRange=hasRange?Object.freeze({minimum,maximum}):null,complete=[current,minimum,maximum].every(Number.isFinite),evidenceState=!complete?'INCOMPLETE':consistent?'COMPLETE_VALID':'INCONSISTENT',validationResult=evidenceState==='COMPLETE_VALID'?'PASS':evidenceState==='INCOMPLETE'?'INCOMPLETE':'FAIL';
  return Object.freeze({pidName:name,canonicalPidName:unit==='RPM'?'Engine Speed (RPM)':name,rawCurrent:reading.rawCurrent,rawMinimum:reading.rawMinimum,rawMaximum:reading.rawMaximum,current,minimum,maximum,unit,confidence:null,sourceField:'FINAL_NORMALIZED_PID_CURRENT_MIN_MAX',sourceRegions:reading.sourceRegions,bindingStatus:reading.bindingStatus,candidateAudit:reading.candidateAudit,rejectedCandidates:reading.rejectedCandidates,evidenceState,validationResult,sign:current===null?'ABSENT':current>tolerance?'POSITIVE':current<-tolerance?'NEGATIVE':'ZERO',currentSign:current===null?'ABSENT':current>tolerance?'POSITIVE':current<-tolerance?'NEGATIVE':'ZERO',numericRange,rangeSign,crossesZero,allObservedPositive:rangeSign==='POSITIVE_ONLY',allObservedNegative:rangeSign==='NEGATIVE_ONLY',includesZero,numericRangeConstant:hasRange&&Math.abs(maximum-minimum)<=tolerance,unreadable:false,currentPresent:current!==null,minimumPresent:minimum!==null,maximumPresent:maximum!==null,currentMinMaxConsistent:consistent,validityState:consistent?'VALID':'NUMERIC_INCONSISTENCY',inconsistencyReason:reading.inconsistencyReason,signNormalizationApplied:reading.signNormalizationApplied});
}

export function correctAutomotiveGraphReasoning(graph) {
  const all=[...(graph.observed||[]),...(graph.valuesAndScales||[]),...(graph.pidNames||[]),...(graph.sensorNames||[]),...(graph.traceFindings||[])].join(' | '),lower=all.toLowerCase();
  const normalizePidTerminology=item=>{let text=String(item);if(/\b(?:ltft|long ft|long-term fuel trim|stft|short ft|short-term fuel trim|engine speed|rpm|afs|a\/f sensor|air fuel ratio sensor)\b/i.test(text)){text=text.replace(/\bswitching\b/gi,'varying').replace(/\bswitches\b/gi,'varies').replace(/\bswitched\b/gi,'changed').replace(/\bswitch\b/gi,'change')}return text};
  const stftReading=graphPidMeasurement(all,['STFT B1','Short FT #1']),ltftReading=graphPidMeasurement(all,['LTFT B1','Long FT #1']),rearO2Reading=graphPidMeasurement(all,['O2S B1S2','B1S2']),afsReading=graphPidMeasurement(all,['AFS B1S1','A/F B1S1','AFS Voltage B1S1']),rpmReading=graphPidMeasurement(all,['Engine speed','Engine RPM','RPM']),stft=stftReading.current,ltft=ltftReading.current,rpm=rpmReading.current,coolant=graphNumber(all,'Coolant'),rearO2=rearO2Reading.current,afs=afsReading.current,displayedRanges=[stftReading.range,ltftReading.range,rearO2Reading.range,afsReading.range,rpmReading.range].filter(Boolean),hasDisplayedRanges=displayedRanges.length>0;
  const readings=[['Long FT #1',ltftReading],['Short FT #1',stftReading],['O2S B1S2',rearO2Reading],['AFS B1S1',afsReading],['Engine Speed',rpmReading]];
  const numericEvidence=Object.freeze([canonicalNumericEvidence('Long FT #1','%',ltftReading),canonicalNumericEvidence('Short FT #1','%',stftReading),canonicalNumericEvidence('O2S B1S2','V',rearO2Reading),canonicalNumericEvidence('AFS B1S1','V',afsReading),canonicalNumericEvidence('Engine Speed','RPM',rpmReading)].filter(item=>item.currentPresent||item.minimumPresent||item.maximumPresent));
  const invalidEvidence=numericEvidence.filter(item=>!item.currentMinMaxConsistent),invalidLabels=invalidEvidence.map(item=>item.pidName),invalidReadings=readings.filter(([name])=>invalidLabels.includes(name));
  const finalizedStft=numericEvidence.find(item=>item.pidName==='Short FT #1'),finalizedLtft=numericEvidence.find(item=>item.pidName==='Long FT #1'),validStft=finalizedStft?.currentMinMaxConsistent?finalizedStft.current:null,validLtft=finalizedLtft?.currentMinMaxConsistent?finalizedLtft.current:null;
  const modelTraceEvidence=(graph.traceFindings||[]).map(normalizePidTerminology),classifierTraceEvidence=graph.classifierGraphEvidence||[],temporalSource=[...modelTraceEvidence,...classifierTraceEvidence,...(graph.observed||[])].join(' '),uncertaintySource=(graph.unreadableOrUncertain||[]).join(' '),wideband=/\b(?:a\/f sensor|afs|air fuel ratio sensor|wideband|lambda sensor)\b/i.test(all),hasAxes=/\b(?:axes|axis|x-axis|horizontal axis)\b/i.test(temporalSource),hasGridlines=/\b(?:grid|gridlines?)\b/i.test(temporalSource),hasPlottedTraces=/\b(?:plotted traces?|trace progression|graph lines? across|waveform|time-series)\b/i.test(temporalSource),hasMultipleTraceSamples=hasPlottedTraces||/\b(?:multiple|sequential|repeated)\s+(?:plotted )?(?:samples|points|readings)|data points visible across graphs?\b/i.test(temporalSource),positiveTraceEvidence=hasPlottedTraces||/\b(?:multiple samples|multiple plotted points|traces? (?:are )?visible|sequential (?:plotted )?(?:samples|points)|horizontal (?:trace |graph )?history|waveform (?:over|across) time|trace (?:switches|oscillates|changes|responds|rises|falls|varies)|data points visible across graphs?)\b/i.test(temporalSource),tracesUnreadable=/\b(?:plotted )?traces? (?:are |is )?(?:unreadable|not readable|not discernible|not visible)|no usable (?:plotted )?trace\b/i.test(uncertaintySource),dynamic=positiveTraceEvidence&&!tracesUnreadable,supportedCriterion=/\b(?:verified specification|specified (?:range|limit)|pass\/fail criterion|threshold (?:shown|displayed)|dtc-specific criterion)\b/i.test(all),catalystComparison=dynamic&&/(?:b1s1|upstream)/i.test(all)&&/(?:b1s2|downstream)/i.test(all);
  const present=condition=>condition?'PRESENT':'NOT_PRESENT',evidenceClasses={upstreamAirFuel:/\b(?:afs(?: voltage)? b1s1|a\/f sensor b1s1|air fuel(?: ratio)? sensor(?: bank 1 sensor 1| b1s1)?|upstream a\/f sensor|b1s1)\b/i.test(all),downstreamO2:/\b(?:o2s? b1s2|o2 sensor bank 1 sensor 2|downstream o2|rear o2 sensor|b1s2)\b/i.test(all),shortTermFuelTrim:/\b(?:stft|short ft|short-term fuel trim)\b/i.test(all),longTermFuelTrim:/\b(?:ltft|long ft|long-term fuel trim)\b/i.test(all),engineSpeed:/\b(?:engine speed|rpm)\b/i.test(all),closedLoopStatus:/\b(?:closed loop|fuel system status|fuel sys(?:tem)?\s*1)\b/i.test(all),engineLoad:/\b(?:calculated load|absolute load|engine load|load pct)\b/i.test(all),coolantTemperature:/\b(?:coolant|ect)\b/i.test(all),massAirFlow:/\b(?:maf|mass air flow)\b/i.test(all),manifoldPressure:/\b(?:map|manifold absolute pressure)\b/i.test(all),throttlePosition:/\b(?:throttle|tps)\b/i.test(all),vehicleSpeed:/\b(?:vehicle speed|vss|mph|km\/h)\b/i.test(all),commandedMixture:/\b(?:commanded equivalence ratio|lambda command|commanded mixture)\b/i.test(all)},evidenceInventory={channels:[...new Set((graph.pidNames||[]).map(String).filter(Boolean))],acquiredEvidenceClasses:Object.entries(evidenceClasses).filter(([,available])=>available).map(([name])=>name),...Object.fromEntries(Object.entries(evidenceClasses).map(([name,available])=>[name,present(available)])),temporalEvidence:dynamic?'PRESENT':'NOT_PRESENT',timeScale:dynamic?(/\b(?:seconds?|milliseconds?|ms|sec)\s*(?:\/|per)\s*(?:division|div)|\btime scale\s*(?:is|:)\s*[-+\d]/i.test(all)?'PRESENT':'PRESENT_BUT_LIMITED'):'NOT_APPLICABLE',controlled2500Rpm:present(/\b(?:2,?500|2500)\s*(?:rpm)?\b/i.test(all)&&/\b(?:hold|held|steady|stable|controlled)\b/i.test(all))};
  const forbidden=[/\b(?:sensor|catalyst|converter) (?:is |appears )?(?:good|bad|failed|normal)\b/i,/\bno irregularit/i,/\bnegative (?:fuel )?trims?.*(?:vacuum leak|unmetered air)/i,/\binsufficient (?:dynamic )?(?:graph )?evidence.*\b(?:bad|failed|condemn|replace)\b/i];
  const temporalInference=/\b(?:activity|stable|unstable|switching|oscillating|responding|stuck|biased|trending|fluctuating)\b/i;
  const downstreamTemporalClaim=/\b(?:fluctuat\w*|peak(?:ed|s|ing)?|rose|rises|rising|increas\w* over time|drop(?:ped|s|ping)?|fell|falls|falling|decreas\w* over time|switch\w*|cycl\w*|oscillat\w*|respond\w*|react\w*|remain(?:ed|s)? (?:steady|stable|low|high)|stay(?:ed|s)? (?:steady|stable|low|high)|stabili[sz]\w*|unstable|trend\w*|trace-derived|trace response|waveform behavior|frequency|duty-cycle behavior|sustained|intermittent|periodic|rapid movement|slow movement)\b/i;
  const temporalLimitation=/\b(?:cannot|can't|unable|unavailable|insufficient|not enough|does not|do not|no reliable|requires?|needed|required|additional|before determining|cannot be evaluated|cannot determine|not establish|not prove|without temporal|without time-series)\b/i;
  const unsupportedSnapshotClaim=item=>downstreamTemporalClaim.test(item)&&!temporalLimitation.test(item);
  const staticContradiction=/\b(?:only instantaneous (?:PID )?readings|static snapshot(?: only)?|no time-based behavior (?:is |can be )?(?:available|determined)|no temporal behavior (?:is )?available)\b/i;
  const temporalClaim=/\b(?:increase[sd]?|decrease[sd]?|rise[sn]?|rose|fall(?:s|ing)?|fell|trend(?:s|ed|ing)?|oscillat\w*|switch\w*|cycl\w*|respond\w*|stabili[sz]\w*|changes? over time|before|after|initially|later|consistently over time|remains? .{0,24}(?:over time|across the (?:captured|visible) interval))\b/i;
  const temporalClaimSupported=item=>{if(!temporalClaim.test(item))return true;const subject=/\b(?:engine speed|rpm)\b/i.test(item)?/\b(?:engine speed|rpm)\b/i:/\b(?:o2s? b1s2|b1s2|downstream)\b/i.test(item)?/\b(?:o2s? b1s2|b1s2|downstream)\b/i:/\b(?:afs? b1s1|b1s1|upstream)\b/i.test(item)?/\b(?:afs? b1s1|b1s1|upstream)\b/i:/\b(?:stft|short ft|ltft|long ft|fuel trim)\b/i.test(item)?/\b(?:stft|short ft|ltft|long ft|fuel trim)\b/i:null;const action=/\b(?:increase|rise|rose|upward)\w*\b/i.test(item)?/\b(?:increase|rise|rose|upward)\w*\b/i:/\b(?:decrease|fall|fell|downward)\w*\b/i.test(item)?/\b(?:decrease|fall|fell|downward)\w*\b/i:/\b(?:oscillat|switch|cycl)\w*\b/i.test(item)?/\b(?:oscillat|switch|cycl)\w*\b/i:/\b(?:respond|delay)\w*\b/i.test(item)?/\b(?:respond|delay)\w*\b/i:/\b(?:stable|stabil|flat|remain)\w*\b/i.test(item)?/\b(?:stable|stabil|flat|remain)\w*\b/i:null;return modelTraceEvidence.some(evidence=>(!subject||subject.test(evidence))&&(!action||action.test(evidence))&&/\b(?:trace|plotted|across|interval|sequential|time)\b/i.test(evidence));};
  const evidenceForClaim=item=>numericEvidence.find(evidence=>new RegExp(evidence.pidName==='Long FT #1'?'\\b(?:Long FT #1|LTFT(?: B1)?)\\b':evidence.pidName==='Short FT #1'?'\\b(?:Short FT #1|STFT(?: B1)?)\\b':evidence.pidName==='O2S B1S2'?'\\b(?:O2S? B1S2|B1S2|downstream)\\b':evidence.pidName==='AFS B1S1'?'\\b(?:AFS(?: Voltage)? B1S1|A/F B1S1|upstream)\\b':'\\b(?:Engine Speed|RPM)\\b','i').test(item));
  const numericConflicts=[];
  const numericClaimValid=item=>{const evidence=evidenceForClaim(item);if(!evidence)return true;let conflict='';if(!evidence.currentMinMaxConsistent)conflict=`${evidence.pidName} INTERNAL NUMERIC INCONSISTENCY`;else if(!evidence.crossesZero&&/\b(?:cross(?:es|ed|ing)? zero|negative (?:and|to) positive|positive (?:and|to) negative|between negative and positive|changes? sign)\b/i.test(item))conflict=`${evidence.pidName} ZERO-CROSSING CLAIM`;else if(evidence.rangeSign==='NEGATIVE_ONLY'&&/\b(?:positive|above zero)\b/i.test(item))conflict=`${evidence.pidName} SIGN CLAIM`;else if(evidence.rangeSign==='POSITIVE_ONLY'&&/\b(?:negative|below zero)\b/i.test(item))conflict=`${evidence.pidName} SIGN CLAIM`;if(!conflict&&evidence.numericRange){const numbers=[...String(item).matchAll(/[-+]?\d+(?:\.\d+)?\s*(?=%|V\b|RPM\b)/gi)].map(match=>Number(match[0]));if(numbers.some(value=>value<evidence.minimum-1e-6||value>evidence.maximum+1e-6))conflict=`${evidence.pidName} OUT-OF-RANGE CLAIM`;}if(conflict)numericConflicts.push(conflict);return !conflict;};
  const originalNarrative=[...(graph.observed||[]),...(graph.interpretation||[]),...(graph.unreadableOrUncertain||[])],initialStaticContradiction=dynamic&&originalNarrative.some(item=>staticContradiction.test(item)),snapshotConflictCount=dynamic?0:originalNarrative.filter(unsupportedSnapshotClaim).length;
  const interpretation=(graph.interpretation||[]).map(normalizePidTerminology).filter(item=>!forbidden.some(rule=>rule.test(item))).filter(numericClaimValid).filter(item=>temporalClaimSupported(item)).filter(item=>!dynamic||!staticContradiction.test(item)).filter(item=>dynamic||!temporalInference.test(item)).filter(item=>dynamic||!unsupportedSnapshotClaim(item)).filter(item=>dynamic||!hasDisplayedRanges||!/(?:negative|positive).{0,24}(?:fuel trim|long-term|short-term)/i.test(item)).filter(item=>dynamic||!/(?:\blean\b|\brich\b|stuck lean|stuck rich)/i.test(item)).filter(item=>dynamic||supportedCriterion||!/(?:mildly abnormal|\babnormal\b|\bpass(?:es|ed)?\b|\bfail(?:s|ed|ure)?\b)/i.test(item)).filter(item=>!(rearO2!==null&&rearO2>=.7&&/(?:low.{0,20}lean|lean.{0,20}low)/i.test(item))).filter(item=>!(wideband&&/0\.1.{0,20}0\.9|narrowband/i.test(item)));
  const analysisMode=dynamic?'TEMPORAL_GRAPH':'PID_SNAPSHOT';
  const exactXAxisTimeScale=/\b(?:seconds?|milliseconds?|ms|sec)\s*(?:\/|per)\s*(?:division|div)|\btime scale\s*(?:is|:)\s*[-+\d]/i.test(all)?'READABLE':/\b(?:time scale|x-axis|horizontal scale).{0,30}(?:unreadable|not readable|unclear|not visible)/i.test(uncertaintySource)?'UNREADABLE':dynamic?'UNREADABLE':'ABSENT',temporalBehavior=dynamic?(exactXAxisTimeScale==='READABLE'?'READABLE':'PARTIALLY_READABLE'):'UNREADABLE';
  const temporalDataAvailability=!dynamic?'NO_TEMPORAL_DATA':exactXAxisTimeScale==='READABLE'?'ABSOLUTE_TEMPORAL_DATA_AVAILABLE':'RELATIVE_TEMPORAL_DATA_AVAILABLE';
  const evidenceType={hasAxes,hasGridlines,hasPlottedTraces,hasMultipleTraceSamples,hasTemporalOrdering:dynamic,hasReadableTimeScale:exactXAxisTimeScale==='READABLE',hasReadableNumericValues:numericEvidence.length>0,isStaticPidTable:!dynamic&&numericEvidence.length>0,isTimeSeriesGraph:dynamic,timeSeriesAvailable:dynamic,exactTimeScaleKnown:exactXAxisTimeScale==='READABLE'};
  const reasoningEvidence={analysisMode,temporalRoutingDecision:dynamic?'TIME SERIES':'SNAPSHOT',temporalInterpretationPermissions:dynamic?'ENABLED':'STATIC VALUES ONLY',temporalClaimValidation:'PASS',temporalClaimConflictDetected:snapshotConflictCount?'CORRECTED':'NONE',analysisModeSource:'CANONICAL_TEMPORAL_ROUTER',pidPresentationType:dynamic?'TIME_SERIES_GRAPH':'STATIC_NUMERIC',traceEvidence:dynamic?'DETECTED':'NOT_DETECTED',snapshotStatisticalEvidence:hasDisplayedRanges?'CURRENT_MIN_MAX':'CURRENT_ONLY',visibleTraceEvidence:dynamic?'PRESENT':'ABSENT',temporalClaimEvidenceGate:'APPLIED',temporalDataAvailability,exactXAxisTimeScale,temporalBehavior,displayedRangesAvailable:hasDisplayedRanges,rangeValidation:invalidReadings.length?'UNCERTAIN_VALUES_REMOVED':'PASS',sensorTypeDetected:wideband?'WIDEBAND_AIR_FUEL_AND_CONVENTIONAL_DOWNSTREAM_O2':rearO2!==null?'CONVENTIONAL_NARROWBAND_O2':'NOT_CONFIRMED',fuelTrimPolarity:validStft!==null||validLtft!==null?((validStft||0)+(validLtft||0)<0?'NEGATIVE_PCM_REMOVING_FUEL':(validStft||0)+(validLtft||0)>0?'POSITIVE_PCM_ADDING_FUEL':'NEAR_ZERO'):'NOT_AVAILABLE',combinedTrim:validStft!==null&&validLtft!==null?Math.round((validStft+validLtft)*1000)/1000:null,operatingState:rpm!==null&&coolant!==null&&rpm>=500&&rpm<=1100&&coolant>=160?'WARM_NEAR_IDLE':'NOT_CONFIRMED',dynamicTraceEvidenceAvailable:dynamic,temporalEvidenceSource:dynamic?'VISIBLE_PLOTTED_TRACE_HISTORY':'STATIC_SNAPSHOT_ONLY',supportedCriterionAvailable:supportedCriterion,catalystComparisonEvidenceAvailable:catalystComparison,diagnosticCertainty:invalidReadings.length?'INDETERMINATE_PENDING_NUMERIC_VERIFICATION':dynamic?'SUPPORTED_BY_DYNAMIC_TRACE':supportedCriterion?'SUPPORTED_BY_VISIBLE_CRITERION':'STATIC_SNAPSHOT_INDETERMINATE'};
  for(const [name,reading] of invalidReadings)interpretation.push(`${name} numeric evidence is internally inconsistent in this capture. ${reading.inconsistencyReason==='MIN_GREATER_THAN_MAX'?'The reported Min is greater than Max.':'The displayed Current value does not fall within the reported Min/Max range.'} Oliver will not interpret that PID until the data is verified.`);
  if(rpm!==null&&coolant!==null&&reasoningEvidence.operatingState==='WARM_NEAR_IDLE')interpretation.push(`Engine appears warm and near idle at approximately ${rpm} RPM and ${coolant}°F; this does not by itself prove every test condition is valid.`);
  if(reasoningEvidence.combinedTrim!==null){const combined=reasoningEvidence.combinedTrim,amount=Math.abs(combined).toFixed(1);interpretation.push(combined<0?`At the captured instant, combined Bank 1 fuel trim is approximately ${combined.toFixed(3)}%; the displayed commands total approximately ${amount}% fuel removal. This single frame does not establish sustained mixture-control behavior or a fault.`:combined>0?`At the captured instant, combined Bank 1 fuel trim is approximately +${combined.toFixed(3)}%; the displayed commands total approximately ${amount}% fuel addition. This single frame does not establish sustained mixture-control behavior or identify a cause.`:'Combined Bank 1 fuel trim is near zero at the captured instant; one frame does not establish sustained mixture-control behavior.');}
  for(const [name,reading] of [['Long FT #1',ltftReading],['Short FT #1',stftReading]])if(reading.current!==null&&reading.range){const sign=reading.current<0?'removing':reading.current>0?'adding':'commanding no net',rangeSign=reading.range.maximum<0?'negative throughout':reading.range.minimum>0?'positive throughout':reading.range.minimum===0&&reading.range.maximum===0?'zero throughout':'inclusive of zero',crossingQualification=reading.range.minimum<0&&reading.range.maximum>0?` The displayed range does not support characterizing the entire capture as consistently ${reading.current<0?'negative':reading.current>0?'positive':'zero'}.`:'';interpretation.push(`Current ${name} is ${reading.current>0?'+':''}${reading.current}%, indicating the PCM is ${sign} fuel at the captured instant. The displayed range extends from ${reading.range.minimum>0?'+':''}${reading.range.minimum}% to ${reading.range.maximum>0?'+':''}${reading.range.maximum}%. ${name} ranged from approximately ${reading.range.minimum>0?'+':''}${reading.range.minimum}% to ${reading.range.maximum>0?'+':''}${reading.range.maximum}% and is ${rangeSign} in the displayed numeric evidence.${crossingQualification}`);}
  if(rpmReading.current!==null&&rpmReading.range)interpretation.push(`Engine Speed is currently ${rpmReading.current} RPM, with a displayed captured range of ${rpmReading.range.minimum}–${rpmReading.range.maximum} RPM. Engine Speed ranged from approximately ${rpmReading.range.minimum} to ${rpmReading.range.maximum} RPM. These statistics do not establish direction or change over time.`);
  if(afs!==null&&wideband)interpretation.push(`The captured upstream A/F sensor value is approximately ${afs} V and near its displayed center region, but one value cannot verify sensor performance. Evaluate trace response, commanded mixture changes, operating conditions, and fuel-trim reaction.`);
  if(rearO2!==null){const range=rearO2Reading.range?`${rearO2Reading.range.minimum.toFixed(3)}–${rearO2Reading.range.maximum.toFixed(3)} V`:'';interpretation.push(range?`O2S B1S2 is currently ${rearO2} V, with a displayed range of ${range}. O2S B1S2 is displayed in a ${rearO2Reading.range.maximum<=.3?'low-':rearO2Reading.range.minimum>=.7?'high-':''}voltage range of approximately ${rearO2Reading.range.minimum.toFixed(3)} to ${rearO2Reading.range.maximum.toFixed(3)} V during the captured interval. Whether this behavior is normal depends on operating condition, sensor type, mixture state, and system context.`:`O2S B1S2 is currently ${rearO2} V. This is a ${rearO2<=.3?'low':rearO2>=.7?'high':'midrange'} current voltage reading, but the available snapshot/range evidence is insufficient to determine mixture state, sensor switching behavior, sensor health, or catalyst efficiency.`);}
  if((rearO2!==null||/catalyst|p0420/i.test(all))&&!catalystComparison)interpretation.push('Insufficient dynamic graph evidence to determine catalyst efficiency from this capture alone.');
  if(dynamic)interpretation.push(exactXAxisTimeScale==='READABLE'?'Plotted PID trace history is visible across the captured interval, so relative temporal behavior can be evaluated where the trace shape is readable.':'Exact horizontal time scale is unreadable, but plotted PID trace history and relative signal behavior across the captured interval are visible. Exact frequency, timestamps, and response time cannot be calculated from this image.');
  if(!dynamic)interpretation.push(hasDisplayedRanges?'The capture provides current PID values and displayed Min/Max range information, but no sufficiently resolved time-series trace is available. These ranges establish the numerical values represented in the capture but do not provide chronological direction or enough information to determine switching rate, oscillation, response time, correlation, transient response, or sustained behavior.':'Only instantaneous PID readings are available; no time-based behavior can be determined from this static snapshot.');
  const allCoreChannelsPresent=[evidenceInventory.upstreamAirFuel,evidenceInventory.downstreamO2,evidenceInventory.shortTermFuelTrim,evidenceInventory.longTermFuelTrim,evidenceInventory.engineSpeed].every(state=>state==='PRESENT');
  const redundantGraphCapture=/\b(?:capture|acquire|record|request|graph|monitor).{0,100}(?:upstream|a\/f|downstream|o2|signals?|pids?|live data).{0,80}(?:simultaneous|together|over time|time-series|graph)|\b(?:capture|acquire|record).{0,50}(?:signals?|pids?|live data).{0,30}over time|\b(?:simultaneous|together).{0,80}(?:upstream|a\/f).{0,80}(?:downstream|o2).{0,80}(?:data|signals?|graph)\b/i;
  const candidateNext=graph.nextTest||[],rejectedCandidates=dynamic?candidateNext.filter(redundantGraphCapture.test.bind(redundantGraphCapture)):[],proposedNext=candidateNext.filter(item=>!rejectedCandidates.includes(item)&&!/\b(?:normal|expected|replace no components?|no action)\b/i.test(item));
  let unresolvedQuestion='',nextTestReason='',nextTest;
  if(invalidReadings.length){unresolvedQuestion=`Are the reported Current/Min/Max values correct for ${invalidLabels.join(', ')}?`;nextTest=[`Reconfirm ${invalidLabels.join(', ')} Current/Min/Max because the captured values are internally inconsistent.`];nextTestReason='The existing evidence for this PID is invalid, so verifying only the inconsistent channel is the smallest advancing step.'}
  else if(dynamic&&proposedNext.length){unresolvedQuestion='What minimum additional evidence resolves the remaining diagnostic uncertainty?';nextTest=proposedNext.slice(0,1);nextTestReason='This step adds evidence not already established by the active graph.'}
  else if(evidenceInventory.closedLoopStatus!=='PRESENT'&&(evidenceInventory.upstreamAirFuel==='PRESENT'||evidenceInventory.downstreamO2==='PRESENT'||evidenceInventory.shortTermFuelTrim==='PRESENT'||evidenceInventory.longTermFuelTrim==='PRESENT')){unresolvedQuestion='Was the engine operating in closed loop when this evidence was captured?';nextTest=['Acquire Fuel System Status / Closed Loop Status to verify whether the engine was operating in closed loop when the PID evidence was captured.'];nextTestReason="Closed-loop status is required because the current sensor and fuel-trim values cannot be assigned full diagnostic significance without knowing the PCM's fuel-control state."}
  else if(!dynamic){unresolvedQuestion='How do the already-present upstream and downstream signals behave over time?';nextTest=['Record a synchronized time-series capture of the already-present upstream A/F and downstream O2 channels under the verified operating condition.'];nextTestReason='The sensor PIDs are already present as static evidence; the missing evidence characteristic is synchronized temporal behavior, not sensor identity.'}
  else if(evidenceInventory.engineLoad!=='PRESENT'){unresolvedQuestion='What engine load accompanied the visible sensor and fuel-trim behavior?';nextTest=['Add calculated load or absolute load while retaining the current sensor channels so their behavior can be correlated with engine operating condition.'];nextTestReason='The active graph contains the core channels, but engine load is not visible.'}
  else if(evidenceInventory.controlled2500Rpm!=='PRESENT'){unresolvedQuestion='Does the upstream/downstream relationship persist under a controlled elevated operating condition?';nextTest=['Hold the engine near 2,500 RPM in closed loop and capture the same upstream A/F, downstream O2, STFT, LTFT, and RPM channels.'];nextTestReason='The channels are already available; the missing evidence is a controlled steady operating condition.'}
  else{unresolvedQuestion='Do the upstream and downstream sensors respond appropriately to a controlled mixture change?';nextTest=['Perform a vehicle-appropriate controlled rich/lean response test while observing the existing upstream A/F and downstream O2 channels.'];nextTestReason='The current graph already contains the core channels and controlled operating state; commanded response remains unverified.'}
  const selectedTestName=nextTest?.[0]||'',closedLoopSelection=/Fuel System Status|Closed Loop/i.test(selectedTestName),temporalSelection=/time-series|over time|graph/i.test(selectedTestName),loadSelection=/\bload\b/i.test(selectedTestName),controlledRpmSelection=/2,?500 RPM|controlled elevated/i.test(selectedTestName),responseSelection=/rich\/lean|mixture change|response test/i.test(selectedTestName),diagnosticObjective=closedLoopSelection?'Establish whether the PCM was controlling fuel in closed loop when the mixture and fuel-trim evidence was captured.':temporalSelection?'Establish synchronized relative behavior of the already-present upstream and downstream sensor signals.':loadSelection?'Correlate the existing sensor evidence with engine load.':controlledRpmSelection?'Evaluate the existing channels under a controlled elevated operating condition.':responseSelection?'Verify upstream and downstream sensor response to a controlled mixture change.':invalidReadings.length?'Verify the inconsistent PID triplet before interpretation.':selectedTestName?'Resolve the remaining diagnostic question addressed by the selected evidence test: '+selectedTestName:'',evidenceMissing=closedLoopSelection?['Fuel System Status / Closed Loop state']:temporalSelection?['Synchronized time-series behavior']:loadSelection?['Engine load']:controlledRpmSelection?['Controlled 2,500 RPM operating condition']:responseSelection?['Controlled mixture-response evidence']:invalidReadings.length?invalidLabels:selectedTestName?[selectedTestName]:[],evidenceAlreadyAvailable=Object.freeze([...(evidenceInventory.channels||[])]),selectedNextTest=selectedTestName&&diagnosticObjective?Object.freeze({testName:selectedTestName,diagnosticObjective,evidenceAlreadyAvailable,evidenceMissing:Object.freeze([...evidenceMissing]),selectionReason:nextTestReason,blockedInterpretation:unresolvedQuestion,source:'CANONICAL_EVIDENCE_AWARE_NEXT_TEST_SELECTOR'}):null,nextTestRationaleAligned=Boolean(selectedNextTest&&selectedNextTest.selectionReason&&selectedNextTest.evidenceMissing.length&&selectedNextTest.diagnosticObjective),alignedNextTest=nextTestRationaleAligned?nextTest:['Undetermined — next-test rationale could not be aligned with available evidence.'],alignedNextTestReason=nextTestRationaleAligned?selectedNextTest.selectionReason:'A reliable evidence-aligned next test could not be established from the current snapshot.';
  const rangeUncertainty=invalidReadings.map(([name,reading])=>`${name} Current ${reading.current===null?'uncertain':reading.current}; Min/Max uncertain because the extracted relationship failed MIN <= CURRENT <= MAX validation.`);
  const snapshotUncertainty=(graph.unreadableOrUncertain||[]).filter(item=>!unsupportedSnapshotClaim(item)&&!/(?:time scale|x-axis|horizontal scale).*(?:unreadable|relative|unknown)/i.test(item));
  const unreadableOrUncertain=dynamic?[...new Set([...(graph.unreadableOrUncertain||[]).filter(item=>!staticContradiction.test(item)&&!/temporal behavior (?:is )?(?:unreadable|unavailable)/i.test(item)),...rangeUncertainty,...(exactXAxisTimeScale==='UNREADABLE'?['Exact horizontal time scale is unreadable; relative trace behavior remains visible.']:[])])]:[...new Set([...snapshotUncertainty,...rangeUncertainty,hasDisplayedRanges?'Temporal behavior cannot be evaluated from this static PID snapshot; displayed minimum/maximum ranges are not chronological trace evidence.':'No reliable time-series information is available from this static PID snapshot.'])];
  const invalidRangeText=item=>invalidLabels.some(name=>new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace('Long FT #1','(?:Long FT #1|LTFT B1)').replace('Short FT #1','(?:Short FT #1|STFT B1)').replace('Engine Speed','(?:Engine Speed|RPM)'),'i').test(item))&&/\b(?:min(?:imum)?|max(?:imum)?|range)\b/i.test(item);
  const observed=(graph.observed||[]).map(normalizePidTerminology).filter(numericClaimValid).filter(item=>!invalidRangeText(item)).filter(item=>dynamic||!unsupportedSnapshotClaim(item)),valuesAndScales=(graph.valuesAndScales||[]).map(normalizePidTerminology).filter(numericClaimValid).filter(item=>!invalidRangeText(item)).filter(item=>dynamic||!unsupportedSnapshotClaim(item)),traceFindings=dynamic?modelTraceEvidence.filter(numericClaimValid):[];
  const normalInterpretation=[...new Set(interpretation)].filter(item=>!dynamic||!staticContradiction.test(item)).slice(0,16),evidenceConsistencyFailures=invalidReadings.map(([name,reading])=>{const evidence=numericEvidence.find(item=>item.pidName===name),failure=reading.inconsistencyReason==='CURRENT_ABOVE_MAX'?'Current exceeds Max.':reading.inconsistencyReason==='CURRENT_BELOW_MIN'?'Current is below Min.':reading.inconsistencyReason==='MIN_GREATER_THAN_MAX'?'Min exceeds Max.':reading.inconsistencyReason==='CONTRADICTORY_DUPLICATE_VALUES'?'Contradictory duplicate numeric values were reported.':reading.inconsistencyReason==='NUMERIC_PARSE_FAILURE'?'A named numeric field could not be parsed.':reading.inconsistencyReason==='NON_FINITE_VALUE'?'A numeric field is not finite.':'Numeric evidence is internally inconsistent.';return Object.freeze({pidName:name,current:evidence?.rawCurrent??evidence?.current??'ABSENT',minimum:evidence?.rawMinimum??evidence?.minimum??'ABSENT',maximum:evidence?.rawMaximum??evidence?.maximum??'ABSENT',unit:evidence?.unit||'',failureCode:reading.inconsistencyReason,failure})}),hardNumericFailure=evidenceConsistencyFailures.length>0,contradictionPresent=dynamic&&normalInterpretation.some(item=>staticContradiction.test(item)),missingFuelControlContext=evidenceInventory.closedLoopStatus!=='PRESENT'&&(evidenceInventory.upstreamAirFuel==='PRESENT'||evidenceInventory.downstreamO2==='PRESENT'||evidenceInventory.shortTermFuelTrim==='PRESENT'||evidenceInventory.longTermFuelTrim==='PRESENT'),dependencyLanguage=/\b(?:cannot|can not|insufficient|depends? on|without|unreadable|unknown|not (?:verified|confirmed)|does not (?:verify|confirm|establish|prove))\b/i,explicitUncertainty=[...normalInterpretation,...unreadableOrUncertain].some(item=>dependencyLanguage.test(item)),timeBaseLimited=dynamic&&exactXAxisTimeScale!=='READABLE',significanceAlignmentRequired=missingFuelControlContext||explicitUncertainty||timeBaseLimited,unsupportedVerification=/\b(?:normal(?:ly)?|expected|good|healthy|proper(?:ly)?|functioning normally|verified|confirmed normal)\b/i,unsupportedTiming=timeBaseLimited?/\b(?:switching frequency|switching rate|cycle rate|response speed|response time|slow response|fast response|correct switching)\b/i:null,alignedInterpretation=normalInterpretation.filter(item=>!(significanceAlignmentRequired&&unsupportedVerification.test(item)&&!dependencyLanguage.test(item))).filter(item=>!unsupportedTiming||!unsupportedTiming.test(item)||dependencyLanguage.test(item)),finalInterpretation=hardNumericFailure?[]:alignedInterpretation,semanticConsistencyStatus=hardNumericFailure?'FAIL_NUMERIC_EVIDENCE':contradictionPresent?'FAIL':initialStaticContradiction?'RECONCILED':'PASS',freshResultVerification='PASS',evidenceResultVerification=hardNumericFailure||contradictionPresent?'FAIL':'PASS',diagnosticSignificance=hardNumericFailure||contradictionPresent||significanceAlignmentRequired?'INDETERMINATE':dynamic||supportedCriterion?graph.diagnosticSignificance:'INDETERMINATE',diagnosticSignificanceReason=hardNumericFailure?'NUMERIC_EVIDENCE_INCONSISTENCY_DETECTED':contradictionPresent?'PENDING_SEMANTIC_RECONCILIATION':significanceAlignmentRequired?'MISSING_CONTEXT_OR_UNVERIFIED_PERFORMANCE':'VALIDATED_EVIDENCE';
  const numericValidation=Object.freeze({finalizedEvidenceFrozen:Object.isFrozen(numericEvidence)&&numericEvidence.every(Object.isFrozen)?'PASS':'FAIL',validationStage:'POST_FINALIZATION_PRE_INTERPRETATION',signNormalization:'PASS',normalization:'PASS',currentMinMaxConsistency:invalidReadings.length?'FAIL':'PASS',invalidPidEvidence:Object.freeze([...invalidLabels]),sourceStatus:invalidReadings.length?'SOURCE_ANALYZER_VALUES_INCONSISTENT':'PASS',zeroCrossingValidation:'PASS',directionalClaimValidation:'PASS',dependentInterpretationSuppressed:'PASS',diagnosticSignificanceGuard:'PASS',interpretationGuard:'PASS',conflicts:Object.freeze([...new Set(numericConflicts)]),correction:numericConflicts.length?'PASS':'NOT_REQUIRED'});
  return {...graph,analysisMode,evidenceType,observed:hardNumericFailure?[]:observed,valuesAndScales:hardNumericFailure?[]:valuesAndScales,traceFindings:hardNumericFailure?[]:traceFindings,interpretation:finalInterpretation,diagnosticSignificance,diagnosticSignificanceReason,diagnosticSignificanceAlignment:Object.freeze({status:significanceAlignmentRequired?'APPLIED':'PASS',missingFuelControlContext,timeBaseLimited,explicitUncertainty,unsupportedVerificationClaimsRemoved:normalInterpretation.length-alignedInterpretation.length}),evidenceConsistencyFailures,numericEvidence,numericValidation,evidenceInventory,evidenceInventoryStatus:hardNumericFailure?'WITHHELD_INVALID_EVIDENCE':'PASS',semanticConsistencyStatus,freshResultVerification,evidenceResultVerification,unresolvedQuestion:hardNumericFailure?'':unresolvedQuestion,nextTest:hardNumericFailure||contradictionPresent?[]:alignedNextTest,nextTestReason:hardNumericFailure?'':contradictionPresent?'Withheld until classifier and interpretation evidence agree.':alignedNextTestReason,selectedNextTest:hardNumericFailure||contradictionPresent?null:selectedNextTest,nextTestRationaleAligned:hardNumericFailure||contradictionPresent?false:nextTestRationaleAligned,redundantTestCheck:hardNumericFailure?'NOT_RUN_INVALID_EVIDENCE':'PASS',candidateNextTestRejected:hardNumericFailure?'NORMAL_SELECTION_BYPASSED':rejectedCandidates.length?'DUPLICATES ACTIVE EVIDENCE':'NONE',nextTestSelection:hardNumericFailure?'BLOCKED_NUMERIC_EVIDENCE':contradictionPresent?'WITHHELD':nextTestRationaleAligned?'PASS':'INDETERMINATE',unreadableOrUncertain,reasoningEvidence,contradictionGuard:hardNumericFailure||contradictionPresent?'FAIL':'PASS'};
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

export function normalizeVehicleAnalysisContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const text = (value, max) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
  const year = text(raw.year, 4);
  const context = {
    year: /^\d{4}$/.test(year) ? year : '',
    make: text(raw.make, 80),
    model: text(raw.model, 100),
    engine: text(raw.engine, 100),
    fuelType: text(raw.fuelType, 60),
    drivetrain: text(raw.drivetrain, 100),
    configuration: text(raw.configuration, 180),
    vin: /^[A-HJ-NPR-Z0-9]{17}$/.test(text(raw.vin, 17).toUpperCase()) ? text(raw.vin, 17).toUpperCase() : '',
    activeCaseId: text(raw.activeCaseId, 128),
    repairOrderId: text(raw.repairOrderId, 128),
    vehicleId: text(raw.vehicleId, 160),
    contextVersion: text(raw.contextVersion, 240),
    source: text(raw.source, 80)
  };
  return context.year && context.make && context.model ? context : null;
}

function vehicleContextPrompt(context) {
  if (!context) return 'No active repair-order vehicle context was supplied.';
  const known = [context.year, context.make, context.model, context.engine, context.fuelType, context.drivetrain, context.configuration].filter(Boolean).join(' · ');
  return `Active repair-order vehicle context (non-visual reference only): ${known || 'limited vehicle details'}${context.vin ? ' · VIN is available for configuration reference' : ''}. Source: ${context.source || 'active case snapshot'}. First use this exact vehicle/engine configuration to check whether the proposed component and location are physically plausible for this vehicle; use visible landmarks, orientation, adjacent assemblies, harness routing, brackets, hoses, and mounting geometry to reduce confidence or choose an alternative when they conflict. This context may orient a likely identification or expected connection, but it is never proof that a part, connection, defect, installation state, or vehicle-side location is visible. Image pixels override it whenever they conflict.`;
}

function electricalCircuitCandidate(semanticResult, componentIdentification) {
  const text = [...(semanticResult?.evidence || []), ...(semanticResult?.objects || []), ...(semanticResult?.automotiveEvidence || []), componentIdentification?.primaryComponent || '', ...(componentIdentification?.secondaryComponents || [])].join(' ');
  const pointer = /\b(?:finger|hand|screwdriver|probe|pick|test lead|flashlight|arrow|pointer)\b.{0,100}\b(?:pointing|indicat|toward|at)\b|\b(?:pointing|indicat)\b.{0,100}\b(?:finger|hand|screwdriver|probe|pick|test lead|flashlight|arrow|pointer)\b/i.test(text);
  const electrical = /\b(?:abs|wheel[- ]?speed|sensor|connector|wiring|wire|harness|terminal|ground|actuator|solenoid|switch|fuse|relay|module|motor|electrical|electronic|coil|injector|network|can)\b/i.test(text);
  const wheelArea = /\b(?:wheel|suspension|axle|cv boot|brake|hub)\b/i.test(text);
  return pointer && (electrical || wheelArea) || electrical;
}

function buildElectricalCircuitAnalysis(semanticResult, componentIdentification, visualConditionInspection, transactionId, imageHash) {
  if (!electricalCircuitCandidate(semanticResult, componentIdentification)) return null;
  const visible = visualConditionInspection?.connectionAssessments || [];
  const defects = visible.filter(item => ['CLEAR_DEFECT','POSSIBLE_CONCERN','RESIDUE_OR_STAINING'].includes(item.findingType)).map(item => item.visibleEvidence);
  const target = componentIdentification?.primaryComponent && componentIdentification.status !== 'FAILED' ? componentIdentification.primaryComponent : 'Technician-indicated electrical component / connector / harness area';
  return {
    status: 'EXECUTED', target, targetConfidence: componentIdentification?.normalizedComponentConfidence ?? null,
    diagramStatus: 'DIAGRAM_REQUIRED', diagramMessage: 'Circuit architecture review executed from the identified target and available vehicle context. Vehicle-specific wiring diagram, pinout, and specifications are required before circuit condemnation.',
    visibleCircuitStatus: visible.length ? 'INSPECTED_LIMITED_TO_VISIBLE_AREAS' : 'NOT_VISIBLE_ADDITIONAL_PHOTO_REQUIRED', visibleFindings: defects,
    testGuidance: ['Inspect the connector body, terminal engagement, lock/retainer, harness routing, clips, and insulation at the indicated target.', 'Verify applicable scan data and connector condition first; then use vehicle-specific wiring information to test power, ground, reference/signal, or continuity as applicable.', 'VERIFY VEHICLE-SPECIFIC SPECIFICATION BEFORE CONDEMNING COMPONENT.'],
    wiringAnalysisExecuted: true, visibleCircuitAnalysisExecuted: true, testGuidanceGenerated: true, semanticRequestId: transactionId, imageHash
  };
}

const directMatingEvidence = evidence => hasAffirmativeMatingEvidence({ visibleEvidence: String(evidence || '') });
const directSeparationEvidence = evidence => {
  const text = String(evidence || '');
  const gap = /\b(?:separat(?:ed|ion)|disconnect(?:ed|ion)|air\s+gap|gap)\b/i.test(text);
  const electricalPair = /\b(?:connector|plug|terminal)\b/i.test(text) && /\b(?:socket|receptacle|post)\b/i.test(text);
  const fluidPair = /\b(?:hose|tube|line|pipe)\b/i.test(text) && /\b(?:fitting|port|coupler)\b/i.test(text);
  const explicitVisibleState = /\b(?:connector|plug|terminal|hose|tube|line|pipe|wire|harness)\b[^.]{0,100}\b(?:appears\s+)?(?:clearly\s+|visibly\s+|physically\s+)?(?:disconnected|separated|unmated|unplugged|unconnected|hanging\s+(?:free|loose))\b|\b(?:visibly|clearly|physically)\s+(?:disconnected|separated|unmated|unplugged|unconnected)\b/i.test(text);
  const notInserted = /\b(?:connector|plug|terminal|hose|tube|line|pipe)\b[^.]{0,120}\bnot\s+(?:fully\s+|physically\s+)?inserted\s+(?:into|in|onto|on)\b/i.test(text);
  const freeElectricalTermination = /\b(?:connector|plug|terminal)\b/i.test(text) && /\b(?:harness|wire|wiring)\b[^.]{0,100}\bterminat(?:es|ed|ing)\b/i.test(text) && /\b(?:exposed|open|free|unmated)\b[^.]{0,100}\b(?:mating|interface|face|end|connector|plug)\b|\bnot\s+connected\s+to\s+(?:a\s+)?visible\s+interface\b/i.test(text);
  const hedgedOnly = /\b(?:possible|possibly|may|might|could|suspect(?:ed)?)\b[^.]{0,80}\b(?:disconnected|separated|unmated|unplugged|unconnected)\b/i.test(text) && !/\b(?:visibly|clearly|physical(?:ly)?|air\s+gap|hanging\s+(?:free|loose))\b/i.test(text);
  return !hedgedOnly && !/\b(?:no|without)\s+(?:an?\s+)?(?:visible\s+|abnormal\s+)?(?:gap|separation|disconnection)\b/i.test(text) && ((gap && (electricalPair || fluidPair)) || explicitVisibleState || notInserted || freeElectricalTermination);
};
const directPhysicalDefectEvidence = evidence => /\b(?:broken|crack(?:ed)?|torn|split|leak(?:ing)?|visible\s+(?:fluid\s+)?(?:residue|staining|seepage|wetness)|(?:fluid\s+)?(?:residue|staining|seepage|wetness)\s+(?:is\s+)?visible|corrosion|corroded|rust(?:ed|y|ing)?|damaged\s+(?:wire|wiring|harness|component|terminal|insulation)|(?:wire|wiring|harness|component|terminal|insulation)\b[^.]{0,60}\b(?:broken|cracked|damaged)|missing\s+(?:(?:fastener|bolt|clip|retainer|component)\b|from\s+(?:an?\s+)?(?:expected\s+)?visible\s+mounting\s+point)|(?:fastener|bolt|clip|retainer|component)\b[^.]{0,80}\b(?:visibly\s+)?missing\b|displaced\s+clamp|clamp\b[^.]{0,60}\b(?:visibly\s+)?displaced|unplugged\s+harness|terminal\s+(?:removed|corroded))\b/i.test(String(evidence || ''));
const partialSeatingEvidence = evidence => /\b(?:partially|not fully|uneven)\s+(?:seated|inserted|engaged)|\b(?:exposed|visible)\s+(?:connector neck|sealing surface|insertion gap)\b/i.test(String(evidence || ''));
const suspectSeatingEvidence = evidence => /\b(?:loose|displaced|misalign|corrosion|rust|clamp[^.]{0,80}(?:rearward|displaced)|possible|suspect)\b/i.test(String(evidence || ''));
const observedObjectFor = finding => /\bhose|tube|line\b/i.test(`${finding?.observedObject || ''} ${finding?.visibleEvidence || ''}`) ? 'Hose / tube connection' : /\bclamp\b/i.test(`${finding?.observedObject || ''} ${finding?.visibleEvidence || ''}`) ? 'Clamp connection' : /\bterminal\b/i.test(`${finding?.observedObject || ''} ${finding?.visibleEvidence || ''}`) ? 'Electrical terminal' : 'Electrical connector';
const canonicalFindingKey = finding => finding?.candidateId ? `candidate:${finding.candidateId}` : `${observedObjectFor(finding).toLowerCase()}|${String(finding?.location || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;

const locationBucket = value => String(value || '').toLowerCase().match(/\b(?:upper|center|lower|top|bottom)[- ](?:left|center|right)\b/)?.[0].replace(' ', '-') || String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const contradictionFindingKey = finding => `${canonicalComponentFamily(finding?.observedObject || observedObjectFor(finding))}|${locationBucket(finding?.location)}`;
const visibleDefectKind = evidence => {
  const text = String(evidence || '').trim();
  if (!text) return null;
  const explicitVisual = /\b(?:visible|visibly|clearly|physical(?:ly)?|air\s+gap|hanging\s+(?:free|loose)|exposed|empty\s+(?:socket|receptacle|mounting)|not\s+inserted)\b/i.test(text);
  const hedged = /\b(?:possible|possibly|may|might|could|suspect(?:ed)?|uncertain)\b[^.]{0,100}\b(?:disconnect|separat|unmat|unplug|unconnect|broken|crack|missing|leak)\w*\b/i.test(text);
  if (partialSeatingEvidence(text) && (explicitVisual || /\b(?:connector|plug|hose|line|pipe)\b[^.]{0,80}\b(?:partially|improperly|not fully)\b/i.test(text))) return 'PARTIAL_CONNECTION';
  if (directSeparationEvidence(text)) return 'DISCONNECTED_CONNECTION';
  if (/\b(?:corrosion|corroded|rust(?:ed|y|ing)?)\b/i.test(text) && !/\b(?:no|without)\s+(?:visible\s+)?(?:corrosion|rust)\b/i.test(text)) return 'CORROSION';
  if (/\b(?:visible\s+(?:fluid\s+)?(?:residue|staining|seepage|wetness)|(?:fluid\s+)?(?:residue|staining|seepage|wetness)\s+(?:is\s+)?visible|(?:fluid|coolant|oil)\s+(?:is\s+)?visibly\s+leaking|active\s+(?:fluid\s+)?leak)\b/i.test(text) && !/\b(?:no|without)\s+(?:visible\s+)?(?:residue|staining|seepage|wetness|leak)\b/i.test(text)) return 'LEAK_OR_RESIDUE';
  if (!hedged && directPhysicalDefectEvidence(text)) return 'PHYSICAL_DAMAGE';
  return null;
};
const unsupportedLeakClaim = text => {
  const value = String(text || '');
  if (!/\b(?:possible\s+|suspected\s+)?(?:coolant|fluid)\s+leak(?:age)?\b|\bleaking\s+(?:coolant|fluid)\b/i.test(value)) return false;
  const positive = value.replace(/\b(?:no|without|not)\s+(?:visible\s+)?(?:wet(?:ness)?|residue|stain(?:ing)?|seepage|leak(?:age)?|split|disconnect(?:ion|ed)?)\b/gi, '');
  return !/\b(?:wet\s+coolant|coolant\s+(?:residue|stain(?:ing)?|seepage)|visible\s+(?:wetness|residue|staining|seepage|fluid)|active\s+(?:seepage|leak)|hose\s+(?:is\s+)?(?:split|disconnected)|compromised\s+seal(?:ing)?|displaced\s+clamp[^.]{0,80}\bseal(?:ing)?)\b/i.test(positive);
};
const removeUnsupportedLeakConsequence = text => {
  const value = String(text || '').trim();
  if (!unsupportedLeakClaim(value)) return value;
  if (/\b(?:corrosion|corroded|rust(?:ed|y|ing)?)\b/i.test(value)) return 'Clamp shows visible corrosion/rust.';
  return value.split(/(?<=[.!?])\s+/).filter(sentence => !/\b(?:coolant|fluid)\s+leak(?:age)?\b|\bleaking\s+(?:coolant|fluid)\b/i.test(sentence)).join(' ').trim();
};
const hiddenVerificationLimitation = finding => /\b(?:connector|plug|terminal|wire|harness)\b/i.test(`${finding?.observedObject || ''} ${finding?.visibleEvidence || ''}`) ? 'Terminal condition, pin fit, internal electrical integrity, retention force, and circuit operation require physical verification.' : /\b(?:hose|tube|line|pipe|clamp|fitting|port)\b/i.test(`${finding?.observedObject || ''} ${finding?.visibleEvidence || ''}`) ? 'Hidden sealing surfaces and sealing integrity require physical verification.' : 'Hidden or internal condition and functional integrity require physical verification.';
const contradictoryVisibilityLimitation = value => /\b(?:cannot|can(?:not|'t)|unable|not\s+possible)\b[^.]{0,100}\b(?:visually\s+)?(?:verif(?:y|ied|ication)|determin(?:e|ed|ation)|confirm(?:ed|ation)?)\b[^.]{0,100}\b(?:connection|connected|disconnected|separation|seating|physical\s+state)\b|\b(?:connection|connected|disconnected|separation|seating|physical\s+state)\b[^.]{0,100}\b(?:cannot|can(?:not|'t)|unable)\b[^.]{0,80}\b(?:verif(?:y|ied|ication)|determin(?:e|ed|ation)|confirm(?:ed|ation)?)\b/i.test(String(value || ''));
const findingPriority = item => item?.findingType === 'CLEAR_DEFECT' && visibleDefectKind(item.directVisibleEvidence || item.visibleEvidence) ? 0 : ({ CLEAR_DEFECT: 1, POSSIBLE_CONCERN: 2, RESIDUE_OR_STAINING: 3, UNVERIFIED_CONDITION: 4, SEATING_NOT_RELIABLY_VISIBLE: 5, NO_DEFECT_VISIBLE: 6 }[item?.findingType] ?? 9);

const canonicalConnectionState = state => ({ CONNECTED_VERIFIED: 'CONNECTED', DISCONNECTED_VERIFIED: 'DISCONNECTED', PARTIALLY_SEATED: 'PARTIALLY_DISCONNECTED', LOOSE_OR_SUSPECT: 'LOOSE_OR_UNSEATED', INDETERMINATE: 'UNKNOWN' }[state] || 'UNKNOWN');
const canonicalComponentFamily = value => {
  const text = String(value || '').toLowerCase();
  if (/\begr\b/.test(text)) return 'EGR_CONTROL';
  if (/\b(?:connector|plug|terminal|harness)\b/.test(text)) return 'ELECTRICAL_CONNECTION';
  if (/\b(?:hose|tube|line)\b/.test(text)) return 'FLUID_CONNECTION';
  return text.replace(/\b(?:valve|solenoid|control|assembly|connector)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim() || 'UNKNOWN_COMPONENT';
};
const reconciliationReason = (code, error = null) => ({ code, errorName: error?.name || null, errorMessage: sanitizeDiagnosticText(error?.message) || null });

export function reconcileVisualFindings(condition, { observation = null, relationship = null, vehicleContextState = 'UNAVAILABLE' } = {}) {
  const base = condition && typeof condition === 'object' ? condition : { status: 'UNABLE_TO_INSPECT', connectionAssessments: [] };
  const source = Array.isArray(base.connectionAssessments) ? base.connectionAssessments.map(item => item && typeof item === 'object' ? { ...item, visibleEvidence: removeUnsupportedLeakConsequence(item.visibleEvidence), safetyDrivabilityImpact: unsupportedLeakClaim(`${item.safetyDrivabilityImpact || ''} ${item.visibleEvidence || ''}`) ? null : item.safetyDrivabilityImpact } : item) : [];
  const inferLocation = (text, fallback = '') => {
    const match = String(text || '').match(/\b(?:upper|center|lower|top|bottom)[- ](?:left|center|right)\b/i)?.[0];
    return String(fallback || match || 'Image-relative location cannot be determined reliably.').slice(0, 240);
  };
  const inferObject = (text, fallback = '') => fallback || (/\bclamp\b/i.test(text) ? 'Clamp' : /\b(?:hose|tube|line|pipe)\b/i.test(text) ? 'Hose / tube connection' : /\b(?:wire|wiring|harness)\b/i.test(text) ? 'Wire / harness' : /\b(?:connector|plug|terminal)\b/i.test(text) ? 'Electrical connector' : /\b(?:fastener|bolt|clip|retainer)\b/i.test(text) ? 'Fastener / retainer' : 'Visible component');
  const derived = [];
  const addDerivedFinding = (statement, metadata = {}) => {
    const visibleEvidence = removeUnsupportedLeakConsequence(statement);
    const kind = visibleDefectKind(visibleEvidence);
    if (!kind) return;
    const location = inferLocation(visibleEvidence, metadata.location);
    const observedObject = inferObject(visibleEvidence, metadata.observedObject);
    const duplicate = [...source, ...derived].some(item => item && typeof item === 'object' && visibleDefectKind(item.visibleEvidence || item.directVisibleEvidence) && canonicalComponentFamily(item.observedObject || observedObjectFor(item)) === canonicalComponentFamily(observedObject) && locationBucket(item.location) === locationBucket(location));
    if (duplicate) return;
    const partial = kind === 'PARTIAL_CONNECTION', disconnected = kind === 'DISCONNECTED_CONNECTION';
    derived.push({ findingId: `promoted-${derived.length + 1}`, sourceStage: metadata.sourceStage || 'FINAL_EVIDENCE_PROMOTION', location, observedObject, seatingStatus: disconnected ? 'SEPARATION_OR_GAP_VISIBLE' : partial ? 'POSSIBLE_IMPROPER_SEATING' : 'NOT_RELIABLY_VISIBLE', findingType: 'CLEAR_DEFECT', severity: kind === 'CORROSION' || kind === 'LEAK_OR_RESIDUE' ? 'LOW' : 'MODERATE', findingConfidence: metadata.confidence ?? 80, connectionState: disconnected ? 'DISCONNECTED_VERIFIED' : partial ? 'PARTIALLY_SEATED' : 'INDETERMINATE', connectionStateConfidence: metadata.confidence ?? 80, visibleEvidence, directVisibleEvidence: visibleEvidence, matingComponentVisible: metadata.matingComponentVisible === true, directDamageVisible: true, missingContext: metadata.missingContext && !contradictoryVisibilityLimitation(metadata.missingContext) ? metadata.missingContext : hiddenVerificationLimitation({ observedObject, visibleEvidence }), recommendedVerification: metadata.recommendedVerification || hiddenVerificationLimitation({ observedObject, visibleEvidence }), safetyDrivabilityImpact: null, evidenceProvenance: metadata.sourceStage || 'FINAL_EVIDENCE_PROMOTION' });
  };
  for (const concern of Array.isArray(base.possibleConcerns) ? base.possibleConcerns : []) addDerivedFinding(concern?.appearance, { location: concern?.location, recommendedVerification: concern?.recommendedVerification, sourceStage: 'POSSIBLE_CONCERN_PROMOTION' });
  for (const statement of Array.isArray(base.observedCondition) ? base.observedCondition : []) addDerivedFinding(statement, { sourceStage: 'OBSERVED_CONDITION_PROMOTION' });
  for (const item of Array.isArray(relationship?.observedItems) ? relationship.observedItems : []) addDerivedFinding(item?.visibleStateEvidence || item?.visibleEvidence, { location: item?.itemLocationInImage, observedObject: item?.observedItem, confidence: item?.physicalStateConfidence ?? item?.relationshipConfidence, missingContext: item?.whatCannotBeConfirmed, recommendedVerification: item?.recommendedNextPhotoVerification, sourceStage: 'RELATIONSHIP_EVIDENCE_PROMOTION' });
  const reconciliationErrors = [];
  const reconciled = [];
  [...source, ...derived].forEach((rawItem, index) => {
    try {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) throw new Error('finding is not an object');
      const item = { ...rawItem, findingId: String(rawItem.findingId || rawItem.candidateId || `finding-${index + 1}`).slice(0, 80), sourceStage: String(rawItem.sourceStage || rawItem.evidenceProvenance || 'VISUAL_CONDITION').slice(0, 80), location: String(rawItem.location || 'Image-relative location cannot be determined reliably.').slice(0, 240) };
      const visibleEvidence = String(item.visibleEvidence || item.directVisibleEvidence || '').trim().slice(0, 500);
      if (!visibleEvidence) throw new Error('missing direct visible evidence');
      const defectKind = visibleDefectKind(visibleEvidence);
      const directDisconnected = defectKind === 'DISCONNECTED_CONNECTION';
      const directlyMated = directMatingEvidence(visibleEvidence);
      const directlyDefective = Boolean(defectKind);
      const partiallySeated = defectKind === 'PARTIAL_CONNECTION' || (!directDisconnected && partialSeatingEvidence(visibleEvidence));
      const suspected = !directDisconnected && !directlyMated && !directlyDefective && suspectSeatingEvidence(visibleEvidence);
      const interfaceVisible = /\b(?:connector|plug|terminal|hose|tube|line)\b[^.]{0,140}\b(?:socket|receptacle|fitting|port|post|coupler)\b/i.test(visibleEvidence);
      const claimedVerified = ['CONNECTED_VERIFIED', 'DISCONNECTED_VERIFIED'].includes(item.connectionState);
      if (!claimedVerified && !directlyDefective && !directlyMated) {
        const ceiling = item.connectionState === 'INDETERMINATE' ? 60 : item.connectionState === 'LOOSE_OR_SUSPECT' || item.connectionState === 'PARTIALLY_SEATED' ? 85 : 70;
        reconciled.push({ ...item, observedObject: item.observedObject || observedObjectFor(item), findingConfidence: Math.min(Number.isFinite(item.findingConfidence) ? item.findingConfidence : 0, ceiling), connectionStateConfidence: Math.min(Number.isFinite(item.connectionStateConfidence) ? item.connectionStateConfidence : Number(item.findingConfidence) || 0, ceiling), directVisibleEvidence: visibleEvidence, safetyDrivabilityImpact: unsupportedLeakClaim(`${item.safetyDrivabilityImpact || ''} ${visibleEvidence}`) ? null : item.safetyDrivabilityImpact, reconciliationNote: '' });
        return;
      }
      const connectionState = directDisconnected ? 'DISCONNECTED_VERIFIED' : directlyMated ? 'CONNECTED_VERIFIED' : partiallySeated ? 'PARTIALLY_SEATED' : suspected ? 'LOOSE_OR_SUSPECT' : 'INDETERMINATE';
      const findingType = directlyDefective ? 'CLEAR_DEFECT' : directlyMated ? 'NO_DEFECT_VISIBLE' : partiallySeated || suspected ? 'POSSIBLE_CONCERN' : 'SEATING_NOT_RELIABLY_VISIBLE';
      const seatingStatus = directDisconnected ? 'SEPARATION_OR_GAP_VISIBLE' : directlyMated ? 'NO_GAP_OR_SEPARATION_VISIBLE' : partiallySeated || suspected ? 'POSSIBLE_IMPROPER_SEATING' : item.seatingStatus || 'NOT_RELIABLY_VISIBLE';
      const severity = directlyDefective ? (defectKind === 'CORROSION' || defectKind === 'LEAK_OR_RESIDUE' ? (item.severity === 'MODERATE' ? 'MODERATE' : 'LOW') : item.severity === 'CRITICAL' ? 'CRITICAL' : item.severity === 'HIGH' ? 'HIGH' : 'MODERATE') : partiallySeated || suspected ? (item.severity === 'HIGH' || item.severity === 'CRITICAL' ? 'MODERATE' : item.severity || 'LOW') : 'UNDETERMINED';
      const ceiling = directlyDefective || directlyMated ? 99 : partiallySeated || suspected ? 85 : interfaceVisible ? 70 : 60;
      const findingConfidence = Math.min(Number.isFinite(item.findingConfidence) ? item.findingConfidence : directlyDefective ? 75 : 0, ceiling);
      const connectionStateConfidence = Math.min(Number.isFinite(item.connectionStateConfidence) ? item.connectionStateConfidence : findingConfidence, ceiling);
      const downgraded = item.connectionState === 'DISCONNECTED_VERIFIED' && !directDisconnected;
      const missingContext = directlyDefective && contradictoryVisibilityLimitation(item.missingContext) ? hiddenVerificationLimitation({ ...item, visibleEvidence }) : item.missingContext;
      reconciled.push({ ...item, observedObject: item.observedObject || observedObjectFor(item), connectionState, connectionStateConfidence, findingType, seatingStatus, severity, findingConfidence, directVisibleEvidence: visibleEvidence, directDamageVisible: directlyDefective || item.directDamageVisible, missingContext, safetyDrivabilityImpact: unsupportedLeakClaim(`${item.safetyDrivabilityImpact || ''} ${visibleEvidence}`) ? null : item.safetyDrivabilityImpact, reconciliationNote: directlyDefective && !['CLEAR_DEFECT'].includes(item.findingType) ? 'Direct visible physical-condition claim promoted to a confirmed visible defect.' : downgraded ? 'Disconnected state downgraded because the evidence does not show direct visible separation.' : '' });
    } catch (error) {
      reconciliationErrors.push({ findingId: rawItem?.findingId || rawItem?.candidateId || `finding-${index + 1}`, reason: sanitizeDiagnosticText(error?.message) || 'finding normalization failed' });
    }
  });
  const strongest = new Map();
  const rank = item => item.findingType === 'CLEAR_DEFECT' && visibleDefectKind(item.directVisibleEvidence || item.visibleEvidence) ? 5 : item.connectionState === 'CONNECTED_VERIFIED' && directMatingEvidence(item.visibleEvidence) ? 4 : item.connectionState === 'PARTIALLY_SEATED' ? 3 : item.connectionState === 'LOOSE_OR_SUSPECT' ? 2 : 1;
  for (const item of reconciled) {
    const key = `${canonicalFindingKey(item)}|${item.connectionState || item.findingType}`, previous = strongest.get(key);
    if (!previous || rank(item) > rank(previous) || (rank(item) === rank(previous) && (item.findingConfidence || 0) > (previous.findingConfidence || 0))) strongest.set(key, item);
  }
  const strongestValues = [...strongest.values()];
  const directDefectKeys = new Set(strongestValues.filter(item => item.findingType === 'CLEAR_DEFECT' && visibleDefectKind(item.directVisibleEvidence || item.visibleEvidence)).map(contradictionFindingKey));
  const finalFindings = strongestValues.filter(item => !directDefectKeys.has(contradictionFindingKey(item)) || item.findingType === 'CLEAR_DEFECT' || (item.findingType === 'POSSIBLE_CONCERN' && visibleDefectKind(item.directVisibleEvidence || item.visibleEvidence))).sort((a, b) => findingPriority(a) - findingPriority(b));
  const conflictsResolved = reconciled.length !== finalFindings.length || reconciled.some(item => item.reconciliationNote);
  const promotedFindings = finalFindings.filter(item => item.findingType === 'CLEAR_DEFECT' && visibleDefectKind(item.directVisibleEvidence || item.visibleEvidence));
  const hasClearDefect = promotedFindings.length > 0;
  const possibleConcerns = (Array.isArray(base.possibleConcerns) ? base.possibleConcerns : []).map(item => ({ ...item, appearance: removeUnsupportedLeakConsequence(item?.appearance) })).filter(item => item.appearance && !visibleDefectKind(item.appearance));
  const hasConcern = finalFindings.some(item => item.findingType === 'POSSIBLE_CONCERN') || possibleConcerns.length > 0;
  const status = hasClearDefect ? 'OBSERVED_CONDITION' : hasConcern ? 'POSSIBLE_CONCERN_DETECTED' : base.status;
  const reason = reconciliationErrors.length && !finalFindings.length ? reconciliationReason('RECONCILE_NO_FINDINGS') : reconciliationErrors.length ? reconciliationReason('RECONCILE_PARTIAL') : reconciliationReason('RECONCILE_OK');
  const directDisconnects = finalFindings.filter(item => item.connectionState === 'DISCONNECTED_VERIFIED' && /\b(?:electrical\s+connector|electrical\s+terminal|wire\s+harness)\b/i.test(`${item.observedObject || ''} ${item.directVisibleEvidence || item.visibleEvidence || ''}`) && directSeparationEvidence(item.directVisibleEvidence || item.visibleEvidence));
  const disconnectGuidance = 'Reconnect the electrical connector fully and capture a follow-up image showing the connector seated and latched at the mating receptacle.';
  const visibleDefects = promotedFindings.map(item => {
    const evidence = item.directVisibleEvidence || item.visibleEvidence;
    const location = item.location ? ` at ${item.location}` : '';
    if (item.connectionState === 'DISCONNECTED_VERIFIED' && /\b(?:battery\s+)?terminal\s+clamp|battery\s+post\b/i.test(evidence)) return `Positive battery terminal appears physically disconnected${location}: ${evidence}`;
    if (item.connectionState === 'DISCONNECTED_VERIFIED' && /\b(?:connector|plug|terminal|wire|harness)\b/i.test(`${item.observedObject || ''} ${evidence}`)) return `Electrical connector visibly disconnected${location}: ${evidence}`;
    if (item.connectionState === 'DISCONNECTED_VERIFIED' && /\b(?:hose|tube|line|pipe)\b/i.test(`${item.observedObject || ''} ${evidence}`)) return `Hose or line visibly disconnected${location}: ${evidence}`;
    return `${item.observedObject || 'Visible defect'}${location}: ${evidence}`;
  });
  const safeObservedCondition = (Array.isArray(base.observedCondition) ? base.observedCondition : []).map(removeUnsupportedLeakConsequence).filter(Boolean).filter(item => !hasClearDefect || !/\bno\s+(?:obvious\s+|visible\s+)?defects?\b/i.test(item));
  const safeVisibleEvidence = (Array.isArray(base.visibleEvidence) ? base.visibleEvidence : []).map(removeUnsupportedLeakConsequence).filter(Boolean);
  const safetyDrivabilityImpact = unsupportedLeakClaim(`${base.safetyDrivabilityImpact || ''} ${safeVisibleEvidence.join(' ')}`) ? null : base.safetyDrivabilityImpact;
  const result = { ...base, status, possibleConcerns, connectionAssessments: finalFindings, observedCondition: [...new Set([...visibleDefects, ...safeObservedCondition])], visibleEvidence: [...new Set([...promotedFindings.map(item => item.directVisibleEvidence || item.visibleEvidence), ...safeVisibleEvidence])], recommendedVerification: [...new Set([...(base.recommendedVerification || []), ...promotedFindings.map(item => item.recommendedVerification).filter(Boolean), ...(directDisconnects.length ? [disconnectGuidance] : [])])], safetyDrivabilityImpact, noVisibleConcernMessage: hasClearDefect ? '' : base.noVisibleConcernMessage, unableToInspectReason: hasClearDefect ? null : base.unableToInspectReason, reconciliationErrors, reconciliation: { status: 'reconciled', findings: finalFindings, visibleDefects, visualState: finalFindings[0] ? canonicalConnectionState(finalFindings[0].connectionState) : null, vehicleContextAvailable: vehicleContextState !== 'UNAVAILABLE', vehicleMismatch: vehicleContextState === 'MISMATCH' ? true : vehicleContextState === 'MATCH' ? false : null, conflicts: [], promotable: false, reason: reason.code, reasonDetail: reason }, crossFindingConsistency: { status: reconciliationErrors.length ? 'PARTIAL' : 'PASS', conflictsResolved, findingCount: finalFindings.length, rejectedFindingCount: reconciliationErrors.length, relationshipAnalysisAvailable: Boolean(relationship), stageOneObservationAvailable: Boolean(observation) } };
  const conflictEvaluation = evaluateCrossFindingConflicts(result);
  const finalEvidencePromotion = promoteFinalEvidence(result, conflictEvaluation);
  return { ...result, conflictEvaluation, finalEvidencePromotion, reconciliation: { ...result.reconciliation, conflicts: conflictEvaluation.conflicts, promotable: finalEvidencePromotion.eligible } };
}

export function evaluateCrossFindingConflicts(reconciledEvidence) {
  const findings = Array.isArray(reconciledEvidence?.connectionAssessments) ? reconciledEvidence.connectionAssessments : [];
  const grouped = new Map();
  for (const item of findings) {
    const key = contradictionFindingKey(item);
    const states = grouped.get(key) || []; states.push(item); grouped.set(key, states);
  }
  const stateConflicts = [...grouped.entries()].flatMap(([key, items]) => {
    const states = new Set(items.map(item => canonicalConnectionState(item.connectionState)));
    return states.has('CONNECTED') && states.has('DISCONNECTED') ? [{ key, type: 'CONNECTION_STATE_CONTRADICTION', findingIds: items.map(item => item.findingId), states: [...states] }] : [];
  });
  const directVisible = findings.filter(item => item.findingType === 'CLEAR_DEFECT' && visibleDefectKind(item.directVisibleEvidence || item.visibleEvidence));
  const limitationConflicts = directVisible.filter(item => contradictoryVisibilityLimitation(item.missingContext)).map(item => ({ key: contradictionFindingKey(item), type: 'DIRECT_EVIDENCE_UNVERIFIED_CONTRADICTION', findingIds: [item.findingId], states: [canonicalConnectionState(item.connectionState)] }));
  const noDefectConflict = directVisible.length && (reconciledEvidence?.noVisibleConcernMessage || /\bno\s+(?:obvious\s+|visible\s+)?defects?\b/i.test((reconciledEvidence?.observedCondition || []).join(' '))) ? [{ key: 'report', type: 'DIRECT_EVIDENCE_NO_DEFECT_CONTRADICTION', findingIds: directVisible.map(item => item.findingId), states: directVisible.map(item => canonicalConnectionState(item.connectionState)) }] : [];
  const conflicts = [...stateConflicts, ...limitationConflicts, ...noDefectConflict];
  return { status: 'PASS', executed: true, conflicts, hasUnresolvedConflict: conflicts.length > 0, reason: conflicts.length ? 'CONFLICT_REPRESENTED' : 'NO_CONFLICT' };
}

export function promoteFinalEvidence(reconciledEvidence, conflictEvaluation) {
  const findings = Array.isArray(reconciledEvidence?.connectionAssessments) ? reconciledEvidence.connectionAssessments : [];
  const eligible = !conflictEvaluation?.hasUnresolvedConflict;
  const promoted = eligible ? findings.filter(item => item.findingType === 'CLEAR_DEFECT' && Boolean(visibleDefectKind(item.directVisibleEvidence || item.visibleEvidence))) : [];
  const contextLimited = reconciledEvidence?.reconciliation?.vehicleContextAvailable === false;
  return { status: eligible ? 'PASS' : 'BLOCKED_CONFLICT', eligible: eligible && promoted.length > 0, promotedCount: promoted.length, positiveEvidenceAdjudicated: true, evidence: promoted.map(item => ({ evidenceId: item.findingId, observationType: item.findingType, canonicalComponent: canonicalComponentFamily(item.observedObject), visibleState: canonicalConnectionState(item.connectionState), confidence: item.findingConfidence, contextLimited, qualification: contextLimited ? 'Vehicle context unavailable; statement is limited to direct visible evidence.' : null })), adjudications: [...promoted.map(item => ({ findingId: item.findingId, disposition: 'VISIBLE_DEFECT' })), ...(reconciledEvidence?.reconciliationErrors || []).map(item => ({ findingId: item.findingId, disposition: 'REJECTED', reason: item.reason }))], reason: eligible ? (promoted.length ? 'PROMOTION_OK' : 'NO_PROMOTABLE_EVIDENCE') : 'UNRESOLVED_CONFLICT' };
}

// This is deliberately a handoff, not another analyzer: component identity comes
// from the component pass and connection state comes from reconciled pixel evidence.
// Consumers must use this record rather than independently reinterpret either one.
export function buildCanonicalVisualState(componentIdentification, visualConditionInspection) {
  const source = Array.isArray(visualConditionInspection?.connectionAssessments) ? visualConditionInspection.connectionAssessments : [];
  const byFinding = new Map();
  const stateRank = item => item?.connectionState === 'DISCONNECTED_VERIFIED' && directSeparationEvidence(item.directVisibleEvidence || item.visibleEvidence) ? 4 : item?.connectionState === 'PARTIALLY_SEATED' ? 3 : item?.connectionState === 'CONNECTED_VERIFIED' && directMatingEvidence(item.directVisibleEvidence || item.visibleEvidence) ? 2 : 1;
  for (const item of source) {
    const key = canonicalFindingKey(item);
    const previous = byFinding.get(key);
    if (!previous || stateRank(item) > stateRank(previous) || (stateRank(item) === stateRank(previous) && Number(item.connectionStateConfidence || 0) > Number(previous.connectionStateConfidence || 0))) byFinding.set(key, item);
  }
  const connectionStates = [...byFinding.entries()].map(([findingKey, item]) => ({
    findingKey,
    candidateId: item.candidateId || null,
    observedObject: item.observedObject || observedObjectFor(item),
    location: item.location,
    connectionState: item.connectionState || 'INDETERMINATE',
    confidence: item.connectionStateConfidence ?? item.findingConfidence ?? null,
    directVisibleEvidence: item.directVisibleEvidence || item.visibleEvidence || '',
    source: 'RECONCILED_VISUAL_EVIDENCE'
  }));
  return {
    version: '10.13.136',
    componentIdentity: {
      primaryComponent: componentIdentification?.primaryComponent || 'Unable to determine exact component',
      status: componentIdentification?.status || 'NOT_ANALYZED',
      confidence: componentIdentification?.normalizedComponentConfidence ?? componentIdentification?.componentConfidence ?? null,
      source: 'COMPONENT_IDENTIFICATION_PASS'
    },
    connectionStates,
    downstreamOverrideAllowed: false,
    source: 'CANONICAL_COMPONENT_IDENTITY_AND_RECONCILED_CONNECTION_STATE'
  };
}

export function fuseLocalizedVisualEvidence(condition, inspections = []) {
  const verified = inspections.filter(item => item?.localizedVisualVerification === true && ['CONNECTED', 'DISCONNECTED', 'PARTIALLY_SEATED'].includes(item.connectionState));
  if (!verified.length) return condition;
  const additions = verified.map(item => ({ candidateId: item.candidateId, observedObject: item.observedObject || item.candidateClass || 'Connection candidate', location: item.location || 'Image-relative location cannot be determined reliably.', localizedVisualVerification: true, localizedConnectionState: item.connectionState, localizedDefectState: item.defectState, localizedConfidence: item.confidence, localizedEvidence: Array.isArray(item.evidenceObserved) ? item.evidenceObserved : [], contradictoryEvidence: item.contradictoryEvidence, visibilityLimitations: item.visibilityLimitations, connectionState: item.connectionState === 'CONNECTED' ? 'CONNECTED_VERIFIED' : item.connectionState === 'DISCONNECTED' ? 'DISCONNECTED_VERIFIED' : 'PARTIALLY_SEATED', seatingStatus: item.connectionState === 'CONNECTED' ? 'NO_GAP_OR_SEPARATION_VISIBLE' : item.connectionState === 'DISCONNECTED' ? 'SEPARATION_OR_GAP_VISIBLE' : 'POSSIBLE_IMPROPER_SEATING', findingType: item.defectState === 'NO_VISIBLE_DEFECT_CONFIRMED' ? 'NO_DEFECT_VISIBLE' : item.defectState === 'CONFIRMED_VISIBLE_DEFECT' ? 'CLEAR_DEFECT' : 'POSSIBLE_CONCERN', severity: item.connectionState === 'DISCONNECTED' ? 'MODERATE' : 'LOW', visibleEvidence: (Array.isArray(item.evidenceObserved) ? item.evidenceObserved : []).join(' '), directVisibleEvidence: (Array.isArray(item.evidenceObserved) ? item.evidenceObserved : []).join(' '), findingConfidence: item.confidence, connectionStateConfidence: item.confidence, matingComponentVisible: item.connectionState !== 'UNCERTAIN', directDamageVisible: item.defectState === 'CONFIRMED_VISIBLE_DEFECT', missingContext: Array.isArray(item.visibilityLimitations) && item.visibilityLimitations.length ? item.visibilityLimitations.join(' ') : null, recommendedVerification: 'Physically verify the complete mating interface, retention feature, and harness condition before repair authorization.', safetyDrivabilityImpact: null, evidenceProvenance: 'LOCALIZED_DETAIL_CONTEXT_VISUAL_EVIDENCE' }));
  return { ...condition, localizedVisualEvidence: additions, connectionAssessments: [...additions, ...(condition?.connectionAssessments || [])], status: additions.some(item => item.findingType === 'CLEAR_DEFECT') ? 'OBSERVED_CONDITION' : condition?.status };
}

// Direct whole-image abnormalities take precedence over ordinary foreground object
// order when selecting limited local inspections.
export function selectGlobalVisualCandidates(observation, limit = 3) {
  const objects = Array.isArray(observation?.objects) ? observation.objects : [];
  const abnormal = new Map((observation?.abnormalFindings || []).map(item => [item.objectId, item]));
  return objects.filter(item => /connector|plug|terminal|hose|clamp|fastener|fitting|port|socket|wire/i.test(item.type)).slice().sort((left, right) => (abnormal.get(left.id)?.priorityRank ?? 99) - (abnormal.get(right.id)?.priorityRank ?? 99)).slice(0, limit).map(item => ({ id: item.id, type: item.type, location: item.location }));
}

export async function analyzeSemanticImage(body, { apiKey = process.env.OPENAI_API_KEY, fetchImpl = fetch, diagnostic = {}, timeoutMs = OPENAI_TIMEOUT_MS, enableVisualObservation = false } = {}) {
  const fields = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
  const requiredFields = ['transactionId', 'imageHash', 'mimeType', 'imageBase64'];
  const allowedFields = new Set([...requiredFields, 'vehicleContext']);
  if (requiredFields.some(field => !fields.includes(field)) || fields.some(field => !allowedFields.has(field))) {
    throw diagnosticFailure(diagnostic, 'Request fields are invalid.', 400, 'C_REQUEST_BODY_PARSED', 'MALFORMED_REQUEST');
  }
  const transactionId = typeof body?.transactionId === 'string' ? body.transactionId : '';
  const imageHash = typeof body?.imageHash === 'string' ? body.imageHash.toLowerCase() : '';
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
  const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : '';
  const vehicleContext = normalizeVehicleAnalysisContext(body?.vehicleContext);
  markDiagnostic(diagnostic, 'C_REQUEST_BODY_PARSED', { requestId: transactionId || 'invalid', requestBodyParsed: true, imagePayloadFound: Boolean(imageBase64), imageMimeType: mimeType || 'unknown', vehicleContextValidation: vehicleContext ? 'PASS' : body?.vehicleContext ? 'BLOCKED' : 'NOT_AVAILABLE', vehicleContextMismatchStatus: vehicleContext ? 'NOT_DETERMINED' : 'NOT_AVAILABLE' });
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(transactionId) || !/^[a-f0-9]{64}$/.test(imageHash)) throw diagnosticFailure(diagnostic, 'Transaction identity is invalid.', 400, 'C_REQUEST_BODY_PARSED', 'MALFORMED_REQUEST');
  if (!IMAGE_TYPES.has(mimeType)) throw diagnosticFailure(diagnostic, 'Unsupported image type.', 415, 'D_IMAGE_PAYLOAD_FOUND', 'UNSUPPORTED_IMAGE_TYPE');
  if (!imageBase64 || imageBase64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(imageBase64)) {
    throw diagnosticFailure(diagnostic, 'Image payload is invalid.', 400, 'D_IMAGE_PAYLOAD_FOUND', 'INVALID_IMAGE_PAYLOAD', { imagePayloadFound: Boolean(imageBase64) });
  }
  let bytes;
  try { bytes = Buffer.from(imageBase64, 'base64'); } catch { throw diagnosticFailure(diagnostic, 'Image payload is invalid.', 400, 'D_IMAGE_PAYLOAD_FOUND', 'INVALID_IMAGE_PAYLOAD'); }
  let sourceDimensions = null;
  try { const source = await createWholeImageRegions(bytes); sourceDimensions = source.source; }
  catch { /* Dimension telemetry is advisory; format validation remains authoritative. */ }
  markDiagnostic(diagnostic, 'D_IMAGE_PAYLOAD_FOUND', { imagePayloadFound: true, imagePayloadNonEmpty: bytes.length > 0, imageByteLength: bytes.length, imageMimeType: mimeType, imageHashShort: imageHash.slice(0, 12), originalImageDimensions: sourceDimensions, transmittedImageDimensions: sourceDimensions, imageRecompressed: false });
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
  markDiagnostic(diagnostic, 'E_IMAGE_PAYLOAD_VALID', { imagePayloadValid: true, vehicleContextProvided: Boolean(vehicleContext), vehicleContextFields: vehicleContext ? Object.entries(vehicleContext).filter(([, value]) => Boolean(value)).map(([key]) => key) : [], vehicleContextMismatchBlocked: Boolean(body?.vehicleContext && !vehicleContext) });

  if (!apiKey) throw diagnosticFailure(diagnostic, 'Semantic analyzer is not configured on the server.', 503, 'F_OPENAI_CONFIGURATION', 'CONFIGURATION', { openaiCredentialConfigured: false });
  markDiagnostic(diagnostic, 'F_OPENAI_CONFIGURATION', { openaiCredentialConfigured: true });

  const prompt = `Analyze only the pixels of this current image. Do not use filenames, metadata, prior images, or OCR words as proof of automotive content. Return exactly one category. AUTOMOTIVE_GRAPH requires multiple independent visible graph indicators such as axes or gridlines plus plotted traces, repeated scale markings, panels, legends, or time-series structure. AUTOMOTIVE_WIRING_DIAGRAM requires actual electrical schematic structure such as connected circuit paths plus multiple schematic symbols, component/module blocks, connectors or pin/cavity identifiers, fuse/relay/ground/splice symbols, wire colors, circuit numbers, terminals, power references, or signal/reference/return paths. Automotive words or OCR text alone are insufficient. AUTOMOTIVE_COMPONENT_OR_VEHICLE requires positive visible automotive photographic subjects such as a vehicle, brake/engine/suspension component, connector, physical wiring, dashboard, scan tool, or diagnostic equipment. General photos of animals, people, food, furniture, scenery, or buildings without automotive evidence are GENERAL_NON_AUTOMOTIVE_PHOTO. Non-schematic documents, screenshots, invoices, text screens, and data tables are DOCUMENT_OR_TEXT_SCREENSHOT. Use UNKNOWN_OR_ANALYSIS_UNAVAILABLE when visual evidence is inadequate or conflicting. Evidence and object names must describe visible pixel-supported content. Confidence must reflect the genuine visual classification; use null if a defensible value is unavailable.`;
  markDiagnostic(diagnostic, 'G_OPENAI_REQUEST_CONSTRUCTED', { openaiRequestConstructed: true, openaiModel: MODEL, openaiApiType: 'Responses API /v1/responses', openaiReasoningEffort: DEEP_VISION_REASONING.effort, openaiReasoningMode: DEEP_VISION_REASONING.mode, openaiImageDetail: DEEP_VISION_DETAIL, payloadImageCount: 1 });
  const openAIStartedAt = Date.now();
  const analysisSignal = AbortSignal.timeout(timeoutMs);
  let openAIResponse;
  try {
    markDiagnostic(diagnostic, 'H_OPENAI_API_CONTACTED', { openaiRequestAttempted: true, openaiResponseReceived: false });
    openAIResponse = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(deepVisionRequest({
        store: false,
        max_output_tokens: 1400,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: DEEP_VISION_DETAIL }] }],
        text: { format: { type: 'json_schema', name: 'nitros_image_semantics', strict: true, schema: semanticSchema } }
      })),
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

  let visualObservation=null;
  if(enableVisualObservation&&semanticResult.category==='AUTOMOTIVE_COMPONENT_OR_VEHICLE'){markDiagnostic(diagnostic,'L_RAW_VISUAL_OBSERVATION_REQUEST',{rawVisualObservationRequest:'PASS',rawVisualObservationResponse:'PENDING',objectInventory:'PENDING',physicalRelationshipAnalysis:'PENDING',electricalConnectionStateAnalysis:'PENDING',abnormalStateDetection:'PENDING',globalVisualSweep:'PENDING'});try{const regionalSweep=await createWholeImageRegions(bytes);const regionalContent=[{type:'input_text',text:`${globalVisualSweepInstruction}\n${rawVisualObservationPrompt}\nThis is a mandatory whole-image multi-pass inspection. IMAGE 1 is the complete original photograph. IMAGES 2–10 are overlapping regions of that exact photograph, ordered top-left through bottom-right. Sweep all regions before reaching any conclusion; do not let a prompt, finger, central object, or first defect end the search. A directly visible disconnected/free/partially seated connection must appear in abnormalFindings.`},{type:'input_image',image_url:`data:${mimeType};base64,${imageBase64}`,detail:DEEP_VISION_DETAIL},...regionalSweep.regions.map(item=>({type:'input_image',image_url:`data:image/png;base64,${item.image.toString('base64')}`,detail:DEEP_VISION_DETAIL}))];const r=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(deepVisionRequest({store:false,max_output_tokens:2200,input:[{role:'user',content:regionalContent}],text:{format:{type:'json_schema',name:'nitros_raw_visual_observation',strict:true,schema:visualObservationSchema}}})),signal:AbortSignal.timeout(Math.min(timeoutMs,OPENAI_TIMEOUT_MS))});if(!r.ok)throw Error(`Raw visual observation failed with HTTP ${r.status}.`);visualObservation=validateVisualObservation(JSON.parse(extractOutputText(await r.json())));markDiagnostic(diagnostic,'L_RAW_VISUAL_OBSERVATION_COMPLETE',{rawVisualObservationResponse:'PASS',objectInventory:'PASS',objectsInventoried:visualObservation.objects.length,relationshipCapableObjects:visualObservation.objects.filter(x=>/connector|receptacle|terminal|hose|clamp|plug|wire/i.test(x.type)).length,physicalRelationshipAnalysis:'PASS',electricalConnectionStateAnalysis:'PASS',abnormalStateDetection:'PASS',globalVisualSweep:'PASS',supplementalImageRegions:regionalSweep.regions.length,confirmedPhysicalAbnormalities:visualObservation.abnormalFindings.length,structuredVisualEvidenceHandoff:'PASS'});}catch(e){markDiagnostic(diagnostic,'L_RAW_VISUAL_OBSERVATION_FAILED',{rawVisualObservationResponse:'FAIL',objectInventory:'FAIL',physicalRelationshipAnalysis:'FAIL',electricalConnectionStateAnalysis:'FAIL',abnormalStateDetection:'FAIL',globalVisualSweep:'FAIL',structuredVisualEvidenceHandoff:'FAIL',rawVisualObservationErrorMessage:sanitizeDiagnosticText(e?.message)});}}
  let localizedVisualInspections = [];
  let localizedStageHandled = false;
  if (visualObservation) {
    const sourceCandidates = selectGlobalVisualCandidates(visualObservation, 3);
    try {
      const locatorPrompt = `Locate only these existing candidate IDs in this original image and return normalized 0-to-1 regions: ${JSON.stringify(sourceCandidates)}. x/y are the left/top edges divided by image width/height; width/height are region size divided by image width/height. Do not create candidates, identify vehicle/component names, or assess condition.`;
      const locatorResponse = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(deepVisionRequest({ store: false, max_output_tokens: 700, input: [{ role: 'user', content: [{ type: 'input_text', text: locatorPrompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: DEEP_VISION_DETAIL }] }], text: { format: { type: 'json_schema', name: 'nitros_candidate_regions', strict: true, schema: candidateRegionSchema } } })), signal: AbortSignal.timeout(Math.min(timeoutMs, COMPONENT_TIMEOUT_MS)) });
      if (!locatorResponse.ok) throw new Error(`Candidate localization failed with HTTP ${locatorResponse.status}.`);
      const located = JSON.parse(extractOutputText(await locatorResponse.json())).candidates || [];
      for (const candidate of located.slice(0, 3)) {
        const pass1 = visualObservation.objects.find(item => item.id === candidate.candidate_id);
        const region = validateNormalizedRegion(candidate.region);
        if (!pass1 || !region) { localizedVisualInspections.push({ candidateId: candidate.candidate_id, localizedVisualVerification: false, failureReason: 'INVALID_OR_UNMATCHED_REGION' }); continue; }
        try {
          const crops = await createLocalizedCrops(bytes, region);
const localPrompt = `Independently inspect candidate ${pass1.id}. IMAGE 1 is DETAIL crop; IMAGE 2 is CONTEXT crop; IMAGE 3 is ORIGINAL supplementary context. Determine only what these pixels prove. PROXIMITY IS NOT CONNECTION: connector/socket, battery terminal/post, and hose/port all require visible physical mating evidence. If mating geometry cannot be established return UNCERTAIN; absence of a detected defect is not proof of a secure connection. Return the strict localized inspection schema.`;
          const response2 = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(deepVisionRequest({ store: false, max_output_tokens: 850, input: [{ role: 'user', content: [{ type: 'input_text', text: localPrompt }, { type: 'input_image', image_url: `data:image/png;base64,${crops.detail.toString('base64')}`, detail: DEEP_VISION_DETAIL }, { type: 'input_image', image_url: `data:image/png;base64,${crops.context.toString('base64')}`, detail: DEEP_VISION_DETAIL }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: DEEP_VISION_DETAIL }] }], text: { format: { type: 'json_schema', name: 'nitros_localized_inspection', strict: true, schema: localizedInspectionSchema } } })), signal: AbortSignal.timeout(Math.min(timeoutMs, COMPONENT_TIMEOUT_MS)) });
          if (!response2.ok) throw new Error(`Localized inspection failed with HTTP ${response2.status}.`);
          const inspection = validateLocalizedInspection(JSON.parse(extractOutputText(await response2.json())), pass1);
          localizedVisualInspections.push({ ...inspection, location: pass1.location, observedObject: pass1.type, normalizedRegion: region, pixelRegion: { detail: crops.detailRegion, context: crops.contextRegion }, sourceDimensions: crops.source, detailDimensions: crops.detailMetadata, contextDimensions: crops.contextMetadata, cropStatus: 'SUCCESS', detailSupplied: true, contextSupplied: true, originalSupplied: true });
        } catch (error) { localizedVisualInspections.push({ candidateId: pass1.id, normalizedRegion: region, localizedVisualVerification: false, failureReason: sanitizeDiagnosticText(error?.message) }); }
      }
      localizedStageHandled = true;
      markDiagnostic(diagnostic, 'L_LOCALIZED_VISUAL_INSPECTION_COMPLETE', { localizedVisualVerification: localizedVisualInspections.some(item => item.localizedVisualVerification), localizedVisualInspections, localizedCandidateLimit: 3 });
    } catch (error) { markDiagnostic(diagnostic, 'L_LOCALIZED_VISUAL_INSPECTION_FAILED', { localizedVisualVerification: false, localizedVisualFailureReason: sanitizeDiagnosticText(error?.message) }); }
  }
  if (visualObservation && !localizedStageHandled) {
    const localStartedAt = Date.now();
    const candidates = visualObservation.objects.filter(item => /connector|plug|terminal/i.test(item.type) && (item.connectionState === 'UNKNOWN' || item.matingStatus === 'UNKNOWN')).slice(0, 2);
    const pass2 = [];
    for (const candidate of candidates) {
      const localPrompt = `Independently inspect connector candidate ${candidate.id} in the ${candidate.location} region of this same image. Use the candidate ID exactly. Inspect only direct local geometry: connector body, harness termination, mating face, exposed/open end, open space, nearby receptacle, insertion path, gap/separation, lock area, occlusion, and image quality. Do not identify vehicle or component names, and do not infer a final connection state. Return the standard raw observation schema; set TRUE only for visible geometry and provide concise direct evidence.`;
      try {
        const localResponse = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, store: false, max_output_tokens: 900, input: [{ role: 'user', content: [{ type: 'input_text', text: localPrompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' }] }], text: { format: { type: 'json_schema', name: 'nitros_local_connector_observation', strict: true, schema: visualObservationSchema } } }), signal: AbortSignal.timeout(Math.min(timeoutMs, COMPONENT_TIMEOUT_MS)) });
        if (!localResponse.ok) throw new Error(`Local connector observation failed with HTTP ${localResponse.status}.`);
        const local = validateVisualObservation(JSON.parse(extractOutputText(await localResponse.json())));
        const localCandidate = local.objects.find(item => item.id === candidate.id) || local.objects.find(item => /connector|plug|terminal/i.test(item.type));
        pass2.push({ candidateId: candidate.id, localCandidate: localCandidate || null, abnormalFindings: local.abnormalFindings });
        if (localCandidate) {
          const reconciled = { ...candidate, ...localCandidate, id: candidate.id, location: candidate.location };
          const objects = visualObservation.objects.map(item => item.id === candidate.id ? reconciled : item);
          const abnormalities = [...visualObservation.abnormalFindings.filter(item => item.objectId !== candidate.id), ...local.abnormalFindings.filter(item => item.objectId === localCandidate.id).map(item => ({ ...item, objectId: candidate.id }))];
          visualObservation = validateVisualObservation({ ...visualObservation, objects, abnormalFindings: abnormalities });
        }
      } catch (error) { pass2.push({ candidateId: candidate.id, error: sanitizeDiagnosticText(error?.message) }); }
    }
    markDiagnostic(diagnostic, 'L_LOCAL_CONNECTOR_OBSERVATION_COMPLETE', { localConnectorCandidates: candidates.map(item => item.id), localConnectorObservations: pass2, localConnectorModelCalls: candidates.length, localConnectorElapsedMs: Math.max(0, Date.now() - localStartedAt) });
  }
  let componentIdentification = null;
  if (semanticResult.category === 'AUTOMOTIVE_COMPONENT_OR_VEHICLE') {
    const componentStartedAt = Date.now();
    const componentPrompt = `Identify the primary automotive component visible in this current image using only visible pixels. Do not use filenames, metadata, OCR text alone, prior images, prior cases, cached results, or the category confidence. ${vehicleContextPrompt(vehicleContext)} Return the most specific component supported by visible evidence, its automotive system, secondary visible components, and pixel-supported evidence. Component confidence must be independent from category confidence. If vehicle context makes an identity plausible but its defining physical features are not visible, keep status UNCERTAIN and state that it is a likely identification from vehicle context, not a confirmed visual identification. If the exact component is not visually defensible, use status UNCERTAIN, list visually supported alternatives, explain what view or evidence is missing, and never force or invent a component.

When distinguishing visually similar emissions and vacuum assemblies, compare multiple independent visible cues before naming either: actuator and connector placement; body and mounting geometry; flange or exhaust-gas passage features; adjacent metal EGR tubing or relevant plumbing; pump drive/vacuum-port features; engine location; and readable marking only when it agrees with the physical assembly. Identify an EGR valve when the visible cues support an electrically actuated exhaust-gas recirculation valve. Do not identify a vacuum pump merely because a nearby connector, hose, or similar housing is visible. If these cues cannot distinguish the assemblies, return UNCERTAIN with both as alternatives. Component identity is separate from connection state: never use an assumed component identity to change the directly visible physical state of a connector.

Keep “visible component identification” separate from “likely connection or destination.” A cable, wire, terminal, or electrical connector is visible wiring, not the housing it may normally connect to. Never call a starter, starter solenoid, or other component visible unless its physical housing or defining features are actually visible. If a starter is installed and its housing, solenoid body, mounting, or other defining features are clearly visible, identify it from those features. In particular, a heavy-gauge positive battery cable near the transmission/bellhousing may be a disconnected starter power cable, and a smaller connector may be a starter-solenoid exciter wire; neither is itself a starter or solenoid. When only those wires are visible, identify the wires, state their likely purpose only as an unconfirmed interpretation, and say the component may be removed, outside the frame, or obscured. Reduce confidence whenever defining visual evidence is missing.

Before finalizing Transfer Case, Differential, Transmission, or Transaxle, complete drivetrainDiscrimination from visible geometry, mounting position, connected shafts, surrounding components, and drivetrain layout—not housing shape alone. Explicitly determine: connection to engine; connection directly behind transmission; driveshaft inputs and outputs; whether multiple longitudinal outputs exist; whether lateral axle/CV outputs or axle tubes lead toward wheels; centerline versus axle position; and whether the visible role is primary gearbox, front/rear torque distribution, final drive, or an integrated gearbox/final drive.

TRANSFER CASE evidence includes a separate gearbox directly attached to or behind the transmission near the vehicle centerline, rear and possibly front driveline outputs, irregular gearbox housing, and absence of lateral axle tubes. Exhaust, heat shields, crossmembers, perimeter bolts, or a nearby driveshaft alone are not sufficient. DIFFERENTIAL evidence includes an axle/final-drive position, lateral axle shafts/CV outputs or axle tubes toward both wheels, and a driveshaft terminating at a pinion/input; perimeter bolts, under-vehicle location, or a nearby driveshaft alone are insufficient. TRANSMISSION evidence includes a large gearbox connected to the engine, bellhousing/main case, pan, cooler lines, connectors, shift mechanism, or transmission crossmember; a transfer case can be secondary behind it. TRANSAXLE evidence includes an integrated transmission/final-drive assembly with lateral CV axles in a transverse/FWD-style layout.

Set distinguishingFeaturesComplete true only when the selected exact drivetrain type has strong visible discriminators. Otherwise lower component confidence, include the closest competing type in possibleAlternatives and drivetrainDiscrimination.competingCandidate, and explain the ambiguity. Supporting evidence must specifically justify the selected primary component. Secondary items such as driveshaft, exhaust, heat shield, crossmember, transmission, differential, CV axle, or suspension must not override the visually dominant intended subject.`;
    markDiagnostic(diagnostic, 'M_COMPONENT_REQUEST_CONSTRUCTED', { componentIdentificationAttempted: true, componentResponseReceived: false, componentResultPresent: false });
    try {
      const componentResponse = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...deepVisionRequest({}),
          store: false,
          max_output_tokens: 1000,
          input: [{ role: 'user', content: [{ type: 'input_text', text: componentPrompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: DEEP_VISION_DETAIL }] }],
          text: { format: { type: 'json_schema', name: 'nitros_automotive_component', strict: true, schema: automotiveComponentSchema } }
        }),
        signal: AbortSignal.timeout(Math.min(timeoutMs, COMPONENT_TIMEOUT_MS))
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
      componentIdentification = { status: 'FAILED', primaryComponent: 'Technical component-analysis failure', componentConfidence: null, rawComponentConfidence: null, normalizedComponentConfidence: null, system: null, secondaryComponents: [], supportingEvidence: [], possibleAlternatives: [], uncertaintyReason: safeMessage, semanticRequestId: transactionId, imageHash };
      markDiagnostic(diagnostic, 'O_COMPONENT_RESULT_FAILED', { componentIdentificationAttempted: true, componentResponseReceived: Boolean(diagnostic.componentResponseReceived), componentResponseParsed: false, componentResultPresent: false, componentConfidenceNormalized: false, componentErrorCategory: error?.componentErrorCategory || (timedOut ? 'OPENAI_TIMEOUT' : 'COMPONENT_ANALYSIS_ERROR'), componentErrorMessage: safeMessage, componentHttpStatus: error?.componentHttpStatus ?? diagnostic.componentHttpStatus ?? null, componentElapsedMs: Math.max(0, Date.now() - componentStartedAt) });
    }
  } else {
    markDiagnostic(diagnostic, 'K_SEMANTIC_OUTPUT_EXTRACTED', { componentIdentificationAttempted: false, componentIdentificationSkipped: true });
  }
  let vehicleAreaRelationshipAnalysis = null;
  if (semanticResult.category === 'AUTOMOTIVE_COMPONENT_OR_VEHICLE' && (enableVisualObservation || vehicleContext)) {
    const relationshipStartedAt = Date.now();
    const relationshipPrompt = `Determine the visible vehicle-area location and component relationships in this current automotive photo. ${vehicleContextPrompt(vehicleContext)} Then perform an independent EXPECTED COMPONENT / ABSENCE ANALYSIS for this same visible area. Build topologyInventory for every expected major component with expected location and presence status. Rank up to three missingAssemblyCandidates; a candidate needs at least two independent evidence classes, including vehicle-specific expected location plus visible mounting geometry, cable/connector, hose/line, bracket, or vacant-space evidence. Vehicle context alone is never enough. Do not let visual-condition uncertainty cancel topology reasoning. When the area is engine/transmission junction or bellhousing, consider the current vehicle's starter mounting relationship as an expected candidate but never assert it without the evidence gate. If the gate is not met, return exactly "No visually supported missing component detected." and empty candidate support arrays. This is a distinct location-reasoning stage after classification and component identification, before defect conclusions. Use visual geometry, casting shape, mounting position, nearby hoses/wiring/connectors, and surrounding visible components first; use vehicle architecture only to narrow plausible locations and relationships. Never let vehicle context override contradictory pixels.

Return a technician-friendly broad vehicleAreaLocation only when supported (for example upper engine, front of engine, rear/firewall side, transmission side, bellhousing area, engine/transmission junction, cylinder-head area, intake side, exhaust side, accessory-drive area, battery/starting/charging area, underbody, suspension/wheel area, or Location uncertain). Do not invent driver/passenger/front/rear vehicle orientation. If an exact component cannot be established, report the supported broader assembly rather than guessing. For every observed connector, hose, pipe, harness, bracket, fastener, opening, or separated item, identify the image-relative location, nearest identifiable assembly, likely relationship/destination, independent relationship confidence, exact visible evidence, any non-visual vehicle-context support, what cannot be confirmed, and one concrete better-photo instruction. A known vehicle never proves a connector's exact destination. When a mating component is outside the image, say it may service a component in that area but its exact destination cannot be confirmed. Preserve direct observations separately from inference; do not claim a defect, removed component, or installation state from context alone. Make photo guidance specific, such as a wider image 12–18 inches farther back or a second angle showing harness routing and mounting points.`;
    markDiagnostic(diagnostic, 'P_VEHICLE_AREA_RELATIONSHIP_REQUEST_CONSTRUCTED', { vehicleAreaRelationshipAttempted: true, vehicleAreaRelationshipResponseReceived: false, vehicleAreaRelationshipResultPresent: false });
    try {
      const relationshipResponse = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(deepVisionRequest({ store: false, max_output_tokens: 900, input: [{ role: 'user', content: [{ type: 'input_text', text: `${relationshipPrompt}\nCompleted component-identification context: ${componentIdentification?.primaryComponent||'Automotive component identification was unavailable'}. Use it only as a non-authoritative visual-analysis reference.` }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: DEEP_VISION_DETAIL }] }], text: { format: { type: 'json_schema', name: 'nitros_vehicle_area_relationship', strict: true, schema: vehicleAreaRelationshipSchema } } })), signal: AbortSignal.timeout(Math.min(timeoutMs, COMPONENT_TIMEOUT_MS)) });
      const relationshipBody = await relationshipResponse.json().catch(() => null);
      markDiagnostic(diagnostic, 'Q_VEHICLE_AREA_RELATIONSHIP_RESPONSE_RECEIVED', { vehicleAreaRelationshipResponseReceived: true, vehicleAreaRelationshipResponseOk: relationshipResponse.ok, vehicleAreaRelationshipHttpStatus: relationshipResponse.status, vehicleAreaRelationshipElapsedMs: Math.max(0, Date.now() - relationshipStartedAt) });
      if (!relationshipResponse.ok) throw new Error(relationshipBody?.error?.message || `Vehicle-area relationship request failed with HTTP ${relationshipResponse.status}.`);
      vehicleAreaRelationshipAnalysis = { ...validateVehicleAreaRelationship(JSON.parse(extractOutputText(relationshipBody)),{componentIdentification,semanticResult,observation:visualObservation}), semanticRequestId: transactionId, imageHash };
      markDiagnostic(diagnostic, 'R_VEHICLE_AREA_RELATIONSHIP_RESULT_EXTRACTED', { vehicleAreaRelationshipResultPresent: true, vehicleAreaRelationshipStatus: vehicleAreaRelationshipAnalysis.status, vehicleAreaRelationshipConfidenceNormalized: vehicleAreaRelationshipAnalysis.locationConfidence !== null, vehicleAreaSource:vehicleAreaRelationshipAnalysis.vehicleAreaSource,vehicleAreaReason:vehicleAreaRelationshipAnalysis.vehicleAreaReason,relationshipSource:vehicleAreaRelationshipAnalysis.relationshipSource,relationshipReason:vehicleAreaRelationshipAnalysis.relationshipReason,photoGuidanceSource:vehicleAreaRelationshipAnalysis.photoGuidanceSource,photoGuidanceReason:vehicleAreaRelationshipAnalysis.photoGuidanceReason,expectedComponentGapDetection:'PASS', missingAssemblyReasoning:'PASS' });
    } catch (error) {
      markDiagnostic(diagnostic, 'R_VEHICLE_AREA_RELATIONSHIP_FAILED', { vehicleAreaRelationshipResultPresent: false, vehicleAreaRelationshipErrorMessage: sanitizeDiagnosticText(error?.message), vehicleAreaRelationshipElapsedMs: Math.max(0, Date.now() - relationshipStartedAt) });
    }
  } else markDiagnostic(diagnostic, diagnostic.stage, { vehicleAreaRelationshipAttempted: false, vehicleAreaRelationshipSkipped: true, vehicleAreaRelationshipSkipReason: 'NON_AUTOMOTIVE_CATEGORY' });
  let visualConditionInspection = null;
  if (semanticResult.category === 'AUTOMOTIVE_COMPONENT_OR_VEHICLE') {
    const conditionStartedAt = Date.now();
    const conditionPrompt = `Perform the OBVIOUS VISUAL DEFECT SWEEP for this same current automotive image before using component identity or vehicle knowledge for diagnostic interpretation. Reason in this non-reversible order: SEE → LOCATE → IDENTIFY → VERIFY PHYSICAL STATE → DETECT ABNORMALITY → APPLY VEHICLE CONTEXT → REASON → DIAGNOSE. Do not let successful component identification influence the condition result. ${vehicleContextPrompt(vehicleContext)} Vehicle context may narrow a likely location only after the pixels are evaluated; it must never override contradictory image evidence. A component being near its expected location is not evidence that it is connected, secure, intact, or installed.

Keep directly observed facts, likely interpretation, and technician verification separate. Visible wiring is not proof that its normal destination is visible, installed, damaged, or disconnected in error. A heavy-gauge positive cable near the transmission/bellhousing may be a starter power cable, and a smaller connector may be a starter-solenoid exciter wire, but do not call either a starter or solenoid. If expected wiring is visible but its normal component is not, report the wiring actually visible; describe the destination only as likely; state that the connected component cannot be confirmed and may be removed, outside the frame, or obscured; and recommend technician verification. Do not automatically classify disconnected wiring as a defect when active repair or disassembly is plausible. Continue detecting visibly loose connectors, broken parts, missing fasteners, separated intake/turbo pipes, damaged wiring, leaks, and improper installation, but only when each is supported by visible evidence. Never invent hidden parts, connections, damage, or installation conditions. Reduce confidence whenever defining evidence is missing.

First inspect every visible battery terminal/post, pipe or hose connection, coupler, joint, clamp, electrical connector, fastener, bracket, mount, sealing surface, alignment, seating edge, and gap/separation point independently—before analyzing residue, dirt, oil, coolant, corrosion, or staining. Sweep for disconnected or partially seated terminals/connectors, hanging harnesses, loose cables/grounds, broken or collapsed hoses, open ports, exposed terminals, missing fasteners/clamps/components, damaged insulation, leaks, corrosion, abnormal gaps, displaced parts, and incorrect routing. For each visible connection, return one non-duplicated connectionAssessment with its exact image-relative location, one seatingStatus, findingType, severity, independent findingConfidence, exact pixel-supported visibleEvidence, matingComponentVisible, directDamageVisible, missingContext, concise physical verification, and cautious safety/drivability impact. A battery terminal beside a battery post, connector beside a sensor, hose beside a fitting, or cable beside a starter is NOT connected unless the actual mating relationship is visibly continuous and seated. Never say connected, secure, properly installed, intact, normal, or no damage visible without affirmative visible mating evidence. Prefer technician-friendly locations such as “lower-left area of image,” “center-right beside the large cable,” or “upper-center behind the harness” only when visible pixels support them. Never use driver side, passenger side, vehicle front, or vehicle rear unless supplied context or image evidence establishes it. If image-relative location is not reliable, return exactly “Image-relative location cannot be determined reliably.” Before calling a disconnected connector, hose, cable, line, sensor, or fitting defective, determine whether its intended mating component is visible. If it is missing, removed, outside the image, or cannot be identified and no direct damage is visible, use COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE, UNVERIFIED_CONDITION, UNDETERMINED severity, no safety/drivability impact, and explain the missing context. Preserve this as meaningful inspected evidence rather than returning UNABLE_TO_INSPECT: describe the visible leads/connectors and say whether their position is consistent with a likely destination, but do not claim the component is missing. For starter-context wiring, use this exact verification: “${STARTER_CONTEXT_VERIFICATION}” Do not use CLEAR_DEFECT, HIGH severity, or a hypothetical safety/drivability consequence in that situation. A hanging connector near an empty mounting location is not proof of failure. CLEAR_DEFECT requires both mating halves visibly separated, a loose/backed-out installed connector, broken/disengaged lock, damaged terminals/wiring/retention hardware, visible leakage/arcing/overheating, or visibly incorrect routing/installation. Treat upper and lower turbo/charge-air connections as separate interfaces: a properly seated lower clamp must never cancel, reduce, or replace an abnormal upper connection. Use SEPARATION_OR_GAP_VISIBLE with CLEAR_DEFECT when a battery terminal is visibly displaced from its post, or when a pipe end, coupler, or mating surface is visibly separated; classify it HIGH only when the directly visible defect supports that severity, MODERATE when impact remains uncertain, or CRITICAL only for immediate visible safety risk or likely severe damage. Use POSSIBLE_IMPROPER_SEATING with POSSIBLE_CONCERN for limited evidence and state: “Possible disconnected, partially separated, or improperly seated connection.” Use RESIDUE_OR_STAINING only for residue/discoloration without claiming a disconnected pipe; severity is normally LOW or MODERATE. If residue and an abnormal connection are both visible, list the connection finding first and residue only as supporting evidence. Use NOT_RELIABLY_VISIBLE with SEATING_NOT_RELIABLY_VISIBLE and UNDETERMINED severity when seating is obscured; say “Unable to verify from this image.” Use NO_GAP_OR_SEPARATION_VISIBLE with NO_DEFECT_VISIBLE only when the image clearly shows the interface fully assembled. A visible gap, uneven insertion depth, exposed sealing surface/connector neck, offset lip, pipe end outside a coupler, displaced clamp, missing retainer, abnormal angle, or misaligned mating edge must never be treated as normal or downgraded to residue merely because the primary component is recognizable.

Then inspect only visible cracks, breaks, deformation, looseness, leaks/residue, missing parts, disconnected components, corrosion, overheating, rubbing, chafing, and impact damage. Return OBSERVED_CONDITION for directly visible defects and require every visible separation to remain a clear observed defect. Return POSSIBLE_CONCERN_DETECTED only for a suspicious connection or residue finding that needs hands-on confirmation; name its location, explain what appears abnormal, explicitly require physical confirmation, and give a safe verification step. A secondary finding is allowed only when it has distinct direct physical evidence of its own. A hose, cable, wire, connector, clamp, or line merely being visible is not loose, disconnected, improperly seated, damaged, or defective. Do not infer a secondary defect from routing, angle, shadows, partial visibility, unfamiliar appearance, or uncertainty; omit it or state that no additional defect is visually confirmed. Return UNABLE_TO_INSPECT when lighting, angle, focus, or obstruction prevents a reliable assessment, and say exactly which connection cannot be confirmed plus request a closer image from another angle. Return NO_VISIBLE_CONCERN_DETECTED only if every visible connectionAssessment is affirmatively NO_GAP_OR_SEPARATION_VISIBLE and no defect is visually supported. Consolidate duplicate observations: do not repeat the same residue or connection concern in multiple findings. Never invent components, evidence, fluid type, leaks, loose parts, damage, failure, or a completed repair. Every finding must be anchored in visibleEvidence.

Use exact terminology only where the pictured feature supports it. Keep one selected primary assembly identity consistent across every condition explanation; observed objects and possible alternatives are not replacements for that identity. If drivetrain housing identity is uncertain, use “Drivetrain housing — exact assembly not confirmed” rather than switching between transmission housing and engine block. For a turbocharger, a visible silver intake-side scroll housing is the compressor housing, not the turbine housing. Refer to the turbine/exhaust side, actuator, oil/coolant lines, charge pipes, clamps, and connections only when each is visibly supported. For a suspected turbocharger or charge-air connection concern, recommend checking pipe seating, clamp position/tightness, coupler damage, retaining-clip engagement, oil residue or air-leak evidence, boost-leak symptoms, and relevant DTCs/scan data. Include safetyDrivabilityImpact only when applicable, with cautious language. Condition confidence must be independent from component-identification confidence: an uncertain assembly identity must not lower confidence in a separate directly visible defect. If no defect is visible, use this exact noVisibleConcernMessage: "${NO_VISIBLE_DEFECT_MESSAGE}".`;
    markDiagnostic(diagnostic, 'O_VISUAL_CONDITION_REQUEST_CONSTRUCTED', { visualConditionInspectionAttempted: true, visualConditionResponseReceived: false, visualConditionResultPresent: false });
    try {
      const conditionResponse = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(deepVisionRequest({ store: false, max_output_tokens: 950, input: [{ role: 'user', content: [{ type: 'input_text', text: `${conditionPrompt}\nCompleted component-identification context: ${componentIdentification?.primaryComponent||'Automotive component identification was unavailable'}. Use this context only to orient the inspection; all condition claims still require visible pixels.` }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: DEEP_VISION_DETAIL }] }], text: { format: { type: 'json_schema', name: 'nitros_visual_condition_inspection', strict: true, schema: visualConditionInspectionSchema } } })), signal: AbortSignal.timeout(Math.min(timeoutMs, VISUAL_CONDITION_TIMEOUT_MS))
      });
      const conditionBody = await conditionResponse.json().catch(() => null);
      markDiagnostic(diagnostic, 'P_VISUAL_CONDITION_RESPONSE_RECEIVED', { visualConditionResponseReceived: true, visualConditionResponseOk: conditionResponse.ok, visualConditionHttpStatus: conditionResponse.status, visualConditionElapsedMs: Math.max(0, Date.now() - conditionStartedAt) });
      if (!conditionResponse.ok) throw Object.assign(new Error(conditionBody?.error?.message || `Visual condition request failed with HTTP ${conditionResponse.status}.`), { visualConditionErrorCategory: classifyOpenAIError(conditionResponse.status, conditionBody), visualConditionHttpStatus: conditionResponse.status });
      if (!conditionBody) throw Object.assign(new Error('Visual condition response was not valid JSON.'), { visualConditionMalformedResponse: true });
      let conditionParsed;
      try { conditionParsed = JSON.parse(extractOutputText(conditionBody)); }
      catch (error) { throw Object.assign(error, { visualConditionMalformedResponse: true }); }
      try { const consistency = normalizeVisualConditionConsistency(retainVisibleConnectionContext(conditionParsed, componentIdentification)); visualConditionInspection = { ...validateVisualConditionInspection({ ...consistency.normalized, consistencyCorrections: consistency.corrections }), semanticRequestId: transactionId, imageHash }; if (consistency.corrections.length) markDiagnostic(diagnostic, 'Q_VISUAL_CONDITION_CONSISTENCY_REPAIRED', { visualConditionConsistencyCorrections: consistency.corrections }); }
      catch (error) { throw Object.assign(error, { visualConditionMalformedResponse: true }); }
      markDiagnostic(diagnostic, 'Q_VISUAL_CONDITION_RESULT_EXTRACTED', { visualConditionResponseParsed: true, visualConditionResultPresent: true, visualConditionStatus: visualConditionInspection.status, visualConditionConfidenceNormalized: visualConditionInspection.normalizedConditionConfidence !== null, visualConditionErrorCategory: null, visualConditionErrorMessage: null });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timed out|timeout/i.test(String(error?.message || ''));
      markDiagnostic(diagnostic, 'Q_VISUAL_CONDITION_FIRST_ATTEMPT_FAILED', { visualConditionFirstRequestTimeout: timedOut, visualConditionMalformedResponse: Boolean(error?.visualConditionMalformedResponse), visualConditionRetryStarted: true, visualConditionErrorMessage: sanitizeDiagnosticText(error?.message) });
      const retryPrompt = `Inspect only the visible physical connections in this same image. Prioritize gaps, separation, incomplete seating, clamp/retainer position, cracks, and disconnected fittings before residue. Return the same structured condition result. Do not invent defects. If a connection cannot be seen, use NOT_RELIABLY_VISIBLE and explain the limitation. Component context: ${componentIdentification?.primaryComponent||'unavailable'}.`;
      try {
        const retryResponse = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(deepVisionRequest({ store: false, max_output_tokens: 650, input: [{ role: 'user', content: [{ type: 'input_text', text: retryPrompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: DEEP_VISION_DETAIL }] }], text: { format: { type: 'json_schema', name: 'nitros_visual_condition_retry', strict: true, schema: visualConditionInspectionSchema } } })), signal: AbortSignal.timeout(Math.min(timeoutMs, VISUAL_CONDITION_RETRY_TIMEOUT_MS)) });
        const retryBody = await retryResponse.json().catch(() => null);
        if (!retryResponse.ok) throw Object.assign(new Error(retryBody?.error?.message || `Visual condition retry failed with HTTP ${retryResponse.status}.`), { visualConditionHttpStatus: retryResponse.status });
        if (!retryBody) throw Object.assign(new Error('Visual condition retry response was not valid JSON.'), { visualConditionMalformedResponse: true });
        let retryParsed; try { retryParsed = JSON.parse(extractOutputText(retryBody)); } catch (retryError) { throw Object.assign(retryError, { visualConditionMalformedResponse: true }); }
        const consistency = normalizeVisualConditionConsistency(retainVisibleConnectionContext(retryParsed, componentIdentification)); visualConditionInspection = { ...validateVisualConditionInspection({ ...consistency.normalized, consistencyCorrections: consistency.corrections }), semanticRequestId: transactionId, imageHash }; if (consistency.corrections.length) markDiagnostic(diagnostic, 'Q_VISUAL_CONDITION_CONSISTENCY_REPAIRED', { visualConditionConsistencyCorrections: consistency.corrections });
        markDiagnostic(diagnostic, 'Q_VISUAL_CONDITION_RETRY_SUCCEEDED', { visualConditionRetrySuccess: true, visualConditionRetryFailure: false, visualConditionResultPresent: true, visualConditionStatus: visualConditionInspection.status, visualConditionConfidenceNormalized: visualConditionInspection.normalizedConditionConfidence !== null });
      } catch (retryError) {
      const safeMessage = timedOut ? 'Visual condition inspection timeout.' : sanitizeDiagnosticText(error?.message) || 'Visual condition inspection failed.';
      visualConditionInspection = { status: 'UNABLE_TO_INSPECT', conditionConfidence: null, rawConditionConfidence: null, normalizedConditionConfidence: null, observedCondition: [], possibleConcerns: [], connectionAssessments: [], noVisibleConcernMessage: '', unableToInspectReason: `${safeMessage} A shorter condition-only retry also could not complete; no repair decision should be made from this image.`, visibleEvidence: componentIdentification.supportingEvidence?.slice(0, 3) || [], recommendedVerification: ['Obtain a closer, well-lit image of each connection and perform a physical inspection before repair authorization.'], safetyDrivabilityImpact: null, semanticRequestId: transactionId, imageHash };
      markDiagnostic(diagnostic, 'Q_VISUAL_CONDITION_RETRY_FAILED', { visualConditionInspectionAttempted: true, visualConditionRetrySuccess: false, visualConditionRetryFailure: true, visualConditionResponseReceived: Boolean(diagnostic.visualConditionResponseReceived), visualConditionResponseParsed: false, visualConditionResultPresent: false, visualConditionStatus: 'UNABLE_TO_INSPECT', visualConditionConfidenceNormalized: false, visualConditionMalformedResponse: Boolean(retryError?.visualConditionMalformedResponse), visualConditionErrorCategory: error?.visualConditionErrorCategory || (timedOut ? 'OPENAI_TIMEOUT' : 'VISUAL_CONDITION_ANALYSIS_ERROR'), visualConditionErrorMessage: safeMessage, visualConditionHttpStatus: retryError?.visualConditionHttpStatus ?? error?.visualConditionHttpStatus ?? diagnostic.visualConditionHttpStatus ?? null, visualConditionElapsedMs: Math.max(0, Date.now() - conditionStartedAt) });
      }
    }
  }
  let automotiveGraphAnalysis = null;
  if (semanticResult.category === 'AUTOMOTIVE_GRAPH') {
    const graphStartedAt = Date.now();
    const graphPrompt = `Analyze only the visible pixels of this current automotive diagnostic graph or PID screen. This is a dedicated diagnostic interpretation stage after classification. Extract only labels, units, current numeric values, displayed minimum/maximum ranges, time scales, operating conditions, and vehicle identity that are genuinely readable. Never invent PID or sensor labels, voltages, scales, wire details, connector pins, specifications, OEM procedures, or vehicle-specific facts. Analyze every visible trace and panel, including RPM, fuel trim, oxygen/air-fuel sensors, temperature, pressure, frequency, duty cycle, upstream/downstream behavior, switching/cross-count activity, flatline or bias, correlation, and abnormal patterns when actually supported. A plotted trace extending across a horizontal graph axis is time-series evidence even when exact X-axis units are unreadable; in that case describe supported relative trace behavior and mark only the exact time scale uncertain. Evaluate each readable trace for supported stable, rising, falling, switching, oscillating, flat, intermittent, abrupt, delayed, correlated, inverse, or little-response characteristics without inventing frequency, timestamps, or response time. Every temporal claim must be supported by visible plotted geometry or ordered samples for that specific PID and claim; Current/Min/Max statistics never establish increases, decreases, direction, trends, oscillation, switching, cycles, response, stabilization, before/after sequence, or sustained behavior. Prefix supported temporal statements with Trace-derived observation. Keep current values semantically separate from displayed minimum/maximum ranges, and never characterize an entire range from the sign or state of its current value. Validate every extracted range before returning it: MIN must be less than or equal to CURRENT, CURRENT must be less than or equal to MAX, and MIN must be less than or equal to MAX. If OCR violates those relationships, do not swap values; retain only independently supported values and mark the questionable Min/Max values uncertain. Displayed min/max values alone are not temporal evidence and do not establish switching rate, response time, oscillation, correlation, frequency, or trend. Preserve low non-zero voltage precision exactly as readable; never round a value such as 0.055 V to 0 V. Keep directly visible facts in observed and diagnostic inferences in interpretation, separately rate diagnosticSignificance, and put every limitation in unreadableOrUncertain. A single captured PID value is only an instantaneous reading. Never call it activity, stable, unstable, switching, oscillating, responding, stuck, biased, trending, fluctuating, lean, rich, normal, abnormal, good, bad, or failed unless direct temporal evidence or a verified diagnostic criterion supports that conclusion. Static voltage may be described as low, high, midrange, current, captured, or instantaneous, but must not be converted into a mixture or component state. Without temporal evidence or a visibly verified specification, threshold, DTC-specific criterion, or pass/fail rule, use INDETERMINATE and do not label a high/low snapshot abnormal, mildly abnormal, PASS, or FAIL. Do not apply narrowband rules to A/F, AFS, air-fuel ratio, wideband, or lambda sensors. Positive current trims mean the PCM adds fuel; negative current trims mean it removes fuel at that captured instant only. When same-bank current STFT and LTFT are visible under the same condition, add them but do not substitute that arithmetic for trace behavior. Use RPM, coolant, speed, loop state, load, and throttle when visible. For catalyst/P0420 analysis prioritize directly visible upstream/downstream traces and time relationships; never condemn a converter from the graph alone, and never clear or condemn a catalyst from one voltage. When only snapshot values or min/max ranges exist, request simultaneous upstream A/F and downstream O2 live data in closed loop over time. When plotted history is already visible, do not ask to capture the same signals over time; request only missing scale, operating-condition, commanded-response, or companion-PID evidence that would add diagnostic value. Before returning, discard temporal inferences from snapshot-only values, preserve visible trace evidence, and remove any static-snapshot claim that contradicts readable plotted history. In visibleVehicle, report a vehicle only if identifying text is visibly readable in the image.`;
    markDiagnostic(diagnostic, 'P_GRAPH_ANALYSIS_REQUESTED', { graphAnalysisAttempted: true, graphAnalysisResponseReceived: false, graphAnalysisResultPresent: false });
    try {
      const graphResponse = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, store: false, max_output_tokens: 2200, input: [{ role: 'user', content: [{ type: 'input_text', text: graphPrompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' }] }], text: { format: { type: 'json_schema', name: 'nitros_automotive_graph', strict: true, schema: automotiveGraphSchema } } }), signal: analysisSignal });
      const graphBody = await graphResponse.json().catch(() => null);
      markDiagnostic(diagnostic, 'Q_GRAPH_ANALYSIS_RESPONSE', { graphAnalysisResponseReceived: true, graphAnalysisResponseOk: graphResponse.ok, graphAnalysisHttpStatus: graphResponse.status, graphAnalysisElapsedMs: Math.max(0, Date.now() - graphStartedAt) });
      if (!graphResponse.ok) throw new Error(graphBody?.error?.message || `Automotive graph request failed with HTTP ${graphResponse.status}.`);
      if (!graphBody) throw new Error('Automotive graph response was not valid JSON.');
      const validatedGraph=validateAutomotiveGraph(JSON.parse(extractOutputText(graphBody))),classificationTraceEvidence=semanticResult.graphEvidence||[];
      automotiveGraphAnalysis = { ...correctAutomotiveGraphReasoning({...validatedGraph,classifierGraphEvidence:classificationTraceEvidence}), semanticRequestId: transactionId, imageHash };
      const inconsistentPids=(automotiveGraphAnalysis.numericEvidence||[]).filter(row=>row.evidenceState==='INCONSISTENT').map(row=>row.pidName);
      if(inconsistentPids.length){
        const recoveryPrompt=`Re-read only these inconsistent PIDs from the current supplied image: ${inconsistentPids.join(', ')}. Independently identify the visibly displayed Current, Min, and Max for each named PID. Do not use prior images, cached results, another PID, expected automotive values, arithmetic repair, swapping, sign flipping, copying, clamping, or inference. Return null for any role that is not independently readable. Preserve the visible sign, decimal precision, and unit. Include concise visible evidence for each recovered role.`;
        markDiagnostic(diagnostic,'R_PID_RECOVERY_REQUESTED',{targetedPidRecoveryAttempted:true,targetedPidRecoveryPids:inconsistentPids});
        try{
          const recoveryResponse=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,store:false,max_output_tokens:900,input:[{role:'user',content:[{type:'input_text',text:recoveryPrompt},{type:'input_image',image_url:`data:${mimeType};base64,${imageBase64}`,detail:'high'}]}],text:{format:{type:'json_schema',name:'nitros_targeted_pid_recovery',strict:true,schema:targetedPidRecoverySchema}}}),signal:analysisSignal});
          const recoveryBody=await recoveryResponse.json().catch(()=>null);if(!recoveryResponse.ok||!recoveryBody)throw new Error(recoveryBody?.error?.message||`Targeted PID recovery failed with HTTP ${recoveryResponse.status}.`);const parsedRecovery=JSON.parse(extractOutputText(recoveryBody)),allowed=new Set(inconsistentPids.map(name=>name.toLowerCase()));
          const targetedPidRecovery=(Array.isArray(parsedRecovery?.recoveries)?parsedRecovery.recoveries:[]).filter(item=>allowed.has(String(item?.pidName||'').toLowerCase())).map(item=>({pidName:String(item.pidName),current:Number.isFinite(item.current)?item.current:null,minimum:Number.isFinite(item.minimum)?item.minimum:null,maximum:Number.isFinite(item.maximum)?item.maximum:null,unit:String(item.unit||''),visibleEvidence:cleanStringArray(item.visibleEvidence,'visibleEvidence'),status:item.status==='RECOVERED'?'RECOVERED':'UNREADABLE',semanticRequestId:transactionId,imageHash,generationId:transactionId}));
          const completeRecoveries=targetedPidRecovery.filter(item=>item.status==='RECOVERED'&&[item.current,item.minimum,item.maximum].every(Number.isFinite));if(completeRecoveries.length){const names=completeRecoveries.map(item=>item.pidName),targetPattern=new RegExp(names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'i'),numericRole=/\b(?:current|minimum|min|maximum|max)\b/i,recoveredValues=completeRecoveries.flatMap(item=>[`${item.pidName} Current: ${item.current}${item.unit}`,`${item.pidName} Min: ${item.minimum}${item.unit}`,`${item.pidName} Max: ${item.maximum}${item.unit}`]),recoveredGraph={...validatedGraph,valuesAndScales:[...(validatedGraph.valuesAndScales||[]).filter(item=>!(targetPattern.test(item)&&numericRole.test(item))),...recoveredValues],observed:(validatedGraph.observed||[]).filter(item=>!(targetPattern.test(item)&&numericRole.test(item))),classifierGraphEvidence:classificationTraceEvidence},postRecoveryReasoning=correctAutomotiveGraphReasoning(recoveredGraph);automotiveGraphAnalysis={...automotiveGraphAnalysis,targetedPidRecovery,postRecoveryReasoning};}else automotiveGraphAnalysis={...automotiveGraphAnalysis,targetedPidRecovery};markDiagnostic(diagnostic,'R_PID_RECOVERY_EXTRACTED',{targetedPidRecoveryResultPresent:true,targetedPidRecoveryCount:targetedPidRecovery.length});
        }catch(error){automotiveGraphAnalysis={...automotiveGraphAnalysis,targetedPidRecovery:inconsistentPids.map(pidName=>({pidName,current:null,minimum:null,maximum:null,unit:'',visibleEvidence:[],status:'UNREADABLE',semanticRequestId:transactionId,imageHash,generationId:transactionId}))};markDiagnostic(diagnostic,'R_PID_RECOVERY_FAILED',{targetedPidRecoveryResultPresent:false,targetedPidRecoveryErrorMessage:sanitizeDiagnosticText(error?.message)});}
      }else automotiveGraphAnalysis={...automotiveGraphAnalysis,targetedPidRecovery:[]};
      markDiagnostic(diagnostic, 'R_GRAPH_ANALYSIS_EXTRACTED', { graphAnalysisResponseParsed: true, graphAnalysisResultPresent: true, graphAnalysisStatus: automotiveGraphAnalysis.status });
    } catch (error) {
      const safeMessage = sanitizeDiagnosticText(error?.message) || 'Automotive graph analysis failed.';
      automotiveGraphAnalysis = { status: 'FAILED', confidence: null, rawConfidence: null, observed: [], interpretation: [], diagnosticSignificance: 'INCONCLUSIVE', nextTest: [], pidNames: [], sensorNames: [], valuesAndScales: [], traceFindings: [], unreadableOrUncertain: [safeMessage], visibleVehicle: { description: '', evidence: [] }, reasoningEvidence:{sensorTypeDetected:'NOT_CONFIRMED',fuelTrimPolarity:'NOT_AVAILABLE',combinedTrim:null,operatingState:'NOT_CONFIRMED',dynamicTraceEvidenceAvailable:false,catalystComparisonEvidenceAvailable:false,diagnosticCertainty:'UNAVAILABLE'},contradictionGuard:'NOT_RUN', semanticRequestId: transactionId, imageHash };
      markDiagnostic(diagnostic, 'R_GRAPH_ANALYSIS_FAILED', { graphAnalysisAttempted: true, graphAnalysisResponseParsed: false, graphAnalysisResultPresent: false, graphAnalysisErrorMessage: safeMessage });
    }
  } else markDiagnostic(diagnostic, diagnostic.stage, { graphAnalysisAttempted: false, graphAnalysisSkipped: true });
  let wiringDiagramAnalysis = null;
  if (semanticResult.category === 'AUTOMOTIVE_WIRING_DIAGRAM') {
    const diagramStartedAt = Date.now();
    const diagramPrompt = `Analyze only the currently supplied automotive wiring diagram pixels. Extract and retain every independently readable circuit component and path even when another field is unclear. Never invent OEM connector names, pin numbers, wire colors, circuit numbers, voltages, specifications, or circuit functions. Mark only each genuinely unreadable field with "Not reliably readable from supplied diagram." in unreadableFields; one unreadable connector, pin, or wire designation must not erase otherwise reliable components or circuit paths. Identify the principal circuit/component, schematic structural evidence, components, neutral circuit paths, connectors/pins, fuses, relays, splices, wire details, and important observations. For each circuit path, set functionConfirmed true only when its function is visibly labeled or otherwise unambiguously established by the diagram; otherwise use neutral Circuit Leg A/B naming and exactly "Circuit function not reliably confirmed from supplied diagram." Do not label a two-wire resistive sensor as conventional power and ground merely from typical design, wire color, pin number, or position. If a detail needed for a safe guided test is blurry, cropped, or too small, use INSUFFICIENT_READABILITY and explain what close-up is needed while still returning other readable evidence and source confidence.

Build at most eight logical diagnostic tests following VERIFY → TEST → ISOLATE → REPAIR → CONFIRM, but do not present them all to the technician at once; the client will reveal one test at a time. Prefer loaded voltage-drop or operational checks over resistance testing where appropriate. Each step must specify meter/tool mode, exact red and black probe locations, connector state, key/engine condition, loading, expected behavior, branch indices, and evidence-based conclusions. Provide exact numeric limits only when visible in the diagram, supplied by the technician, or established electrical principle, and identify that source. A single ambiguous voltage reading must be INCONCLUSIVE and must never verify a fault. Distinguish normal module pull-up from a short to battery voltage. Only use a VERIFIED conclusion after an isolation test proves the named fault; external circuits and components must be ruled out before suggesting a module fault. Never advise blind power jumpers, energized resistance/continuity tests, unsafe SRS probing, or loading communication lines. Every resistance or continuity instruction must explicitly say "Key OFF. Circuit must be de-energized before resistance/continuity testing." Do not condemn a component merely because a DTC or label names it.`;
    markDiagnostic(diagnostic, 'P_WIRING_ANALYSIS_REQUESTED', { wiringDiagramAnalysisAttempted: true, wiringDiagramResponseReceived: false, wiringDiagramResultPresent: false });
    try {
      const diagramResponse = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, store: false, max_output_tokens: 2200, input: [{ role: 'user', content: [{ type: 'input_text', text: diagramPrompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' }] }], text: { format: { type: 'json_schema', name: 'nitros_wiring_diagram', strict: true, schema: wiringDiagramSchema } } }), signal: analysisSignal });
      const diagramBody = await diagramResponse.json().catch(() => null);
      markDiagnostic(diagnostic, 'Q_WIRING_ANALYSIS_RESPONSE', { wiringDiagramResponseReceived: true, wiringDiagramResponseOk: diagramResponse.ok, wiringDiagramHttpStatus: diagramResponse.status, wiringDiagramElapsedMs: Math.max(0, Date.now() - diagramStartedAt) });
      if (!diagramResponse.ok) throw new Error(diagramBody?.error?.message || `Wiring diagram request failed with HTTP ${diagramResponse.status}.`);
      if (!diagramBody) throw new Error('Wiring diagram response was not valid JSON.');
      wiringDiagramAnalysis = { ...validateWiringDiagram(JSON.parse(extractOutputText(diagramBody))), semanticRequestId: transactionId, imageHash };
      markDiagnostic(diagnostic, 'R_WIRING_ANALYSIS_EXTRACTED', { wiringDiagramResponseParsed: true, wiringDiagramResultPresent: true, wiringDiagramStatus: wiringDiagramAnalysis.status, wiringDiagramErrorMessage: null });
    } catch (error) {
      const safeMessage = sanitizeDiagnosticText(error?.message) || 'Wiring diagram analysis failed.';
      wiringDiagramAnalysis = { status: 'FAILED', circuitComponent: 'Wiring diagram analysis failed', confidence: null, rawConfidence: null, normalizedConfidence: null, structuralEvidence: [], detectedComponents: [], connectorsAndPins: [], circuitPaths: [], fuses: [], relays: [], splices: [], wireDetails: [], importantObservations: [], unreadableFields: [safeMessage], safetyWarning: null, testPlan: [], semanticRequestId: transactionId, imageHash };
      markDiagnostic(diagnostic, 'R_WIRING_ANALYSIS_FAILED', { wiringDiagramAnalysisAttempted: true, wiringDiagramResponseParsed: false, wiringDiagramResultPresent: false, wiringDiagramErrorMessage: safeMessage, wiringDiagramElapsedMs: Math.max(0, Date.now() - diagramStartedAt) });
    }
  } else markDiagnostic(diagnostic, diagnostic.stage, { wiringDiagramAnalysisAttempted: false, wiringDiagramAnalysisSkipped: true });
  let documentRepairInformation = null;
  if (semanticResult.category === 'DOCUMENT_OR_TEXT_SCREENSHOT') {
    const documentStartedAt = Date.now();
    const documentPrompt = `Extract repair-information text only from the visible pixels of this current document, text screen, or screenshot. Do not use filenames, metadata, prior images, prior cases, cached results, general automotive knowledge, typical circuit values, expected sensor voltages, or OEM-style procedures not visibly printed in this image. Do not reclassify the image. Transcribe only visibly supported information for one diagnostic circuit-isolation test: applicable DTC codes, test name, component or circuit, test location including connector or terminal only when visibly provided, test method, required specification or pass/fail criterion, and the technician measurement/result requested by the procedure. Never manufacture, infer, complete, substitute, or supplement missing connector names, pins, terminals, wire colors, methods, specifications, voltage ranges, resistance limits, or pass/fail values. For criterionEvidence, provide the exact visible text supporting criterion. If no criterion/specification is visibly printed, return criterion and criterionEvidence as empty strings, comparator as an empty string, minimum and maximum as null, include criterion in missingRequiredFields, and set status INCOMPLETE. Resolve dtcApplicability explicitly as APPLICABLE when a DTC is visibly supplied for the test, NOT APPLICABLE when no DTC is visibly supplied, or UNKNOWN / CANNOT DETERMINE when the visible document does not permit that determination. An explicit NOT APPLICABLE or UNKNOWN / CANNOT DETERMINE is a resolved value and is not a missing field. Use an empty string or null for other unsupported fields and list every genuinely missing required field. Set COMPLETE only when applicability is resolved and component/circuit, location, method, visibly evidenced criterion, and requested result are all visibly supported. Derive comparator and numeric bounds only from criterionEvidence. Include short visibleTextEvidence excerpts supporting the extracted fields.`;
    markDiagnostic(diagnostic, 'S_DOCUMENT_EXTRACTION_REQUESTED', { documentExtractionAttempted: true, documentExtractionResponseReceived: false, documentExtractionResultPresent: false });
    try {
      const documentResponse = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, store: false, max_output_tokens: 1600, input: [{ role: 'user', content: [{ type: 'input_text', text: documentPrompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' }] }], text: { format: { type: 'json_schema', name: 'nitros_document_repair_information', strict: true, schema: documentRepairInformationSchema } } }), signal: analysisSignal });
      const documentBody = await documentResponse.json().catch(() => null);
      markDiagnostic(diagnostic, 'T_DOCUMENT_EXTRACTION_RESPONSE', { documentExtractionResponseReceived: true, documentExtractionResponseOk: documentResponse.ok, documentExtractionHttpStatus: documentResponse.status, documentExtractionElapsedMs: Math.max(0, Date.now() - documentStartedAt) });
      if (!documentResponse.ok) throw new Error(documentBody?.error?.message || `Document extraction request failed with HTTP ${documentResponse.status}.`);
      if (!documentBody) throw new Error('Document extraction response was not valid JSON.');
      documentRepairInformation = { ...validateDocumentRepairInformation(JSON.parse(extractOutputText(documentBody))), semanticRequestId: transactionId, imageHash };
      markDiagnostic(diagnostic, 'U_DOCUMENT_EXTRACTION_COMPLETE', { documentExtractionResponseParsed: true, documentExtractionResultPresent: true, documentExtractionStatus: documentRepairInformation.status, documentExtractionMissingFields: documentRepairInformation.missingRequiredFields });
    } catch (error) {
      const safeMessage = sanitizeDiagnosticText(error?.message) || 'Document extraction failed.';
      documentRepairInformation = {status:'UNREADABLE',dtcApplicability:'',dtcs:[],testName:'',componentOrCircuit:'',testLocation:'',method:'',criterion:'',criterionEvidence:'',requestedResult:'',comparator:'',minimum:null,maximum:null,visibleTextEvidence:[],missingRequiredFields:['DTC applicability','component or circuit','test location','test method','criterion','requested technician result'],error:safeMessage,semanticRequestId:transactionId,imageHash};
      markDiagnostic(diagnostic, 'U_DOCUMENT_EXTRACTION_FAILED', { documentExtractionResponseParsed: false, documentExtractionResultPresent: false, documentExtractionStatus: 'UNREADABLE', documentExtractionErrorMessage: safeMessage });
    }
  } else markDiagnostic(diagnostic, diagnostic.stage, { documentExtractionAttempted: false, documentExtractionSkipped: true });
  visualConditionInspection=mergeObservationWithCondition(visualObservation,visualConditionInspection);
  visualConditionInspection=fuseLocalizedVisualEvidence(visualConditionInspection,localizedVisualInspections);
  visualConditionInspection=reconcileVisualFindings(visualConditionInspection,{observation:visualObservation,relationship:vehicleAreaRelationshipAnalysis,vehicleContextState:vehicleContext?'MATCH':'UNAVAILABLE'});
  vehicleAreaRelationshipAnalysis=reconcileVehicleAreaRelationship(vehicleAreaRelationshipAnalysis,visualConditionInspection);
  if(vehicleAreaRelationshipAnalysis)markDiagnostic(diagnostic,'S_RELATIONSHIP_RECOVERY_COMPLETE',{vehicleAreaRelationshipResultPresent:true,vehicleAreaRelationshipStatus:'READY',vehicleAreaSource:vehicleAreaRelationshipAnalysis.vehicleAreaSource,vehicleAreaReason:vehicleAreaRelationshipAnalysis.vehicleAreaReason,relationshipSource:vehicleAreaRelationshipAnalysis.relationshipSource,relationshipReason:vehicleAreaRelationshipAnalysis.relationshipReason,photoGuidanceSource:vehicleAreaRelationshipAnalysis.photoGuidanceSource,photoGuidanceReason:vehicleAreaRelationshipAnalysis.photoGuidanceReason});
  const conflictEvaluation=evaluateCrossFindingConflicts(visualConditionInspection);
  const finalEvidencePromotion=promoteFinalEvidence(visualConditionInspection,conflictEvaluation);
  visualConditionInspection={...visualConditionInspection,conflictEvaluation,finalEvidencePromotion,reconciliation:{...visualConditionInspection.reconciliation,conflicts:conflictEvaluation.conflicts,promotable:finalEvidencePromotion.eligible}};
  const canonicalVisualState=buildCanonicalVisualState(componentIdentification,visualConditionInspection);
  visualConditionInspection={...visualConditionInspection,canonicalVisualState};
  markDiagnostic(diagnostic,'S_CROSS_FINDING_RECONCILIATION_COMPLETE',{reconciliationReasonCode:visualConditionInspection?.reconciliation?.reason||'RECONCILE_EXCEPTION',crossFindingConsistency:conflictEvaluation.status,crossFindingConflictsResolved:!conflictEvaluation.hasUnresolvedConflict,crossFindingRejectionReasons:visualConditionInspection?.reconciliationErrors?.map(item=>item.reason)||[],finalEvidencePromotion:finalEvidencePromotion.status,visibleDefectPromotedCount:finalEvidencePromotion.promotedCount||0,finalPositiveVisibleFindings:(visualConditionInspection?.connectionAssessments||[]).filter(item=>['CLEAR_DEFECT','POSSIBLE_CONCERN'].includes(item.findingType)).length,contradictionReconciliationResult:conflictEvaluation.status});
  semanticResult.visualObservation=visualObservation;
  semanticResult.localizedVisualInspections = localizedVisualInspections;
  semanticResult.componentIdentification = componentIdentification;
  semanticResult.visualConditionInspection = visualConditionInspection;
  semanticResult.canonicalVisualState = canonicalVisualState;
  semanticResult.vehicleAreaRelationshipAnalysis = vehicleAreaRelationshipAnalysis;
  semanticResult.automotiveGraphAnalysis = automotiveGraphAnalysis;
  semanticResult.wiringDiagramAnalysis = wiringDiagramAnalysis;
  semanticResult.electricalCircuitAnalysis = buildElectricalCircuitAnalysis(semanticResult, componentIdentification, visualConditionInspection, transactionId, imageHash);
  if (semanticResult.electricalCircuitAnalysis) markDiagnostic(diagnostic, 'V_ELECTRICAL_CIRCUIT_ANALYSIS_EXECUTED', { electricalCircuitAnalysisAttempted: true, electricalCircuitAnalysisExecuted: true, electricalDiagramAnalysisExecuted: true, electricalVisibleCircuitAnalysisExecuted: true, electricalTestGuidanceGenerated: true, electricalCircuitStatus: semanticResult.electricalCircuitAnalysis.visibleCircuitStatus, electricalDiagramStatus: semanticResult.electricalCircuitAnalysis.diagramStatus });
  else markDiagnostic(diagnostic, diagnostic.stage, { electricalCircuitAnalysisAttempted: false, electricalCircuitAnalysisSkipped: true });
  semanticResult.documentRepairInformation = documentRepairInformation;
  semanticResult.vehicleContextApplied = vehicleContext ? { available: true, summary: [vehicleContext.year, vehicleContext.make, vehicleContext.model, vehicleContext.engine, vehicleContext.fuelType, vehicleContext.drivetrain, vehicleContext.configuration].filter(Boolean).join(' · ') || 'Vehicle configuration reference available' } : { available: false, summary: '' };
  semanticResult.vehicleContextBinding = vehicleContext ? { year: vehicleContext.year, make: vehicleContext.make, model: vehicleContext.model, engine: vehicleContext.engine || '', vin: vehicleContext.vin || '', activeCaseId: vehicleContext.activeCaseId || '', repairOrderId: vehicleContext.repairOrderId || '', vehicleId: vehicleContext.vehicleId || '', contextVersion: vehicleContext.contextVersion || '', source: vehicleContext.source || 'active case snapshot' } : null;
  return {
    transactionId,
    imageHash,
    analyzer: `OpenAI ${MODEL}`,
    transportStatus,
    semanticResult,
    serverDiagnostic: diagnostic
  };
}
