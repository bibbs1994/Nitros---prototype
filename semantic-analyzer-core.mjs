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
    valuesAndScales: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    traceFindings: { type: 'array', items: { type: 'string' }, maxItems: 24 },
    unreadableOrUncertain: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    visibleVehicle: { type: 'object', additionalProperties: false, required: ['description','evidence'], properties: {
      description: { type: 'string', maxLength: 200 }, evidence: { type: 'array', items: { type: 'string' }, maxItems: 8 }
    } }
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
  const labelPattern=labels.map(label=>label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),segments=String(text).split('|').filter(segment=>new RegExp(`\\b(?:${labelPattern})\\b`,'i').test(segment));
  let current=null,minimum=null,maximum=null,rawCurrent=null,rawMinimum=null,rawMaximum=null,signNormalizationApplied=false;
  for(const rawSegment of segments){
    const segment=normalizeAutomotiveNumericSigns(rawSegment);if(segment!==rawSegment)signNormalizationApplied=true;
    const rawValues=[...rawSegment.matchAll(/[+\-−–—]?\s*\d+(?:\.\d+)?/g)].map(match=>match[0].trim());
    const rangeMatch=segment.match(/([-+]?\d+(?:\.\d+)?)\s*(?:%|V|RPM)?\s*(?:to|through|\u2013|\u2014)\s*([-+]?\d+(?:\.\d+)?)\s*(?:%|V|RPM)?/i);
    if(rangeMatch){minimum=Number(rangeMatch[1]);maximum=Number(rangeMatch[2]);rawMinimum=rawValues.at(-2)||rangeMatch[1];rawMaximum=rawValues.at(-1)||rangeMatch[2];continue;}
    const valueMatch=segment.match(new RegExp(`\\b(?:${labelPattern})\\b[^-+\\d]{0,32}([-+]?\\d+(?:\\.\\d+)?)`,'i'));
    if(!valueMatch)continue;
    const value=Number(valueMatch[1]);
    const rawValue=rawValues.at(-1)||valueMatch[1];
    if(/\b(?:minimum|min)\b/i.test(segment)){minimum=value;rawMinimum=rawValue}
    else if(/\b(?:maximum|max)\b/i.test(segment)){maximum=value;rawMaximum=rawValue}
    else if(/\b(?:current|currently|now)\b/i.test(segment)||current===null){current=value;rawCurrent=rawValue}
  }
  const range=minimum!==null&&maximum!==null?{minimum,maximum}:null;
  const rangeValid=!range||(range.minimum<=range.maximum&&(current===null||(range.minimum<=current&&current<=range.maximum)));
  const inconsistencyReason=!range||rangeValid?'NONE':range.minimum>range.maximum?'MIN_GREATER_THAN_MAX':'CURRENT_OUTSIDE_MIN_MAX';
  return {current,range:rangeValid?range:null,invalidRange:range&&!rangeValid?range:null,rawCurrent,rawMinimum,rawMaximum,signNormalizationApplied,inconsistencyReason};
}

function canonicalNumericEvidence(name,unit,reading) {
  const tolerance=1e-6,sourceRange=reading.range||reading.invalidRange,minimum=sourceRange?.minimum??null,maximum=sourceRange?.maximum??null,current=reading.current;
  const hasRange=minimum!==null&&maximum!==null,consistent=!reading.invalidRange,includesZero=hasRange&&minimum<=tolerance&&maximum>=-tolerance,crossesZero=hasRange&&minimum<-tolerance&&maximum>tolerance;
  const rangeSign=!hasRange?'NOT_AVAILABLE':minimum>tolerance?'POSITIVE_ONLY':maximum<-tolerance?'NEGATIVE_ONLY':Math.abs(minimum)<=tolerance&&Math.abs(maximum)<=tolerance?'ZERO_ONLY':'INCLUDES_ZERO';
  return {pidName:name,rawCurrent:reading.rawCurrent,rawMinimum:reading.rawMinimum,rawMaximum:reading.rawMaximum,current,minimum,maximum,unit,confidence:null,sourceField:'NORMALIZED_PID_CURRENT_MIN_MAX',sign:current===null?'ABSENT':current>tolerance?'POSITIVE':current<-tolerance?'NEGATIVE':'ZERO',currentSign:current===null?'ABSENT':current>tolerance?'POSITIVE':current<-tolerance?'NEGATIVE':'ZERO',numericRange:hasRange?{minimum,maximum}:null,rangeSign,crossesZero,allObservedPositive:rangeSign==='POSITIVE_ONLY',allObservedNegative:rangeSign==='NEGATIVE_ONLY',includesZero,numericRangeConstant:hasRange&&Math.abs(maximum-minimum)<=tolerance,unreadable:false,currentPresent:current!==null,minimumPresent:minimum!==null,maximumPresent:maximum!==null,currentMinMaxConsistent:consistent,validityState:consistent?'VALID':'NUMERIC_INCONSISTENCY',inconsistencyReason:reading.inconsistencyReason,signNormalizationApplied:reading.signNormalizationApplied};
}

export function correctAutomotiveGraphReasoning(graph) {
  const all=[...(graph.observed||[]),...(graph.valuesAndScales||[]),...(graph.pidNames||[]),...(graph.sensorNames||[]),...(graph.traceFindings||[])].join(' | '),lower=all.toLowerCase();
  const normalizePidTerminology=item=>{let text=String(item);if(/\b(?:ltft|long ft|long-term fuel trim|stft|short ft|short-term fuel trim|engine speed|rpm|afs|a\/f sensor|air fuel ratio sensor)\b/i.test(text)){text=text.replace(/\bswitching\b/gi,'varying').replace(/\bswitches\b/gi,'varies').replace(/\bswitched\b/gi,'changed').replace(/\bswitch\b/gi,'change')}return text};
  const stftReading=graphPidMeasurement(all,['STFT B1','Short FT #1']),ltftReading=graphPidMeasurement(all,['LTFT B1','Long FT #1']),rearO2Reading=graphPidMeasurement(all,['O2S B1S2','B1S2']),afsReading=graphPidMeasurement(all,['AFS B1S1','A/F B1S1','AFS Voltage B1S1']),rpmReading=graphPidMeasurement(all,['Engine speed','RPM']),stft=stftReading.current,ltft=ltftReading.current,rpm=rpmReading.current,coolant=graphNumber(all,'Coolant'),rearO2=rearO2Reading.current,afs=afsReading.current,displayedRanges=[stftReading.range,ltftReading.range,rearO2Reading.range,afsReading.range,rpmReading.range].filter(Boolean),hasDisplayedRanges=displayedRanges.length>0;
  const readings=[['Long FT #1',ltftReading],['Short FT #1',stftReading],['O2S B1S2',rearO2Reading],['AFS B1S1',afsReading],['Engine Speed',rpmReading]],invalidReadings=readings.filter(([,reading])=>reading.invalidRange),invalidLabels=invalidReadings.map(([name])=>name);
  const validStft=stftReading.invalidRange?null:stft,validLtft=ltftReading.invalidRange?null:ltft;
  const numericEvidence=[canonicalNumericEvidence('Long FT #1','%',ltftReading),canonicalNumericEvidence('Short FT #1','%',stftReading),canonicalNumericEvidence('O2S B1S2','V',rearO2Reading),canonicalNumericEvidence('AFS B1S1','V',afsReading),canonicalNumericEvidence('Engine Speed','RPM',rpmReading)].filter(item=>item.currentPresent||item.minimumPresent||item.maximumPresent);
  const modelTraceEvidence=(graph.traceFindings||[]).map(normalizePidTerminology),classifierTraceEvidence=graph.classifierGraphEvidence||[],temporalSource=[...modelTraceEvidence,...classifierTraceEvidence,...(graph.observed||[])].join(' '),uncertaintySource=(graph.unreadableOrUncertain||[]).join(' '),wideband=/\b(?:a\/f sensor|afs|air fuel ratio sensor|wideband|lambda sensor)\b/i.test(all),hasAxes=/\b(?:axes|axis|x-axis|horizontal axis)\b/i.test(temporalSource),hasGridlines=/\b(?:grid|gridlines?)\b/i.test(temporalSource),hasPlottedTraces=/\b(?:plotted traces?|trace progression|graph lines? across|waveform|time-series)\b/i.test(temporalSource),hasMultipleTraceSamples=hasPlottedTraces||/\b(?:multiple|sequential|repeated)\s+(?:plotted )?(?:samples|points|readings)|data points visible across graphs?\b/i.test(temporalSource),positiveTraceEvidence=hasPlottedTraces||/\b(?:multiple samples|multiple plotted points|traces? (?:are )?visible|sequential (?:plotted )?(?:samples|points)|horizontal (?:trace |graph )?history|waveform (?:over|across) time|trace (?:switches|oscillates|changes|responds|rises|falls|varies)|data points visible across graphs?)\b/i.test(temporalSource),tracesUnreadable=/\b(?:plotted )?traces? (?:are |is )?(?:unreadable|not readable|not discernible|not visible)|no usable (?:plotted )?trace\b/i.test(uncertaintySource),dynamic=positiveTraceEvidence&&!tracesUnreadable,supportedCriterion=/\b(?:verified specification|specified (?:range|limit)|pass\/fail criterion|threshold (?:shown|displayed)|dtc-specific criterion)\b/i.test(all),catalystComparison=dynamic&&/(?:b1s1|upstream)/i.test(all)&&/(?:b1s2|downstream)/i.test(all);
  const present=condition=>condition?'PRESENT':'NOT_PRESENT',evidenceInventory={channels:[...new Set((graph.pidNames||[]).map(String).filter(Boolean))],upstreamAirFuel:present(/\b(?:afs|a\/f|air fuel ratio|b1s1|upstream)\b/i.test(all)),downstreamO2:present(/\b(?:o2s? b1s2|b1s2|downstream)\b/i.test(all)),shortTermFuelTrim:present(/\b(?:stft|short ft|short-term fuel trim)\b/i.test(all)),longTermFuelTrim:present(/\b(?:ltft|long ft|long-term fuel trim)\b/i.test(all)),engineSpeed:present(/\b(?:engine speed|rpm)\b/i.test(all)),closedLoopStatus:present(/\b(?:closed loop|fuel system status|fuel sys(?:tem)?\s*1)\b/i.test(all)),engineLoad:present(/\b(?:calculated load|absolute load|engine load|load pct)\b/i.test(all)),coolantTemperature:present(/\b(?:coolant|ect)\b/i.test(all)),throttlePosition:present(/\b(?:throttle|tps)\b/i.test(all)),vehicleSpeed:present(/\b(?:vehicle speed|vss|mph|km\/h)\b/i.test(all)),commandedMixture:present(/\b(?:commanded equivalence ratio|lambda command|commanded mixture)\b/i.test(all)),temporalEvidence:dynamic?'PRESENT':'NOT_PRESENT',timeScale:dynamic?(/\b(?:seconds?|milliseconds?|ms|sec)\s*(?:\/|per)\s*(?:division|div)|\btime scale\s*(?:is|:)\s*[-+\d]/i.test(all)?'PRESENT':'PRESENT_BUT_LIMITED'):'NOT_APPLICABLE',controlled2500Rpm:present(/\b(?:2,?500|2500)\s*(?:rpm)?\b/i.test(all)&&/\b(?:hold|held|steady|stable|controlled)\b/i.test(all))};
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
  const candidateNext=graph.nextTest||[],rejectedCandidates=dynamic?candidateNext.filter(redundantGraphCapture.test.bind(redundantGraphCapture)):[],proposedNext=candidateNext.filter(item=>!rejectedCandidates.includes(item));
  let unresolvedQuestion='',nextTestReason='',nextTest;
  if(invalidReadings.length){unresolvedQuestion=`Are the reported Current/Min/Max values correct for ${invalidLabels.join(', ')}?`;nextTest=[`Reconfirm ${invalidLabels.join(', ')} Current/Min/Max because the captured values are internally inconsistent.`];nextTestReason='The existing evidence for this PID is invalid, so verifying only the inconsistent channel is the smallest advancing step.'}
  else if(!dynamic){unresolvedQuestion='How do the upstream and downstream signals behave over time?';nextTest=['Capture upstream A/F sensor and downstream O2 sensor data simultaneously in closed loop over time so response and the relationship between the signals can be evaluated.'];nextTestReason='The current evidence is a static PID snapshot, so dynamic sensor behavior is not available.'}
  else if(proposedNext.length){unresolvedQuestion='What minimum additional evidence resolves the remaining diagnostic uncertainty?';nextTest=proposedNext.slice(0,1);nextTestReason='This step adds evidence not already established by the active graph.'}
  else if(evidenceInventory.closedLoopStatus!=='PRESENT'){unresolvedQuestion='Was the engine in closed loop during the visible sensor activity?';nextTest=['Add Fuel System Status / Closed Loop Status to the capture and verify the engine is in closed loop before interpreting oxygen-sensor behavior.'];nextTestReason='The sensor channels and temporal history are present, but closed-loop status is not confirmed.'}
  else if(evidenceInventory.engineLoad!=='PRESENT'){unresolvedQuestion='What engine load accompanied the visible sensor and fuel-trim behavior?';nextTest=['Add calculated load or absolute load while retaining the current sensor channels so their behavior can be correlated with engine operating condition.'];nextTestReason='The active graph contains the core channels, but engine load is not visible.'}
  else if(evidenceInventory.controlled2500Rpm!=='PRESENT'){unresolvedQuestion='Does the upstream/downstream relationship persist under a controlled elevated operating condition?';nextTest=['Hold the engine near 2,500 RPM in closed loop and capture the same upstream A/F, downstream O2, STFT, LTFT, and RPM channels.'];nextTestReason='The channels are already available; the missing evidence is a controlled steady operating condition.'}
  else{unresolvedQuestion='Do the upstream and downstream sensors respond appropriately to a controlled mixture change?';nextTest=['Perform a vehicle-appropriate controlled rich/lean response test while observing the existing upstream A/F and downstream O2 channels.'];nextTestReason='The current graph already contains the core channels and controlled operating state; commanded response remains unverified.'}
  const rangeUncertainty=invalidReadings.map(([name,reading])=>`${name} Current ${reading.current===null?'uncertain':reading.current}; Min/Max uncertain because the extracted relationship failed MIN <= CURRENT <= MAX validation.`);
  const snapshotUncertainty=(graph.unreadableOrUncertain||[]).filter(item=>!unsupportedSnapshotClaim(item)&&!/(?:time scale|x-axis|horizontal scale).*(?:unreadable|relative|unknown)/i.test(item));
  const unreadableOrUncertain=dynamic?[...new Set([...(graph.unreadableOrUncertain||[]).filter(item=>!staticContradiction.test(item)&&!/temporal behavior (?:is )?(?:unreadable|unavailable)/i.test(item)),...rangeUncertainty,...(exactXAxisTimeScale==='UNREADABLE'?['Exact horizontal time scale is unreadable; relative trace behavior remains visible.']:[])])]:[...new Set([...snapshotUncertainty,...rangeUncertainty,hasDisplayedRanges?'Temporal behavior cannot be evaluated from this static PID snapshot; displayed minimum/maximum ranges are not chronological trace evidence.':'No reliable time-series information is available from this static PID snapshot.'])];
  const invalidRangeText=item=>invalidLabels.some(name=>new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace('Long FT #1','(?:Long FT #1|LTFT B1)').replace('Short FT #1','(?:Short FT #1|STFT B1)').replace('Engine Speed','(?:Engine Speed|RPM)'),'i').test(item))&&/\b(?:min(?:imum)?|max(?:imum)?|range)\b/i.test(item);
  const observed=(graph.observed||[]).map(normalizePidTerminology).filter(numericClaimValid).filter(item=>!invalidRangeText(item)).filter(item=>dynamic||!unsupportedSnapshotClaim(item)),valuesAndScales=(graph.valuesAndScales||[]).map(normalizePidTerminology).filter(numericClaimValid).filter(item=>!invalidRangeText(item)).filter(item=>dynamic||!unsupportedSnapshotClaim(item)),traceFindings=dynamic?modelTraceEvidence.filter(numericClaimValid):[];
  const finalInterpretation=[...new Set(interpretation)].filter(item=>!dynamic||!staticContradiction.test(item)).slice(0,16),contradictionPresent=dynamic&&finalInterpretation.some(item=>staticContradiction.test(item)),semanticConsistencyStatus=contradictionPresent?'FAIL':initialStaticContradiction?'RECONCILED':'PASS',freshResultVerification=contradictionPresent?'FAIL':'PASS';
  const numericValidation={signNormalization:'PASS',normalization:'PASS',currentMinMaxConsistency:invalidReadings.length?'FAIL':'PASS',invalidPidEvidence:invalidLabels,sourceStatus:invalidReadings.length?'SOURCE_ANALYZER_VALUES_INCONSISTENT':'PASS',zeroCrossingValidation:'PASS',directionalClaimValidation:'PASS',dependentInterpretationSuppressed:'PASS',diagnosticSignificanceGuard:'PASS',interpretationGuard:'PASS',conflicts:[...new Set(numericConflicts)],correction:numericConflicts.length?'PASS':'NOT_REQUIRED'};
  return {...graph,analysisMode,evidenceType,observed,valuesAndScales,traceFindings,interpretation:finalInterpretation,diagnosticSignificance:contradictionPresent||invalidReadings.length?'INDETERMINATE':dynamic||supportedCriterion?graph.diagnosticSignificance:'INDETERMINATE',diagnosticSignificanceReason:contradictionPresent?'PENDING_SEMANTIC_RECONCILIATION':invalidReadings.length?'PENDING_NUMERIC_VERIFICATION':'VALIDATED_EVIDENCE',numericEvidence,numericValidation,evidenceInventory,evidenceInventoryStatus:'PASS',semanticConsistencyStatus,freshResultVerification,unresolvedQuestion,nextTest:contradictionPresent?[]:nextTest,nextTestReason:contradictionPresent?'Withheld until classifier and interpretation evidence agree.':nextTestReason,redundantTestCheck:'PASS',candidateNextTestRejected:rejectedCandidates.length?'DUPLICATES ACTIVE EVIDENCE':'NONE',nextTestSelection:contradictionPresent?'WITHHELD':'PASS',unreadableOrUncertain,reasoningEvidence,contradictionGuard:contradictionPresent?'FAIL':'PASS'};
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
  semanticResult.componentIdentification = componentIdentification;
  semanticResult.automotiveGraphAnalysis = automotiveGraphAnalysis;
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
