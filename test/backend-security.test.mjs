import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import handler from '../api/semantic-image-analysis.mjs';
import { MAX_JSON_BYTES, publicError, resetRateLimitsForTests } from '../backend-http-security.mjs';
import { analyzeSemanticImage, normalizeSemanticConfidence, normalizeWiringField } from '../semantic-analyzer-core.mjs';

const ORIGIN = 'https://bibbs1994.github.io';
const drivetrain = (overrides = {}) => ({ applicable: false, candidateType: 'OTHER', engineConnection: 'UNKNOWN', transmissionConnection: 'UNKNOWN', longitudinalShafts: 'UNKNOWN', lateralAxleOutputs: 'UNKNOWN', axleTubes: 'UNKNOWN', location: 'UNKNOWN', powerFlowRole: 'UNKNOWN', distinguishingFeaturesComplete: false, evidence: [], competingCandidate: null, ...overrides });

test('semantic confidence normalization supports fractional, percentage, string, and missing values', () => {
  assert.equal(normalizeSemanticConfidence(0.95), 95);
  assert.equal(normalizeSemanticConfidence(95), 95);
  assert.equal(normalizeSemanticConfidence('0.95'), 95);
  assert.equal(normalizeSemanticConfidence('95%'), 95);
  assert.equal(normalizeSemanticConfidence(92.0), 92);
  assert.equal(normalizeSemanticConfidence(null), null);
  assert.equal(normalizeSemanticConfidence(undefined), null);
  assert.equal(normalizeSemanticConfidence(Number.NaN), null);
  assert.equal(normalizeSemanticConfidence('not provided'), null);
});

test('automotive graph classification continues into grounded diagnostic interpretation', async () => {
  const bytes=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]),body={transactionId:'graph-stage',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};let calls=0;
  const result=await analyzeSemanticImage(body,{apiKey:'test-only-placeholder',fetchImpl:async()=>{calls+=1;const payload=calls===1?{category:'AUTOMOTIVE_GRAPH',confidence:98,objects:['axes','two plotted traces'],evidence:['axes and scale markings are visible','two time-series traces are visible'],description:'Oxygen sensor diagnostic graph.',automotiveEvidence:[],graphEvidence:['axes with repeated scale markings','multiple plotted traces'],documentEvidence:[]}:{status:'PARTIAL',confidence:91,observed:['B1S1 and B1S2 labels are visible','The downstream trace switches with the upstream trace'],interpretation:['Displayed behavior may be consistent with reduced catalyst oxygen-storage activity, but the graph alone does not prove converter failure'],nextTest:['Verify fuel control and exhaust integrity, then repeat a warmed steady-state catalyst oxygen-storage test'],pidNames:['B1S1','B1S2'],sensorNames:['upstream oxygen sensor','downstream oxygen sensor'],valuesAndScales:[],traceFindings:['downstream trace follows upstream activity'],unreadableOrUncertain:['Voltage and time scales are not reliably readable'],visibleVehicle:{description:'',evidence:[]}};return{ok:true,status:200,async json(){return{output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]}}}}});
  assert.equal(calls,2);assert.equal(result.semanticResult.category,'AUTOMOTIVE_GRAPH');assert.equal(result.semanticResult.automotiveGraphAnalysis.status,'PARTIAL');assert.equal(result.semanticResult.automotiveGraphAnalysis.imageHash,body.imageHash);assert.match(result.semanticResult.automotiveGraphAnalysis.interpretation[0],/does not prove converter failure/);assert.match(result.semanticResult.automotiveGraphAnalysis.nextTest[0],/exhaust integrity/);
});

test('wiring fields normalize strings, arrays, object nodes, and wrapped collections', () => {
  const expectedKeys = ['component','terminal','wire','circuit','voltageExpected','description'];
  const cases = [
    ['Battery -> Fuse F12 -> Relay -> Load -> Ground', 5],
    [['Battery','Fuse F12','Relay'], 3],
    [[{ component: 'Battery', terminal: 'B+' }, { component: 'Relay', terminal: 87 }], 2],
    [{ steps: [{ component: 'Fuse F12' }, { component: 'Headlamp' }] }, 2]
  ];
  for (const [input,length] of cases) {
    const normalized = normalizeWiringField(input);
    assert.equal(normalized.length, length);
    normalized.forEach(node => assert.deepEqual(Object.keys(node), expectedKeys));
  }
  assert.deepEqual(normalizeWiringField({ unusable: true }), []);
});

function responseMock() {
  return {
    headers: {}, statusCode: 200, payload: undefined, ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { this.ended = true; return this; }
  };
}

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.10' },
    body: '{}',
    ...overrides
  };
}

test.beforeEach(() => resetRateLimitsForTests());

test('rejects malformed method', async () => {
  const response = responseMock();
  await handler(request({ method: 'GET' }), response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.payload.code, 'METHOD_NOT_ALLOWED');
});

test('accepts allowed-origin preflight only', async () => {
  const response = responseMock();
  await handler(request({ method: 'OPTIONS' }), response);
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(response.headers['access-control-allow-headers'], 'Content-Type, Cache-Control');
});

test('rejects an unexpected origin', async () => {
  const response = responseMock();
  await handler(request({ headers: { origin: 'https://example.invalid', 'content-type': 'application/json' } }), response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.code, 'ORIGIN_FORBIDDEN');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('rejects an oversized declared request', async () => {
  const response = responseMock();
  await handler(request({ headers: { origin: ORIGIN, 'content-type': 'application/json', 'content-length': String(MAX_JSON_BYTES + 1) } }), response);
  assert.equal(response.statusCode, 413);
  assert.equal(response.payload.code, 'REQUEST_TOO_LARGE');
});

test('rejects invalid JSON', async () => {
  const response = responseMock();
  await handler(request({ body: '{not-json' }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.code, 'INVALID_JSON');
});

test('rejects missing required fields before OpenAI transport', async () => {
  const response = responseMock();
  await handler(request({ body: JSON.stringify({ transactionId: 'case-1' }) }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.code, 'INVALID_REQUEST');
  assert.equal(response.payload.serverDiagnostic.requestReceived, true);
  assert.equal(response.payload.serverDiagnostic.openaiRequestAttempted, false);
});

test('rate limits repeated beta requests', async () => {
  let response;
  for (let index = 0; index < 13; index += 1) {
    response = responseMock();
    await handler(request({ body: '{}' }), response);
  }
  assert.equal(response.statusCode, 429);
  assert.equal(response.payload.code, 'RATE_LIMITED');
});

test('valid request reaches mocked server-side OpenAI path without secret disclosure', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const body = {
    transactionId: 'case-1',
    imageHash: createHash('sha256').update(bytes).digest('hex'),
    mimeType: 'image/png',
    imageBase64: bytes.toString('base64')
  };
  let calls = 0;
  const result = await analyzeSemanticImage(body, {
    apiKey: 'test-only-placeholder',
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.match(options.headers.Authorization, /^Bearer /);
      return {
        ok: true,
        status: 200,
        async json() {
          return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
            category: 'GENERAL_NON_AUTOMOTIVE_PHOTO', confidence: 0.95, objects: ['test object'], evidence: ['visible test evidence'],
            description: 'A test response.', automotiveEvidence: [], graphEvidence: [], documentEvidence: []
          }) }] }] };
        }
      };
    }
  });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes('test-only-placeholder'), false);
  assert.equal(result.serverDiagnostic.stage, 'K_SEMANTIC_OUTPUT_EXTRACTED');
  assert.equal(result.serverDiagnostic.openaiCredentialConfigured, true);
  assert.equal(result.serverDiagnostic.openaiRequestAttempted, true);
  assert.equal(result.serverDiagnostic.openaiResponseReceived, true);
  assert.equal(result.serverDiagnostic.openaiResponseOk, true);
  assert.equal(result.serverDiagnostic.openaiResponseParsed, true);
  assert.equal(result.serverDiagnostic.semanticOutputPresent, true);
  assert.equal(result.serverDiagnostic.payloadImageCount, 1);
  assert.equal(result.semanticResult.rawConfidence, 0.95);
  assert.equal(result.semanticResult.normalizedConfidence, 95);
  assert.equal(result.semanticResult.confidence, 95);
});

test('document category triggers a fresh pixel-bound repair-information extraction without reclassification',async()=>{
  const bytes=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]),body={transactionId:'doc-p0340',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};let calls=0;const originalInfo=console.info;console.info=()=>{};
  try{const result=await analyzeSemanticImage(body,{apiKey:'test-only-placeholder',fetchImpl:async(_url,options)=>{calls+=1;const requestBody=JSON.parse(options.body);assert.equal(requestBody.input[0].content.filter(item=>item.type==='input_image').length,1);const payload=calls===1?{category:'DOCUMENT_OR_TEXT_SCREENSHOT',confidence:98,objects:['service procedure text'],evidence:['visible document page with procedure text'],description:'OEM diagnostic procedure screenshot.',automotiveEvidence:[],graphEvidence:[],documentEvidence:['P0340 circuit test table is visible']}:{status:'COMPLETE',dtcApplicability:'APPLICABLE',dtcs:['P0340'],testName:'CMP Signal Circuit Continuity',componentOrCircuit:'CMP signal circuit',testLocation:'ECM terminal 45 to CMP connector terminal 3',method:'Key off, disconnect both connectors, measure resistance end to end',criterion:'1 ohm maximum',requestedResult:'Report measured resistance in ohms',comparator:'<=',minimum:null,maximum:1,visibleTextEvidence:['P0340','Measure resistance terminal 45 to terminal 3','1 ohm maximum'],missingRequiredFields:[]};return{ok:true,status:200,async json(){return{output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]}}}}});assert.equal(calls,2);assert.equal(result.semanticResult.category,'DOCUMENT_OR_TEXT_SCREENSHOT');assert.equal(result.semanticResult.componentIdentification,null);assert.equal(result.semanticResult.wiringDiagramAnalysis,null);assert.equal(result.semanticResult.documentRepairInformation.status,'COMPLETE');assert.deepEqual(result.semanticResult.documentRepairInformation.dtcs,['P0340']);assert.equal(result.semanticResult.documentRepairInformation.imageHash,body.imageHash);assert.equal(result.semanticResult.documentRepairInformation.semanticRequestId,body.transactionId);assert.equal(result.serverDiagnostic.documentExtractionAttempted,true);assert.equal(result.serverDiagnostic.documentExtractionResultPresent,true)}finally{console.info=originalInfo}
});

test('V6 NOT APPLICABLE is resolved and an empty visible DTC list does not make extraction incomplete',async()=>{
  const bytes=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]),body={transactionId:'doc-no-dtc',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};let calls=0;const originalInfo=console.info;console.info=()=>{};try{const result=await analyzeSemanticImage(body,{apiKey:'test-only-placeholder',fetchImpl:async()=>{calls+=1;const payload=calls===1?{category:'DOCUMENT_OR_TEXT_SCREENSHOT',confidence:98,objects:['service procedure text'],evidence:['visible diagnostic procedure'],description:'Diagnostic test document.',automotiveEvidence:[],graphEvidence:[],documentEvidence:['CMP test information is visible']}:{status:'COMPLETE',dtcApplicability:'NOT APPLICABLE',dtcs:[],testName:'CMP Circuit Test',componentOrCircuit:'CMP signal circuit',testLocation:'Connector terminal shown in document',method:'Measure the circuit as shown',criterion:'1 ohm maximum',requestedResult:'Report measured resistance',comparator:'<=',minimum:null,maximum:1,visibleTextEvidence:['CMP Circuit Test','1 ohm maximum'],missingRequiredFields:['DTC applicability']};return{ok:true,status:200,async json(){return{output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]}}}}});const extraction=result.semanticResult.documentRepairInformation;assert.equal(extraction.status,'COMPLETE');assert.equal(extraction.dtcApplicability,'NOT APPLICABLE');assert.deepEqual(extraction.dtcs,[]);assert.deepEqual(extraction.missingRequiredFields,[])}finally{console.info=originalInfo}
});

test('V7 rejects an unsupported criterion while preserving visibly extracted document fields',async()=>{
  const bytes=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]),body={transactionId:'doc-missing-criterion',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};let calls=0;const originalInfo=console.info;console.info=()=>{};
  try{const result=await analyzeSemanticImage(body,{apiKey:'test-only-placeholder',fetchImpl:async()=>{calls+=1;const payload=calls===1?{category:'DOCUMENT_OR_TEXT_SCREENSHOT',confidence:99,objects:['diagnostic test document'],evidence:['visible document text'],description:'Cam reference voltage test document.',automotiveEvidence:[],graphEvidence:[],documentEvidence:['Cam Reference Voltage Test is visible']}:{status:'COMPLETE',dtcApplicability:'NOT APPLICABLE',dtcs:[],testName:'Cam Reference Voltage Test',componentOrCircuit:'cam sensor',testLocation:'terminal 3',method:'measure voltage with key ON',criterion:'4.5-5.5 volts',criterionEvidence:'',requestedResult:'Report measured voltage',comparator:'range',minimum:4.5,maximum:5.5,visibleTextEvidence:['Test: Cam Reference Voltage Test','Component: cam sensor','Connector/terminal: terminal 3','Method: measure voltage with key ON'],missingRequiredFields:[]};return{ok:true,status:200,async json(){return{output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]}}}}});const extraction=result.semanticResult.documentRepairInformation;assert.equal(extraction.status,'INCOMPLETE');assert.equal(extraction.testName,'Cam Reference Voltage Test');assert.equal(extraction.componentOrCircuit,'cam sensor');assert.equal(extraction.testLocation,'terminal 3');assert.equal(extraction.method,'measure voltage with key ON');assert.equal(extraction.criterion,'');assert.equal(extraction.criterionEvidence,'');assert.equal(extraction.comparator,'');assert.equal(extraction.minimum,null);assert.equal(extraction.maximum,null);assert.deepEqual(extraction.missingRequiredFields,['criterion'])}finally{console.info=originalInfo}
});

test('automotive category triggers one fresh component request with independent confidence', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const body = { transactionId: 'sem-component', imageHash: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', imageBase64: bytes.toString('base64') };
  let calls = 0;
  const originalInfo = console.info;
  console.info = () => {};
  try {
    const result = await analyzeSemanticImage(body, {
      apiKey: 'test-only-placeholder',
      fetchImpl: async (_url, options) => {
        calls += 1;
        const request = JSON.parse(options.body);
        assert.equal(request.input[0].content.filter(item => item.type === 'input_image').length, 1);
        const payload = calls === 1
          ? { category: 'AUTOMOTIVE_COMPONENT_OR_VEHICLE', confidence: 0.99, objects: ['alternator', 'belt'], evidence: ['vented metal housing and pulley are visible'], description: 'Automotive charging component.', automotiveEvidence: ['engine-mounted vented housing with belt-driven pulley'], graphEvidence: [], documentEvidence: [] }
          : { status: 'IDENTIFIED', primaryComponent: 'Alternator', componentConfidence: 0.94, system: 'Charging system', secondaryComponents: ['serpentine belt', 'pulley'], supportingEvidence: ['vented aluminum housing', 'belt-driven pulley', 'electrical charging connection'], possibleAlternatives: [], uncertaintyReason: null, drivetrainDiscrimination: drivetrain() };
        return { ok: true, status: 200, async json() { return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] }; } };
      }
    });
    assert.equal(calls, 2);
    assert.equal(result.semanticResult.normalizedConfidence, 99);
    assert.equal(result.semanticResult.componentIdentification.primaryComponent, 'Alternator');
    assert.equal(result.semanticResult.componentIdentification.rawComponentConfidence, 0.94);
    assert.equal(result.semanticResult.componentIdentification.normalizedComponentConfidence, 94);
    assert.equal(result.semanticResult.componentIdentification.semanticRequestId, body.transactionId);
    assert.equal(result.semanticResult.componentIdentification.imageHash, body.imageHash);
    assert.notEqual(result.semanticResult.normalizedConfidence, result.semanticResult.componentIdentification.normalizedComponentConfidence);
    assert.equal(result.serverDiagnostic.componentIdentificationAttempted, true);
    assert.equal(result.serverDiagnostic.componentResultPresent, true);
  } finally { console.info = originalInfo; }
});

test('uncertain component response preserves alternatives instead of forcing an identification', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const body = { transactionId: 'sem-uncertain', imageHash: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', imageBase64: bytes.toString('base64') };
  let calls = 0;
  const originalInfo = console.info; console.info = () => {};
  try {
    const result = await analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl: async () => {
      calls += 1;
      const payload = calls === 1
        ? { category: 'AUTOMOTIVE_COMPONENT_OR_VEHICLE', confidence: 98, objects: ['housing', 'hose'], evidence: ['automotive housing and hose are visible'], description: 'Partial automotive component.', automotiveEvidence: ['automotive mounting and hose connection'], graphEvidence: [], documentEvidence: [] }
        : { status: 'UNCERTAIN', primaryComponent: 'Unable to determine exact component', componentConfidence: '0.41', system: 'Engine cooling', secondaryComponents: ['coolant hose'], supportingEvidence: ['partial cast housing and coolant hose'], possibleAlternatives: ['thermostat housing', 'coolant outlet housing'], uncertaintyReason: 'Only a partial component view is visible.', drivetrainDiscrimination: drivetrain() };
      return { ok: true, status: 200, async json() { return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] }; } };
    } });
    assert.equal(result.semanticResult.componentIdentification.status, 'UNCERTAIN');
    assert.equal(result.semanticResult.componentIdentification.normalizedComponentConfidence, 41);
    assert.deepEqual(result.semanticResult.componentIdentification.possibleAlternatives, ['thermostat housing', 'coolant outlet housing']);
    assert.match(result.semanticResult.componentIdentification.uncertaintyReason, /partial component view/i);
  } finally { console.info = originalInfo; }
});

test('drivetrain discrimination distinguishes four layouts and caps incomplete evidence', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const cases = [
    ['TRANSFER_CASE', 'Transfer Case', drivetrain({ applicable: true, candidateType: 'TRANSFER_CASE', transmissionConnection: 'VISIBLE', longitudinalShafts: 'MULTIPLE', lateralAxleOutputs: 'ABSENT', axleTubes: 'ABSENT', location: 'VEHICLE_CENTERLINE', powerFlowRole: 'TORQUE_DISTRIBUTION', distinguishingFeaturesComplete: true, evidence: ['separate housing behind transmission', 'multiple longitudinal driveline outputs'] })],
    ['DIFFERENTIAL', 'Differential', drivetrain({ applicable: true, candidateType: 'DIFFERENTIAL', longitudinalShafts: 'ONE', lateralAxleOutputs: 'PRESENT', axleTubes: 'PRESENT', location: 'AXLE_POSITION', powerFlowRole: 'FINAL_DRIVE', distinguishingFeaturesComplete: true, evidence: ['lateral axle outputs toward wheels', 'driveshaft terminates at pinion input'] })],
    ['TRANSMISSION', 'Transmission', drivetrain({ applicable: true, candidateType: 'TRANSMISSION', engineConnection: 'VISIBLE', transmissionConnection: 'NOT_VISIBLE', longitudinalShafts: 'ONE', lateralAxleOutputs: 'ABSENT', axleTubes: 'ABSENT', location: 'ENGINE_ATTACHED', powerFlowRole: 'PRIMARY_GEARBOX', distinguishingFeaturesComplete: true, evidence: ['bellhousing attached to engine', 'main gearbox case extends rearward'] })],
    ['TRANSAXLE', 'Transaxle', drivetrain({ applicable: true, candidateType: 'TRANSAXLE', engineConnection: 'VISIBLE', longitudinalShafts: 'NONE', lateralAxleOutputs: 'PRESENT', axleTubes: 'ABSENT', location: 'TRANSVERSE_DRIVETRAIN', powerFlowRole: 'INTEGRATED_GEARBOX_FINAL_DRIVE', distinguishingFeaturesComplete: true, evidence: ['integrated transverse gearbox and final drive', 'lateral CV outputs leave housing'] })]
  ];
  const originalInfo = console.info; console.info = () => {};
  try {
    for (const [candidateType, primaryComponent, discrimination] of cases) {
      let calls = 0;
      const body = { transactionId: `sem-${candidateType.toLowerCase()}`, imageHash: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', imageBase64: bytes.toString('base64') };
      const result = await analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl: async () => {
        calls += 1;
        const payload = calls === 1
          ? { category: 'AUTOMOTIVE_COMPONENT_OR_VEHICLE', confidence: 99, objects: ['drivetrain housing'], evidence: ['vehicle drivetrain assembly is visible'], description: 'Under-vehicle drivetrain component.', automotiveEvidence: ['drivetrain housing and shaft connections'], graphEvidence: [], documentEvidence: [] }
          : { status: 'IDENTIFIED', primaryComponent, componentConfidence: 97, system: 'Drivetrain', secondaryComponents: ['driveshaft'], supportingEvidence: discrimination.evidence, possibleAlternatives: [], uncertaintyReason: null, drivetrainDiscrimination: discrimination };
        return { ok: true, status: 200, async json() { return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] }; } };
      } });
      assert.equal(result.semanticResult.componentIdentification.primaryComponent, primaryComponent);
      assert.equal(result.semanticResult.componentIdentification.drivetrainDiscrimination.candidateType, candidateType);
      assert.equal(result.semanticResult.componentIdentification.normalizedComponentConfidence, 97);
    }
    let calls = 0;
    const ambiguousBody = { transactionId: 'sem-ambiguous-drivetrain', imageHash: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', imageBase64: bytes.toString('base64') };
    const ambiguous = await analyzeSemanticImage(ambiguousBody, { apiKey: 'test-only-placeholder', fetchImpl: async () => {
      calls += 1;
      const payload = calls === 1
        ? { category: 'AUTOMOTIVE_COMPONENT_OR_VEHICLE', confidence: 99, objects: ['drivetrain housing'], evidence: ['under-vehicle drivetrain housing'], description: 'Ambiguous drivetrain view.', automotiveEvidence: ['housing and driveshaft'], graphEvidence: [], documentEvidence: [] }
        : { status: 'UNCERTAIN', primaryComponent: 'Transfer Case', componentConfidence: 95, system: 'Drivetrain', secondaryComponents: ['driveshaft'], supportingEvidence: ['centerline housing with driveshaft'], possibleAlternatives: ['Differential'], uncertaintyReason: 'Lateral outputs and the transmission connection are not visible.', drivetrainDiscrimination: drivetrain({ applicable: true, candidateType: 'TRANSFER_CASE', location: 'VEHICLE_CENTERLINE', longitudinalShafts: 'ONE', powerFlowRole: 'UNKNOWN', distinguishingFeaturesComplete: false, evidence: ['centerline housing and one driveshaft are visible'], competingCandidate: 'Differential' }) };
      return { ok: true, status: 200, async json() { return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] }; } };
    } });
    assert.equal(ambiguous.semanticResult.componentIdentification.normalizedComponentConfidence, 84);
    assert.deepEqual(ambiguous.semanticResult.componentIdentification.possibleAlternatives, ['Differential']);
  } finally { console.info = originalInfo; }
});

test('wiring diagram category triggers structured circuit analysis without component identification', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const body = { transactionId: 'sem-wiring', imageHash: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', imageBase64: bytes.toString('base64') };
  let calls = 0; const originalInfo = console.info; console.info = () => {};
  try {
    const result = await analyzeSemanticImage(body, { apiKey: 'test-only-placeholder', fetchImpl: async () => {
      calls += 1;
      const payload = calls === 1
        ? { category: 'AUTOMOTIVE_WIRING_DIAGRAM', confidence: 0.98, objects: ['fuse', 'relay', 'motor', 'ground'], evidence: ['connected electrical circuit paths', 'fuse, relay, load, and ground schematic symbols'], description: 'Automotive motor control schematic.', automotiveEvidence: [], graphEvidence: [], documentEvidence: ['schematic connector and terminal labels'] }
        : { status: 'READY', circuitComponent: 'Cooling fan motor', confidence: 0.94, structuralEvidence: ['connected power and ground circuit paths', 'fuse, relay coil/contact, motor, and ground symbols'], detectedComponents: ['battery feed', 'fuse F1', 'relay R1', 'cooling fan motor', 'ground G1'], connectorsAndPins: ['Motor connector pin 1', 'Motor connector pin 2'], circuitPaths: [{ label: 'Circuit path 1', path: 'battery feed → F1 → R1 → motor pin 1', function: 'Switched motor supply', functionConfirmed: true }, { label: 'Circuit path 2', path: 'motor pin 2 → G1', function: 'Motor ground', functionConfirmed: true }], fuses: ['F1'], relays: ['R1'], splices: [], wireDetails: ['Not reliably readable from supplied diagram.'], importantObservations: ['relay switches motor power'], unreadableFields: ['wire colors not reliably readable from supplied diagram'], safetyWarning: null, testPlan: [
          { id: 'power', objective: 'Verify motor power feed', tool: 'DVOM', instructions: 'Backprobe motor power with connector plugged in and fan commanded on.', redLead: 'motor connector pin 1', blackLead: 'battery negative', connectorCondition: 'plugged in', operatingCondition: 'key ON, fan commanded ON', loaded: true, expectedBehavior: 'system voltage while commanded', evaluationType: 'POWER_PRESENT', expectedMin: 11, expectedMax: 15, specificationSource: 'ELECTRICAL_PRINCIPLE', nextOnPass: 1, nextOnFail: null, passConclusion: 'CONTINUE', failConclusion: 'VERIFIED_POWER_SUPPLY_FAULT' },
          { id: 'ground', objective: 'Verify loaded motor ground', tool: 'DVOM', instructions: 'Measure ground-side voltage drop while the fan is commanded on.', redLead: 'motor ground pin', blackLead: 'battery negative', connectorCondition: 'plugged in', operatingCondition: 'key ON, fan commanded ON', loaded: true, expectedBehavior: 'low voltage drop', evaluationType: 'VOLTAGE_DROP_LOW', expectedMin: null, expectedMax: null, specificationSource: 'NONE', nextOnPass: null, nextOnFail: null, passConclusion: 'COMPONENT_PASSES_CURRENT_TESTS', failConclusion: 'VERIFIED_GROUND_FAULT' }
        ] };
      return { ok: true, status: 200, async json() { return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] }; } };
    } });
    assert.equal(calls, 2);
    assert.equal(result.semanticResult.category, 'AUTOMOTIVE_WIRING_DIAGRAM');
    assert.equal(result.semanticResult.componentIdentification, null);
    assert.equal(result.semanticResult.wiringDiagramAnalysis.circuitComponent, 'Cooling fan motor');
    assert.equal(result.semanticResult.wiringDiagramAnalysis.testPlan.length, 2);
    assert.equal(result.semanticResult.wiringDiagramAnalysis.circuitPaths.length, 2);
    assert.equal(result.semanticResult.wiringDiagramAnalysis.imageHash, body.imageHash);
    assert.equal(result.serverDiagnostic.wiringDiagramResultPresent, true);
  } finally { console.info = originalInfo; }
});

test('raw upstream errors are sanitized', () => {
  const failure = publicError(Object.assign(new Error('internal upstream detail'), { statusCode: 502 }));
  assert.deepEqual(failure, { status: 502, body: { error: 'Image analysis is temporarily unavailable.', code: 'ANALYSIS_UNAVAILABLE' } });
});

test('transport diagnostics redact secrets and image data', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const body = {
    transactionId: 'diagnostic-transport',
    imageHash: createHash('sha256').update(bytes).digest('hex'),
    mimeType: 'image/png',
    imageBase64: bytes.toString('base64')
  };
  const secret = 'sk-proj-test-secret-value';
  const encodedData = 'A'.repeat(96);
  const failure = Object.assign(new Error(`Bearer ${secret} data:image/png;base64,${encodedData}`), {
    code: 'UND_ERR_CONNECT_TIMEOUT',
    cause: Object.assign(new Error(`OPENAI_API_KEY=${secret}`), { code: 'ETIMEDOUT' })
  });
  const calls = [];
  const originalError = console.error;
  console.error = (...args) => calls.push(args);
  try {
    await assert.rejects(analyzeSemanticImage(body, {
      apiKey: secret,
      fetchImpl: async () => { throw failure; }
    }), error => error === failure);
  } finally {
    console.error = originalError;
  }
  assert.equal(calls.length, 1);
  const [label, fields] = calls[0];
  assert.equal(label, 'OpenAI transport failure');
  assert.deepEqual(Object.keys(fields), ['errorName', 'errorMessage', 'errorCode', 'causeName', 'causeCode', 'causeMessage', 'elapsedMs', 'responseReceived']);
  assert.equal(fields.responseReceived, false);
  assert.equal(typeof fields.elapsedMs, 'number');
  const logged = JSON.stringify(calls);
  assert.equal(logged.includes(secret), false);
  assert.equal(logged.includes(encodedData), false);
  assert.equal(logged.includes(body.imageBase64), false);
});

test('HTTP response diagnostics log only status and sanitized OpenAI error identifiers', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const body = {
    transactionId: 'diagnostic-http',
    imageHash: createHash('sha256').update(bytes).digest('hex'),
    mimeType: 'image/png',
    imageBase64: bytes.toString('base64')
  };
  const secret = 'sk-proj-upstream-secret';
  const calls = [];
  const originalInfo = console.info;
  console.info = (...args) => calls.push(args);
  try {
    await assert.rejects(analyzeSemanticImage(body, {
      apiKey: secret,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        async json() { return { error: { type: 'invalid_request_error', code: 'invalid_api_key', message: `Never log ${secret}` } }; }
      })
    }));
  } finally {
    console.info = originalInfo;
  }
  assert.deepEqual(calls, [['OpenAI upstream response', {
    upstreamStatus: 401,
    errorType: 'invalid_request_error',
    errorCode: 'invalid_api_key'
  }]]);
  assert.equal(JSON.stringify(calls).includes(secret), false);
});

test('OpenAI timeout is explicit and preserves a safe server diagnostic', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const body = {
    transactionId: 'sem-timeout',
    imageHash: createHash('sha256').update(bytes).digest('hex'),
    mimeType: 'image/png',
    imageBase64: bytes.toString('base64')
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(analyzeSemanticImage(body, {
      apiKey: 'test-only-placeholder',
      timeoutMs: 1,
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
    }), error => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.serverDiagnostic.stage, 'H_OPENAI_API_CONTACTED');
      assert.equal(error.serverDiagnostic.errorCategory, 'OPENAI_TIMEOUT');
      assert.equal(error.serverDiagnostic.errorMessage, 'Semantic analysis timeout.');
      assert.equal(error.serverDiagnostic.openaiResponseReceived, false);
      return true;
    });
  } finally {
    console.error = originalError;
  }
});

test('OpenAI HTTP failures expose only sanitized category, status, type, and code', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const body = {
    transactionId: 'sem-auth',
    imageHash: createHash('sha256').update(bytes).digest('hex'),
    mimeType: 'image/png',
    imageBase64: bytes.toString('base64')
  };
  const originalInfo = console.info;
  console.info = () => {};
  try {
    await assert.rejects(analyzeSemanticImage(body, {
      apiKey: 'test-only-placeholder',
      fetchImpl: async () => ({ ok: false, status: 401, async json() { return { error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Authentication failed.' } }; } })
    }), error => {
      const diagnostic = error.serverDiagnostic;
      assert.equal(diagnostic.errorCategory, 'AUTHENTICATION');
      assert.equal(diagnostic.openaiHttpStatus, 401);
      assert.equal(diagnostic.errorType, 'invalid_request_error');
      assert.equal(diagnostic.errorCode, 'invalid_api_key');
      assert.equal(JSON.stringify(diagnostic).includes('test-only-placeholder'), false);
      return true;
    });
  } finally {
    console.info = originalInfo;
  }
});
