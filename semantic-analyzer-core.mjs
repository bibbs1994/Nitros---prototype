import { createHash } from 'node:crypto';

export const ALLOWED_CATEGORIES = Object.freeze([
  'AUTOMOTIVE_GRAPH',
  'AUTOMOTIVE_WIRING_DIAGRAM',
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
  required: ['status', 'primaryComponent', 'componentConfidence', 'system', 'secondaryComponents', 'supportingEvidence', 'possibleAlternatives', 'uncertaintyReason', 'drivetrainDiscrimination'],
  properties: {
    status: { type: 'string', enum: ['IDENTIFIED', 'UNCERTAIN'] },
    primaryComponent: { type: 'string', maxLength: 160 },
    componentConfidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'string', pattern: '^\\s*(?:\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%?\\s*$' }, { type: 'null' }] },
    system: { anyOf: [{ type: 'string', maxLength: 160 }, { type: 'null' }] },
    secondaryComponents: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    supportingEvidence: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    possibleAlternatives: { type: 'array', items: { type: 'string' }, maxItems: 8 },
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
  required: ['status','dtcs','testName','componentOrCircuit','testLocation','method','criterion','requestedResult','comparator','minimum','maximum','visibleTextEvidence','missingRequiredFields'],
  properties: {
    status: { type: 'string', enum: ['COMPLETE','INCOMPLETE','UNREADABLE'] },
    dtcs: { type: 'array', items: { type: 'string', pattern: '^[PCBU][0-9A-F]{4}$' }, maxItems: 16 },
    testName: { type: 'string', maxLength: 200 },
    componentOrCircuit: { type: 'string', maxLength: 300 },
    testLocation: { type: 'string', maxLength: 400 },
    method: { type: 'string', maxLength: 700 },
    criterion: { type: 'string', maxLength: 300 },
    requestedResult: { type: 'string', maxLength: 300 },
    comparator: { type: 'string', enum: ['','<=','>=','range'] },
    minimum: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    maximum: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    visibleTextEvidence: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    missingRequiredFields: { type: 'array', items: { type: 'string', enum: ['DTC applicability','component or circuit','test location','test method','criterion','requested technician result'] }, maxItems: 6 }
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
  if (result.status === 'IDENTIFIED' && !result.supportingEvidence.length) throw new Error('Component identification has no visible supporting evidence.');
  if (result.status === 'UNCERTAIN' && !result.uncertaintyReason) throw new Error('Component uncertainty reason is missing.');
  return result;
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
  const result = {status:raw.status,dtcs:Array.isArray(raw.dtcs)?[...new Set(raw.dtcs.filter(code=>/^[PCBU][0-9A-F]{4}$/.test(code)))].slice(0,16):[],testName:text('testName',200),componentOrCircuit:text('componentOrCircuit',300),testLocation:text('testLocation',400),method:text('method',700),criterion:text('criterion',300),requestedResult:text('requestedResult',300),comparator:['','<=','>=','range'].includes(raw.comparator)?raw.comparator:'',minimum:Number.isFinite(raw.minimum)?raw.minimum:null,maximum:Number.isFinite(raw.maximum)?raw.maximum:null,visibleTextEvidence:cleanStringArray(raw.visibleTextEvidence,'visibleTextEvidence'),missingRequiredFields:Array.isArray(raw.missingRequiredFields)?[...new Set(raw.missingRequiredFields.filter(field=>allowedMissing.has(field)))]:[]};
  const required=[['DTC applicability',result.dtcs.length],['component or circuit',result.componentOrCircuit],['test location',result.testLocation],['test method',result.method],['criterion',result.criterion],['requested technician result',result.requestedResult]];
  result.missingRequiredFields=[...new Set([...result.missingRequiredFields,...required.filter(([,value])=>!value).map(([field])=>field)])];
  if(result.status==='COMPLETE'&&result.missingRequiredFields.length)result.status='INCOMPLETE';
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

  const prompt = `Analyze only the pixels of this current image. Do not use filenames, metadata, prior images, or OCR words as proof of automotive content. Return exactly one category. AUTOMOTIVE_GRAPH requires multiple independent visible graph indicators such as axes or gridlines plus plotted traces, repeated scale markings, panels, legends, or time-series structure. AUTOMOTIVE_WIRING_DIAGRAM requires actual electrical schematic structure such as connected circuit paths plus multiple schematic symbols, component/module blocks, connectors or pin/cavity identifiers, fuse/relay/ground/splice symbols, wire colors, circuit numbers, terminals, power references, or signal/reference/return paths. Automotive words or OCR text alone are insufficient. AUTOMOTIVE_COMPONENT_OR_VEHICLE requires positive visible automotive photographic subjects such as a vehicle, brake/engine/suspension component, connector, physical wiring, dashboard, scan tool, or diagnostic equipment. General photos of animals, people, food, furniture, scenery, or buildings without automotive evidence are GENERAL_NON_AUTOMOTIVE_PHOTO. Non-schematic documents, screenshots, invoices, text screens, and data tables are DOCUMENT_OR_TEXT_SCREENSHOT. Use UNKNOWN_OR_ANALYSIS_UNAVAILABLE when visual evidence is inadequate or conflicting. Evidence and object names must describe visible pixel-supported content. Confidence must reflect the genuine visual classification; use null if a defensible value is unavailable.`;
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
    const componentPrompt = `Identify the primary automotive component visible in this current image using only visible pixels. Do not use filenames, metadata, OCR text alone, prior images, prior cases, cached results, or the category confidence. Return the most specific component supported by visible evidence, its automotive system, secondary visible components, and pixel-supported evidence. Component confidence must be independent from category confidence. If the exact component is not visually defensible, use status UNCERTAIN, list visually supported alternatives, explain what view or evidence is missing, and never force or invent a component.

Before finalizing Transfer Case, Differential, Transmission, or Transaxle, complete drivetrainDiscrimination from visible geometry, mounting position, connected shafts, surrounding components, and drivetrain layout—not housing shape alone. Explicitly determine: connection to engine; connection directly behind transmission; driveshaft inputs and outputs; whether multiple longitudinal outputs exist; whether lateral axle/CV outputs or axle tubes lead toward wheels; centerline versus axle position; and whether the visible role is primary gearbox, front/rear torque distribution, final drive, or an integrated gearbox/final drive.

TRANSFER CASE evidence includes a separate gearbox directly attached to or behind the transmission near the vehicle centerline, rear and possibly front driveline outputs, irregular gearbox housing, and absence of lateral axle tubes. Exhaust, heat shields, crossmembers, perimeter bolts, or a nearby driveshaft alone are not sufficient. DIFFERENTIAL evidence includes an axle/final-drive position, lateral axle shafts/CV outputs or axle tubes toward both wheels, and a driveshaft terminating at a pinion/input; perimeter bolts, under-vehicle location, or a nearby driveshaft alone are insufficient. TRANSMISSION evidence includes a large gearbox connected to the engine, bellhousing/main case, pan, cooler lines, connectors, shift mechanism, or transmission crossmember; a transfer case can be secondary behind it. TRANSAXLE evidence includes an integrated transmission/final-drive assembly with lateral CV axles in a transverse/FWD-style layout.

Set distinguishingFeaturesComplete true only when the selected exact drivetrain type has strong visible discriminators. Otherwise lower component confidence, include the closest competing type in possibleAlternatives and drivetrainDiscrimination.competingCandidate, and explain the ambiguity. Supporting evidence must specifically justify the selected primary component. Secondary items such as driveshaft, exhaust, heat shield, crossmember, transmission, differential, CV axle, or suspension must not override the visually dominant intended subject.`;
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
    const documentPrompt = `Extract repair-information text only from the visible pixels of this current document, text screen, or screenshot. Do not use filenames, metadata, prior images, prior cases, cached results, general automotive knowledge, or typical OEM procedures. Do not reclassify the image. Transcribe only visibly supported information for one diagnostic circuit-isolation test: applicable DTC codes, test name, component or circuit, test location including connector or terminal only when visibly provided, test method, required specification or pass/fail criterion, and the technician measurement/result requested by the procedure. Never manufacture missing connector names, pins, terminals, wire colors, methods, or specifications. Use an empty string or null for unsupported fields and list every missing required field. Set COMPLETE only when DTC applicability, component/circuit, location, method, criterion, and requested result are all visibly supported; otherwise use INCOMPLETE or UNREADABLE. Derive comparator and numeric bounds only when the visible criterion explicitly supports them. Include short visibleTextEvidence excerpts supporting the extracted fields.`;
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
      documentRepairInformation = {status:'UNREADABLE',dtcs:[],testName:'',componentOrCircuit:'',testLocation:'',method:'',criterion:'',requestedResult:'',comparator:'',minimum:null,maximum:null,visibleTextEvidence:[],missingRequiredFields:['DTC applicability','component or circuit','test location','test method','criterion','requested technician result'],error:safeMessage,semanticRequestId:transactionId,imageHash};
      markDiagnostic(diagnostic, 'U_DOCUMENT_EXTRACTION_FAILED', { documentExtractionResponseParsed: false, documentExtractionResultPresent: false, documentExtractionStatus: 'UNREADABLE', documentExtractionErrorMessage: safeMessage });
    }
  } else markDiagnostic(diagnostic, diagnostic.stage, { documentExtractionAttempted: false, documentExtractionSkipped: true });
  semanticResult.componentIdentification = componentIdentification;
  semanticResult.wiringDiagramAnalysis = wiringDiagramAnalysis;
  semanticResult.documentRepairInformation = documentRepairInformation;
  return {
    transactionId,
    imageHash,
    analyzer: `OpenAI ${MODEL}`,
    transportStatus,
    semanticResult,
    serverDiagnostic: diagnostic
  };
}
