import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import handler from '../api/semantic-image-analysis.mjs';
import { MAX_JSON_BYTES, publicError, resetRateLimitsForTests } from '../backend-http-security.mjs';
import { analyzeSemanticImage, correctAutomotiveGraphReasoning, normalizeSemanticConfidence, normalizeWiringField } from '../semantic-analyzer-core.mjs';

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
  const result=await analyzeSemanticImage(body,{apiKey:'test-only-placeholder',fetchImpl:async()=>{calls+=1;const payload=calls===1?{category:'AUTOMOTIVE_GRAPH',confidence:98,objects:['axes','two plotted traces'],evidence:['axes and scale markings are visible','two time-series traces are visible'],description:'Oxygen sensor diagnostic graph.',automotiveEvidence:[],graphEvidence:['axes with repeated scale markings','multiple plotted traces'],documentEvidence:[]}:{status:'PARTIAL',confidence:91,observed:['B1S1 and B1S2 labels are visible','The downstream trace switches with the upstream trace'],interpretation:['Displayed behavior may be consistent with reduced catalyst oxygen-storage activity, but the graph alone does not prove converter failure'],diagnosticSignificance:'INCONCLUSIVE',nextTest:['Verify fuel control and exhaust integrity, then repeat a warmed steady-state catalyst oxygen-storage test'],pidNames:['B1S1','B1S2'],sensorNames:['upstream oxygen sensor','downstream oxygen sensor'],valuesAndScales:[],traceFindings:['downstream trace switches with upstream activity'],unreadableOrUncertain:['Voltage and time scales are not reliably readable'],visibleVehicle:{description:'',evidence:[]}};return{ok:true,status:200,async json(){return{output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]}}}}});
  assert.equal(calls,2);assert.equal(result.semanticResult.category,'AUTOMOTIVE_GRAPH');assert.equal(result.semanticResult.automotiveGraphAnalysis.status,'PARTIAL');assert.equal(result.semanticResult.automotiveGraphAnalysis.imageHash,body.imageHash);assert.match(result.semanticResult.automotiveGraphAnalysis.interpretation[0],/does not prove converter failure/);assert.match(result.semanticResult.automotiveGraphAnalysis.nextTest[0],/exhaust integrity/);
});

test('10.12.11 validation case corrects O2, A/F, trim, operating-state, snapshot, and catalyst reasoning',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:96,observed:['AFS B1S1 3.298 V','LTFT B1 -6.249%','STFT B1 -2.342%','O2S B1S2 0.875 V','Engine speed 777 RPM','Coolant 186°F'],interpretation:['O2 voltage is low and lean.','AFS B1S1 is good with no irregularities.','Negative trims suggest a vacuum leak.'],diagnosticSignificance:'NORMAL_OR_EXPECTED',nextTest:['Inspect for a vacuum leak.'],pidNames:['AFS B1S1','LTFT B1','STFT B1','O2S B1S2'],sensorNames:['Air Fuel Ratio Sensor','downstream oxygen sensor'],valuesAndScales:['AFS B1S1 3.298 V','LTFT B1 -6.249%','STFT B1 -2.342%','O2S B1S2 0.875 V','Engine speed 777 RPM','Coolant 186°F'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'2015 Toyota RAV4',evidence:['vehicle header']}});
  const text=corrected.interpretation.join(' ');assert.equal(corrected.reasoningEvidence.combinedTrim,-8.591);assert.equal(corrected.reasoningEvidence.fuelTrimPolarity,'NEGATIVE_PCM_REMOVING_FUEL');assert.equal(corrected.reasoningEvidence.operatingState,'WARM_NEAR_IDLE');assert.equal(corrected.reasoningEvidence.dynamicTraceEvidenceAvailable,false);assert.equal(corrected.analysisMode,'PID_SNAPSHOT');assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.match(text,/high current voltage reading/);assert.match(text,/approximately 8\.6% fuel removal/);assert.match(text,/one value cannot verify sensor performance/i);assert.match(text,/Insufficient dynamic graph evidence/);assert.doesNotMatch(text,/rich side|low and lean|vacuum leak|sensor is good|no irregularities/i);assert.match(corrected.nextTest[0],/upstream A\/F sensor and downstream O2 sensor data simultaneously/i);
});

test('10.12.13 static snapshot guard removes temporal inference and defaults significance to indeterminate',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:95,observed:['LTFT B1 -6.249%','STFT B1 +0.781%','AFS B1S1 3.249 V','O2S B1S2 0.055 V','Engine speed 905 RPM'],interpretation:['B1S2 shows minimal activity and is stable.','The sensor is biased low and not switching.','Fuel trim behavior is mildly abnormal.'],diagnosticSignificance:'MILDLY_ABNORMAL',nextTest:['Replace the downstream sensor.'],pidNames:['LTFT B1','STFT B1','AFS B1S1','O2S B1S2','Engine speed'],sensorNames:['Air Fuel Ratio Sensor','downstream O2 sensor'],valuesAndScales:['LTFT B1 -6.249%','STFT B1 +0.781%','AFS B1S1 3.249 V','O2S B1S2 0.055 V','Engine speed 905 RPM'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});
  const text=corrected.interpretation.join(' ');assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.equal(corrected.reasoningEvidence.dynamicTraceEvidenceAvailable,false);assert.equal(corrected.reasoningEvidence.temporalEvidenceSource,'STATIC_SNAPSHOT_ONLY');assert.match(text,/O2S B1S2 is currently 0\.055 V/);assert.match(text,/snapshot\/range evidence is insufficient to determine mixture state, sensor switching behavior, sensor health, or catalyst efficiency/i);assert.doesNotMatch(text,/minimal activity|stable|unstable|responding|stuck|biased|trending|fluctuating|mildly abnormal/i);assert.match(corrected.nextTest[0],/simultaneously in closed loop over time/);assert.match(corrected.unreadableOrUncertain.join(' '),/No reliable time-series information is available from this static PID snapshot/);
});

test('10.12.15 keeps current values separate from displayed ranges without inventing time behavior',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:97,observed:['Long FT #1 range: -6.249% to +5.467%','Current Long FT #1: -6.249%','Short FT #1 range: -2.342% to +3.125%','Current Short FT #1: +0.781%','O2S B1S2 current = 0.055 V'],interpretation:['Negative long-term fuel trims suggest the PCM is removing fuel.','B1S2 switching rate is slow.'],diagnosticSignificance:'SIGNIFICANT',nextTest:[],pidNames:['Long FT #1','Short FT #1','O2S B1S2'],sensorNames:['downstream O2 sensor'],valuesAndScales:['Long FT #1 range: -6.249% to +5.467%','Current Long FT #1: -6.249%','O2S B1S2 current = 0.055 V'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});
  const text=corrected.interpretation.join(' ');assert.equal(corrected.analysisMode,'PID_SNAPSHOT');assert.equal(corrected.reasoningEvidence.displayedRangesAvailable,true);assert.equal(corrected.reasoningEvidence.dynamicTraceEvidenceAvailable,false);assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.match(text,/Current Long FT #1 is -6\.249%/);assert.match(text,/range extends from -6\.249% to \+5\.467%/);assert.match(text,/does not support characterizing the entire capture as consistently negative/);assert.match(text,/O2S B1S2 is currently 0\.055 V/);assert.doesNotMatch(text,/currently 0(?:\.0+)? V\b|switching rate is/i);assert.match(text,/current PID values and displayed Min\/Max range information/i);assert.match(text,/switching rate, oscillation, response time, correlation/);assert.match(corrected.unreadableOrUncertain.join(' '),/minimum\/maximum ranges are not chronological trace evidence/i);
});

test('10.12.16 treats separate Current, Min, and Max fields as range metadata rather than time series',()=>{
  const fields=['Long FT #1 Current: -6.249%','Long FT #1 Min: -6.249%','Long FT #1 Max: -5.467%','Short FT #1 Current: +0.781%','Short FT #1 Min: -2.342%','Short FT #1 Max: +1.563%','AFS Voltage B1S1 Current: 3.249 V','AFS Voltage B1S1 Min: 3.191 V','AFS Voltage B1S1 Max: 3.303 V','O2S B1S2 Current: 0.055 V','O2S B1S2 Min: 0.000 V','O2S B1S2 Max: 0.055 V','Engine Speed Current: 905 RPM','Engine Speed Min: 899 RPM','Engine Speed Max: 994 RPM'];
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:fields,interpretation:['B1S2 rose from 0.000 V to 0.055 V and is switching slowly.'],diagnosticSignificance:'SIGNIFICANT',nextTest:[],pidNames:['Long FT #1','Short FT #1','AFS Voltage B1S1','O2S B1S2','Engine Speed'],sensorNames:['upstream A/F sensor','downstream O2 sensor'],valuesAndScales:fields,traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});
  const text=corrected.interpretation.join(' ');assert.equal(corrected.reasoningEvidence.combinedTrim,-5.468);assert.equal(corrected.reasoningEvidence.dynamicTraceEvidenceAvailable,false);assert.equal(corrected.reasoningEvidence.displayedRangesAvailable,true);assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.match(text,/combined Bank 1 fuel trim is approximately -5\.468%/);assert.match(text,/O2S B1S2 is currently 0\.055 V, with a displayed range of 0\.000–0\.055 V/);assert.match(text,/no sufficiently resolved time-series trace is available/i);assert.doesNotMatch(text,/rose from|switching slowly|switching frequency|response rate/i);assert.match(text,/do not provide chronological direction/i);
});

test('10.12.17 plotted trace evidence overrides contradictory static-snapshot language',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['Multiple independent graph panels with axes and gridlines','Plotted traces visible across each horizontal graph panel'],interpretation:['Only instantaneous PID readings are available; no time-based behavior can be determined from this static snapshot.','The downstream trace remains generally flat across the captured interval.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:['Acquire readable time scale if exact switching frequency is required.'],pidNames:['AFS B1S1','O2S B1S2'],sensorNames:['upstream A/F sensor','downstream O2 sensor'],valuesAndScales:['Exact X-axis time scale unreadable'],traceFindings:['sequential plotted points and horizontal trace history are visible','downstream trace remains generally flat'],unreadableOrUncertain:['Exact horizontal time scale is unreadable.','Temporal behavior is unavailable.'],visibleVehicle:{description:'',evidence:[]}});
  const text=corrected.interpretation.join(' '),uncertain=corrected.unreadableOrUncertain.join(' ');assert.equal(corrected.analysisMode,'TEMPORAL_GRAPH');assert.equal(corrected.reasoningEvidence.pidPresentationType,'TIME_SERIES_GRAPH');assert.equal(corrected.reasoningEvidence.traceEvidence,'DETECTED');assert.equal(corrected.reasoningEvidence.exactXAxisTimeScale,'UNREADABLE');assert.equal(corrected.reasoningEvidence.temporalBehavior,'PARTIALLY_READABLE');assert.equal(corrected.contradictionGuard,'PASS');assert.match(text,/downstream trace remains generally flat/i);assert.match(text,/relative signal behavior across the captured interval are visible/i);assert.doesNotMatch(text,/only instantaneous|static snapshot|no time-based behavior/i);assert.match(uncertain,/Exact horizontal time scale is unreadable/i);assert.doesNotMatch(uncertain,/Temporal behavior is unavailable/i);
});

test('classification graph evidence survives the dedicated analysis handoff',async()=>{
  const bytes=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01]),body={transactionId:'trace-handoff',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};let calls=0;
  const result=await analyzeSemanticImage(body,{apiKey:'test-only-placeholder',fetchImpl:async()=>{calls+=1;const payload=calls===1?{category:'AUTOMOTIVE_GRAPH',confidence:98,objects:['graph panels','axes'],evidence:['multiple graphs visible'],description:'PID graph screen',automotiveEvidence:[],graphEvidence:['plotted traces visible across horizontal graph panels','sequential plotted points'],documentEvidence:[]}:{status:'PARTIAL',confidence:90,observed:['Current PID values are readable'],interpretation:['Only instantaneous PID readings are available; no time-based behavior can be determined from this static snapshot.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['RPM'],sensorNames:[],valuesAndScales:[],traceFindings:[],unreadableOrUncertain:['Exact horizontal time scale is unreadable'],visibleVehicle:{description:'',evidence:[]}};return{ok:true,status:200,async json(){return{output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]}}}}});
  const graph=result.semanticResult.automotiveGraphAnalysis;assert.equal(calls,2);assert.equal(graph.analysisMode,'TEMPORAL_GRAPH');assert.equal(graph.reasoningEvidence.traceEvidence,'DETECTED');assert.equal(graph.contradictionGuard,'PASS');assert.doesNotMatch(graph.interpretation.join(' '),/only instantaneous|static snapshot/i);
  assert.doesNotMatch(graph.observed.join(' '),/Classifier graph evidence/i);
});

test('10.12.18 snapshot statistics cannot independently authorize temporal claims',()=>{
  const fields=['Engine Speed Current: 912 RPM','Engine Speed Min: 912 RPM','Engine Speed Max: 994 RPM','Long FT #1 Current: -6.249%','Long FT #1 Min: -6.249%','Long FT #1 Max: -5.467%','O2S B1S2 Current: 0.016 V','O2S B1S2 Min: 0.000 V','O2S B1S2 Max: 0.035 V'];
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:97,observed:fields,interpretation:['Engine Speed decreases over time.','Long-term fuel trim trends upward.','O2S B1S2 remains low over time and switches slowly.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Engine Speed','Long FT #1','O2S B1S2'],sensorNames:['downstream O2 sensor'],valuesAndScales:fields,traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});
  const text=corrected.interpretation.join(' ');assert.equal(corrected.analysisMode,'PID_SNAPSHOT');assert.equal(corrected.reasoningEvidence.snapshotStatisticalEvidence,'CURRENT_MIN_MAX');assert.equal(corrected.reasoningEvidence.visibleTraceEvidence,'ABSENT');assert.match(text,/Engine Speed is currently 912 RPM, with a displayed captured range of 912–994 RPM/);assert.match(text,/displayed range extends from -6\.249% to -5\.467%/);assert.match(text,/O2S B1S2 is currently 0\.016 V, with a displayed range of 0\.000–0\.035 V/);assert.doesNotMatch(text,/decreases over time|trends upward|remains low over time|switches slowly/i);
});

test('10.12.18 permits a temporal direction only with matching ordered trace evidence',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:97,observed:['Engine Speed Current: 912 RPM','Engine Speed Min: 912 RPM','Engine Speed Max: 994 RPM'],interpretation:['Trace-derived observation: Engine Speed trends downward across the visible plotted interval.','O2S B1S2 switches across the interval.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Engine Speed'],sensorNames:[],valuesAndScales:[],traceFindings:['Engine Speed plotted trace trends downward across the visible interval'],classifierGraphEvidence:['plotted traces visible across horizontal graph panels'],unreadableOrUncertain:['Exact horizontal time scale is unreadable'],visibleVehicle:{description:'',evidence:[]}});
  const text=corrected.interpretation.join(' ');assert.equal(corrected.analysisMode,'TEMPORAL_GRAPH');assert.match(text,/Trace-derived observation: Engine Speed trends downward/);assert.doesNotMatch(text,/O2S B1S2 switches/);assert.equal(corrected.reasoningEvidence.temporalClaimEvidenceGate,'APPLIED');
});

test('10.12.27 visible traces establish relative temporal data without absolute timing claims',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:97,observed:['Visible PID graph panels with plotted traces across a horizontal axis'],interpretation:['Only instantaneous PID readings are available.','Trace-derived observation: O2S B1S2 remains generally flat across the visible interval.'],diagnosticSignificance:'MILDLY_ABNORMAL',nextTest:['Capture these PID signals over time.','Perform a commanded rich/lean response test while graphing both sensors.'],pidNames:['AFS B1S1','O2S B1S2'],sensorNames:[],valuesAndScales:[],traceFindings:['O2S B1S2 plotted trace remains generally flat across the visible interval'],classifierGraphEvidence:['multiple plotted points across horizontal graph panels'],unreadableOrUncertain:['Exact X-axis time scale is unreadable'],visibleVehicle:{description:'',evidence:[]}});
  assert.equal(corrected.analysisMode,'TEMPORAL_GRAPH');assert.equal(corrected.reasoningEvidence.temporalDataAvailability,'RELATIVE_TEMPORAL_DATA_AVAILABLE');assert.equal(corrected.diagnosticSignificance,'MILDLY_ABNORMAL');assert.doesNotMatch(corrected.interpretation.join(' '),/only instantaneous|static snapshot/i);assert.doesNotMatch(corrected.nextTest.join(' '),/capture these PID signals over time/i);assert.match(corrected.nextTest.join(' '),/commanded rich\/lean/i);
});

test('10.12.27 invalid Current Min Max OCR is quarantined without swapping values',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:93,observed:['Long FT #1 Current: 6.249%','Long FT #1 Min: 6.249%','Long FT #1 Max: 5.467%','Plotted traces visible across a horizontal axis'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Long FT #1'],sensorNames:[],valuesAndScales:['Long FT #1 Current: 6.249%','Long FT #1 Min: 6.249%','Long FT #1 Max: 5.467%'],traceFindings:['Long FT #1 plotted trace varies across the visible interval'],unreadableOrUncertain:['Exact horizontal time scale is unreadable'],visibleVehicle:{description:'',evidence:[]}});
  assert.equal(corrected.reasoningEvidence.rangeValidation,'UNCERTAIN_VALUES_REMOVED');assert.equal(corrected.reasoningEvidence.temporalDataAvailability,'RELATIVE_TEMPORAL_DATA_AVAILABLE');assert.doesNotMatch(corrected.observed.join(' '),/Min: 6\.249|Max: 5\.467/);assert.doesNotMatch(corrected.valuesAndScales.join(' '),/Min: 6\.249|Max: 5\.467/);assert.match(corrected.unreadableOrUncertain.join(' '),/Min\/Max uncertain.*MIN <= CURRENT <= MAX/i);
});

test('10.12.29 snapshot routing removes downstream temporal prose from every displayed section',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:96,observed:['Short FT #1 Current: 0.781%','Short FT #1 demonstrates significant fluctuations, peaking at 0.781','Engine Speed Current: 905 RPM','Engine Speed shows minor fluctuations'],interpretation:['Trace-derived observation: the downstream O2 remained low.','The oxygen sensor is not switching.'],diagnosticSignificance:'MILDLY_ABNORMAL',nextTest:[],pidNames:['Short FT #1','Engine Speed','O2S B1S2'],sensorNames:['downstream O2 sensor'],valuesAndScales:['O2S B1S2 Current: 0.055 V'],traceFindings:[],unreadableOrUncertain:['Time scale units are unreadable; consider time relative'],visibleVehicle:{description:'',evidence:[]}});
  const displayed=[...corrected.observed,...corrected.valuesAndScales,...corrected.traceFindings,...corrected.interpretation,...corrected.unreadableOrUncertain].join(' ');
  assert.equal(corrected.analysisMode,'PID_SNAPSHOT');assert.equal(corrected.reasoningEvidence.temporalRoutingDecision,'SNAPSHOT');assert.equal(corrected.reasoningEvidence.temporalInterpretationPermissions,'STATIC VALUES ONLY');assert.equal(corrected.reasoningEvidence.temporalClaimValidation,'PASS');assert.equal(corrected.reasoningEvidence.temporalClaimConflictDetected,'CORRECTED');assert.doesNotMatch(displayed,/fluctuat|peaking|trace-derived|remained low|not switching|consider time relative/i);assert.match(displayed,/Short FT #1 Current: 0\.781%/);assert.match(displayed,/O2S B1S2 is currently 0\.055 V/);assert.match(displayed,/static PID snapshot/i);assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.match(corrected.nextTest[0],/simultaneously in closed loop over time/i);
});

test('10.12.29 genuine plotted history retains supported temporal interpretation',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['Multiple sequential samples are plotted across a horizontal graph axis'],interpretation:['Trace-derived observation: Engine Speed trends downward across the visible interval.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:['Verify closed-loop status during the capture.'],pidNames:['Engine Speed'],sensorNames:[],valuesAndScales:[],traceFindings:['Engine Speed plotted trace trends downward across the visible interval'],classifierGraphEvidence:['plotted traces visible across horizontal graph panels'],unreadableOrUncertain:['Exact time scale is unreadable'],visibleVehicle:{description:'',evidence:[]}});
  assert.equal(corrected.analysisMode,'TEMPORAL_GRAPH');assert.equal(corrected.reasoningEvidence.temporalRoutingDecision,'TIME SERIES');assert.equal(corrected.reasoningEvidence.temporalInterpretationPermissions,'ENABLED');assert.match(corrected.interpretation.join(' '),/trends downward/);assert.match(corrected.traceFindings.join(' '),/trends downward/);
});

test('10.12.14 distinguishes PID snapshots from temporal graphs without lean/rich snapshot inference',()=>{
  const base={status:'PARTIAL',confidence:95,observed:['O2S B1S2 0.016 V'],interpretation:['The snapshot is lean.'],diagnosticSignificance:'MILDLY_ABNORMAL',nextTest:[],pidNames:['O2S B1S2'],sensorNames:['downstream O2 sensor'],valuesAndScales:['O2S B1S2 0.016 V'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}};
  const snapshot=correctAutomotiveGraphReasoning(base),snapshotText=snapshot.interpretation.join(' ');assert.equal(snapshot.analysisMode,'PID_SNAPSHOT');assert.equal(snapshot.reasoningEvidence.analysisMode,'PID_SNAPSHOT');assert.match(snapshotText,/low current voltage reading/i);assert.doesNotMatch(snapshotText,/\blean\b|\brich\b/i);
  const temporal=correctAutomotiveGraphReasoning({...base,observed:['B1S1 and B1S2 plotted trace'],traceFindings:['B1S2 trace switches over time']});assert.equal(temporal.analysisMode,'TEMPORAL_GRAPH');assert.equal(temporal.reasoningEvidence.dynamicTraceEvidenceAvailable,true);
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
