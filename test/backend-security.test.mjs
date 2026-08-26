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
  const text=corrected.interpretation.join(' ');assert.equal(corrected.reasoningEvidence.combinedTrim,-8.591);assert.equal(corrected.reasoningEvidence.fuelTrimPolarity,'NEGATIVE_PCM_REMOVING_FUEL');assert.equal(corrected.reasoningEvidence.operatingState,'WARM_NEAR_IDLE');assert.equal(corrected.reasoningEvidence.dynamicTraceEvidenceAvailable,false);assert.equal(corrected.analysisMode,'PID_SNAPSHOT');assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.match(text,/high current voltage reading/);assert.match(text,/approximately 8\.6% fuel removal/);assert.match(text,/one value cannot verify sensor performance/i);assert.match(text,/Insufficient dynamic graph evidence/);assert.doesNotMatch(text,/rich side|low and lean|vacuum leak|sensor is good|no irregularities/i);assert.match(corrected.nextTest[0],/Fuel System Status \/ Closed Loop Status/i);
});

test('10.12.13 static snapshot guard removes temporal inference and defaults significance to indeterminate',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:95,observed:['LTFT B1 -6.249%','STFT B1 +0.781%','AFS B1S1 3.249 V','O2S B1S2 0.055 V','Engine speed 905 RPM'],interpretation:['B1S2 shows minimal activity and is stable.','The sensor is biased low and not switching.','Fuel trim behavior is mildly abnormal.'],diagnosticSignificance:'MILDLY_ABNORMAL',nextTest:['Replace the downstream sensor.'],pidNames:['LTFT B1','STFT B1','AFS B1S1','O2S B1S2','Engine speed'],sensorNames:['Air Fuel Ratio Sensor','downstream O2 sensor'],valuesAndScales:['LTFT B1 -6.249%','STFT B1 +0.781%','AFS B1S1 3.249 V','O2S B1S2 0.055 V','Engine speed 905 RPM'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});
  const text=corrected.interpretation.join(' ');assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.equal(corrected.reasoningEvidence.dynamicTraceEvidenceAvailable,false);assert.equal(corrected.reasoningEvidence.temporalEvidenceSource,'STATIC_SNAPSHOT_ONLY');assert.match(text,/O2S B1S2 is currently 0\.055 V/);assert.match(text,/snapshot\/range evidence is insufficient to determine mixture state, sensor switching behavior, sensor health, or catalyst efficiency/i);assert.doesNotMatch(text,/minimal activity|stable|unstable|responding|stuck|biased|trending|fluctuating|mildly abnormal/i);assert.match(corrected.nextTest[0],/Fuel System Status \/ Closed Loop Status/);assert.match(corrected.unreadableOrUncertain.join(' '),/No reliable time-series information is available from this static PID snapshot/);
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
  assert.equal(corrected.analysisMode,'TEMPORAL_GRAPH');assert.equal(corrected.reasoningEvidence.temporalDataAvailability,'RELATIVE_TEMPORAL_DATA_AVAILABLE');assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.doesNotMatch(corrected.interpretation.join(' '),/only instantaneous|static snapshot/i);assert.doesNotMatch(corrected.nextTest.join(' '),/capture these PID signals over time/i);assert.match(corrected.nextTest.join(' '),/commanded rich\/lean/i);
});

test('10.12.27 invalid Current Min Max OCR is quarantined without swapping values',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:93,observed:['Long FT #1 Current: 6.249%','Long FT #1 Min: 6.249%','Long FT #1 Max: 5.467%','Plotted traces visible across a horizontal axis'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Long FT #1'],sensorNames:[],valuesAndScales:['Long FT #1 Current: 6.249%','Long FT #1 Min: 6.249%','Long FT #1 Max: 5.467%'],traceFindings:['Long FT #1 plotted trace varies across the visible interval'],unreadableOrUncertain:['Exact horizontal time scale is unreadable'],visibleVehicle:{description:'',evidence:[]}});
  assert.equal(corrected.reasoningEvidence.rangeValidation,'UNCERTAIN_VALUES_REMOVED');assert.equal(corrected.reasoningEvidence.temporalDataAvailability,'RELATIVE_TEMPORAL_DATA_AVAILABLE');assert.doesNotMatch(corrected.observed.join(' '),/Min: 6\.249|Max: 5\.467/);assert.doesNotMatch(corrected.valuesAndScales.join(' '),/Min: 6\.249|Max: 5\.467/);assert.match(corrected.unreadableOrUncertain.join(' '),/Min\/Max uncertain.*MIN <= CURRENT <= MAX/i);
});

test('10.12.29 snapshot routing removes downstream temporal prose from every displayed section',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:96,observed:['Short FT #1 Current: 0.781%','Short FT #1 demonstrates significant fluctuations, peaking at 0.781','Engine Speed Current: 905 RPM','Engine Speed shows minor fluctuations'],interpretation:['Trace-derived observation: the downstream O2 remained low.','The oxygen sensor is not switching.'],diagnosticSignificance:'MILDLY_ABNORMAL',nextTest:[],pidNames:['Short FT #1','Engine Speed','O2S B1S2'],sensorNames:['downstream O2 sensor'],valuesAndScales:['O2S B1S2 Current: 0.055 V'],traceFindings:[],unreadableOrUncertain:['Time scale units are unreadable; consider time relative'],visibleVehicle:{description:'',evidence:[]}});
  const displayed=[...corrected.observed,...corrected.valuesAndScales,...corrected.traceFindings,...corrected.interpretation,...corrected.unreadableOrUncertain].join(' ');
  assert.equal(corrected.analysisMode,'PID_SNAPSHOT');assert.equal(corrected.reasoningEvidence.temporalRoutingDecision,'SNAPSHOT');assert.equal(corrected.reasoningEvidence.temporalInterpretationPermissions,'STATIC VALUES ONLY');assert.equal(corrected.reasoningEvidence.temporalClaimValidation,'PASS');assert.equal(corrected.reasoningEvidence.temporalClaimConflictDetected,'CORRECTED');assert.doesNotMatch(displayed,/fluctuat|peaking|trace-derived|remained low|not switching|consider time relative/i);assert.match(displayed,/Short FT #1 Current: 0\.781%/);assert.match(displayed,/O2S B1S2 is currently 0\.055 V/);assert.match(displayed,/static PID snapshot/i);assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.match(corrected.nextTest[0],/Fuel System Status \/ Closed Loop Status/i);
});

test('10.12.29 genuine plotted history retains supported temporal interpretation',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['Multiple sequential samples are plotted across a horizontal graph axis'],interpretation:['Trace-derived observation: Engine Speed trends downward across the visible interval.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:['Verify closed-loop status during the capture.'],pidNames:['Engine Speed'],sensorNames:[],valuesAndScales:[],traceFindings:['Engine Speed plotted trace trends downward across the visible interval'],classifierGraphEvidence:['plotted traces visible across horizontal graph panels'],unreadableOrUncertain:['Exact time scale is unreadable'],visibleVehicle:{description:'',evidence:[]}});
  assert.equal(corrected.analysisMode,'TEMPORAL_GRAPH');assert.equal(corrected.reasoningEvidence.temporalRoutingDecision,'TIME SERIES');assert.equal(corrected.reasoningEvidence.temporalInterpretationPermissions,'ENABLED');assert.match(corrected.interpretation.join(' '),/trends downward/);assert.match(corrected.traceFindings.join(' '),/trends downward/);
});

test('10.12.30 rejects a next test that duplicates channels already visible in a temporal graph',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:97,observed:['Multiple plotted traces visible across a horizontal graph axis'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:['Request simultaneous upstream A/F and downstream O2 live data in closed loop over time.'],pidNames:['AFS B1S1','O2S B1S2','Short FT #1','Long FT #1','Engine Speed'],sensorNames:['upstream A/F sensor','downstream O2 sensor'],valuesAndScales:[],traceFindings:['AFS B1S1, O2S B1S2, Short FT #1, Long FT #1, and Engine Speed traces vary across the visible interval'],unreadableOrUncertain:['Exact horizontal time scale is unreadable'],visibleVehicle:{description:'',evidence:[]}});
  assert.equal(corrected.analysisMode,'TEMPORAL_GRAPH');assert.equal(corrected.evidenceInventoryStatus,'PASS');assert.deepEqual(corrected.evidenceInventory.channels,['AFS B1S1','O2S B1S2','Short FT #1','Long FT #1','Engine Speed']);assert.equal(corrected.evidenceInventory.temporalEvidence,'PRESENT');assert.equal(corrected.evidenceInventory.closedLoopStatus,'NOT_PRESENT');assert.equal(corrected.candidateNextTestRejected,'DUPLICATES ACTIVE EVIDENCE');assert.equal(corrected.redundantTestCheck,'PASS');assert.equal(corrected.nextTestSelection,'PASS');assert.match(corrected.nextTest[0],/Fuel System Status \/ Closed Loop Status/);assert.match(corrected.nextTestReason,/Closed-loop status is required/i);assert.doesNotMatch(corrected.nextTest.join(' '),/request simultaneous upstream/i);
});

test('10.12.30 uses correct channel terminology and preserves narrowband O2 switching language',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:96,observed:['Plotted traces visible across a horizontal graph axis'],interpretation:['Long FT #1 is switching while RPM switches.','O2S B1S2 switching is visible.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:['Verify exhaust integrity.'],pidNames:['Long FT #1','Engine Speed','O2S B1S2'],sensorNames:['narrowband downstream O2 sensor'],valuesAndScales:[],traceFindings:['Long FT #1 trace switching is visible across time.','O2S B1S2 trace switching is visible across time.'],unreadableOrUncertain:['Exact time scale is unreadable'],visibleVehicle:{description:'',evidence:[]}});
  const text=[...corrected.traceFindings,...corrected.interpretation].join(' ');assert.match(text,/Long FT #1 trace varying/i);assert.match(text,/RPM varies/i);assert.doesNotMatch(text,/Long FT #1 (?:is |trace )?switch/i);assert.doesNotMatch(text,/RPM switch/i);assert.match(text,/O2S B1S2 trace switching/i);
});

test('10.12.31 makes negative-only STFT evidence authoritative over zero-crossing prose',()=>{
  const fields=['Short FT #1 Current: -1.563%','Short FT #1 Min: -2.342%','Short FT #1 Max: -1.563%','Plotted traces visible across a horizontal graph axis'];
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:97,observed:fields,interpretation:['Short FT #1 shows intermittent varying between negative and positive values close to zero.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Short FT #1'],sensorNames:[],valuesAndScales:fields.slice(0,3),traceFindings:['Short FT #1 plotted trace varies across the visible interval'],unreadableOrUncertain:['Exact time scale unreadable'],visibleVehicle:{description:'',evidence:[]}});
  const evidence=corrected.numericEvidence.find(item=>item.pidName==='Short FT #1'),text=corrected.interpretation.join(' ');assert.equal(evidence.rangeSign,'NEGATIVE_ONLY');assert.equal(evidence.crossesZero,false);assert.equal(evidence.allObservedNegative,true);assert.equal(evidence.currentMinMaxConsistent,true);assert.doesNotMatch(text,/negative and positive|cross(?:es|ed|ing)? zero/i);assert.match(text,/ranged from approximately -2\.342% to -1\.563% and is negative throughout/i);assert.ok(corrected.numericValidation.conflicts.includes('Short FT #1 ZERO-CROSSING CLAIM'));assert.equal(corrected.numericValidation.correction,'PASS');
});

test('10.12.31 allows supported zero crossing and direction but rejects unsupported direction',()=>{
  const base={status:'PARTIAL',confidence:96,observed:['Plotted traces visible across a horizontal graph axis','Short FT #1 Min: -4.0%','Short FT #1 Max: +3.0%','Engine Speed Current: 912 RPM','Engine Speed Min: 912 RPM','Engine Speed Max: 994 RPM'],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Short FT #1','Engine Speed'],sensorNames:[],valuesAndScales:[],unreadableOrUncertain:['Exact time scale unreadable'],visibleVehicle:{description:'',evidence:[]}};
  const unsupported=correctAutomotiveGraphReasoning({...base,interpretation:['Short FT #1 crosses zero.','Engine Speed decreased across the visible interval.'],traceFindings:['Short FT #1 plotted trace transitions from negative to positive across the interval']});assert.equal(unsupported.numericEvidence.find(item=>item.pidName==='Short FT #1').crossesZero,true);assert.match(unsupported.interpretation.join(' '),/Short FT #1 crosses zero/i);assert.doesNotMatch(unsupported.interpretation.join(' '),/Engine Speed decreased/i);assert.match(unsupported.interpretation.join(' '),/Engine Speed ranged from approximately 912 to 994 RPM/i);
  const supported=correctAutomotiveGraphReasoning({...base,interpretation:['Engine Speed decreased across the visible interval.'],traceFindings:['Engine Speed plotted trace decreased from approximately 994 RPM toward 912 RPM across the visible interval']});assert.match(supported.interpretation.join(' '),/Engine Speed decreased across the visible interval/i);
});

test('10.12.31 flags inconsistent sets and removes numeric claims outside the validated range',()=>{
  const inconsistent=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:95,observed:['Engine Speed Current: 5 RPM','Engine Speed Min: 1 RPM','Engine Speed Max: 4 RPM'],interpretation:['Engine Speed is 5 RPM.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Engine Speed'],sensorNames:[],valuesAndScales:[],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});assert.equal(inconsistent.numericEvidence[0].currentMinMaxConsistent,false);assert.equal(inconsistent.numericValidation.currentMinMaxConsistency,'FAIL');assert.doesNotMatch(inconsistent.interpretation.join(' '),/Engine Speed is 5 RPM/i);
  const bounded=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:95,observed:['O2S B1S2 Current: 0.016 V','O2S B1S2 Min: 0.000 V','O2S B1S2 Max: 0.035 V','Plotted traces visible across a horizontal graph axis'],interpretation:['O2S B1S2 spikes reached 0.35 V.','The O2S B1S2 sensor is normal.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['O2S B1S2'],sensorNames:['downstream O2 sensor'],valuesAndScales:[],traceFindings:['O2S B1S2 plotted trace is visible across the interval'],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});const text=bounded.interpretation.join(' ');assert.doesNotMatch(text,/0\.35 V|sensor is normal/i);assert.match(text,/low-voltage range of approximately 0\.000 to 0\.035 V/i);assert.match(text,/Whether this behavior is normal depends/i);assert.ok(bounded.numericValidation.conflicts.includes('O2S B1S2 OUT-OF-RANGE CLAIM'));
});

test('10.12.32 preserves Unicode, OCR dash, and spaced negative signs through canonical evidence',()=>{
  for(const raw of ['−6.249','–6.249','—6.249','- 6.249']){const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:[`Long FT #1 Current: ${raw}%`,'Long FT #1 Min: -6.249%','Long FT #1 Max: -5.467%'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Long FT #1'],sensorNames:[],valuesAndScales:[],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}}),evidence=corrected.numericEvidence[0];assert.equal(evidence.current,-6.249,raw);assert.equal(evidence.currentSign,'NEGATIVE',raw);assert.equal(evidence.rawCurrent,raw);assert.equal(evidence.validityState,'VALID');assert.equal(evidence.signNormalizationApplied,raw!=='-6.249');assert.equal(corrected.numericValidation.signNormalization,'PASS');}
});

test('10.12.32 fails closed on inconsistent LTFT while retaining valid sibling PID evidence',()=>{
  const fields=['Long FT #1 Current: +6.249%','Long FT #1 Min: -6.249%','Long FT #1 Max: -5.467%','Short FT #1 Current: +0.781%','Short FT #1 Min: -2.342%','Short FT #1 Max: +1.563%','AFS Voltage B1S1 Current: 3.225 V','AFS Voltage B1S1 Min: 3.200 V','AFS Voltage B1S1 Max: 3.303 V','O2S B1S2 Current: 0.016 V','O2S B1S2 Min: 0.000 V','O2S B1S2 Max: 0.035 V','Engine Speed Current: 912 RPM','Engine Speed Min: 912 RPM','Engine Speed Max: 994 RPM','Plotted traces visible across a horizontal axis'];
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:fields,interpretation:['Long FT #1 shows intermittent changes and is significant.','Short FT #1 crosses zero across the visible interval.'],diagnosticSignificance:'SIGNIFICANT',nextTest:['Add Fuel System Status / Closed Loop Status.'],pidNames:['Long FT #1','Short FT #1','AFS Voltage B1S1','O2S B1S2','Engine Speed'],sensorNames:['upstream A/F sensor','downstream O2 sensor'],valuesAndScales:fields.slice(0,15),traceFindings:['Long FT #1 plotted trace changes across the interval','Short FT #1 plotted trace transitions from negative to positive across the interval'],unreadableOrUncertain:['Exact time scale unreadable'],visibleVehicle:{description:'',evidence:[]}});
  const ltft=corrected.numericEvidence.find(item=>item.pidName==='Long FT #1'),stftEvidence=corrected.numericEvidence.find(item=>item.pidName==='Short FT #1'),text=corrected.interpretation.join(' ');assert.equal(ltft.current,6.249);assert.equal(ltft.validityState,'NUMERIC_INCONSISTENCY');assert.equal(ltft.inconsistencyReason,'CURRENT_ABOVE_MAX');assert.equal(stftEvidence.validityState,'VALID');assert.equal(stftEvidence.crossesZero,true);assert.equal(corrected.reasoningEvidence.combinedTrim,null);assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.equal(corrected.diagnosticSignificanceReason,'NUMERIC_EVIDENCE_INCONSISTENCY_DETECTED');assert.equal(text,'');assert.deepEqual(corrected.nextTest,[]);assert.deepEqual(corrected.numericValidation.invalidPidEvidence,['Long FT #1']);assert.equal(corrected.numericValidation.currentMinMaxConsistency,'FAIL');assert.equal(corrected.numericValidation.dependentInterpretationSuppressed,'PASS');assert.equal(corrected.freshResultVerification,'PASS');
});

test('10.12.32 distinguishes Min greater than Max from Current outside range',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:97,observed:['Engine Speed Current: 2 RPM','Engine Speed Min: 5 RPM','Engine Speed Max: 1 RPM'],interpretation:['Engine Speed is significant.'],diagnosticSignificance:'SIGNIFICANT',nextTest:[],pidNames:['Engine Speed'],sensorNames:[],valuesAndScales:[],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}}),evidence=corrected.numericEvidence[0];assert.equal(evidence.inconsistencyReason,'MIN_GREATER_THAN_MAX');assert.equal(evidence.validityState,'NUMERIC_INCONSISTENCY');assert.equal(corrected.evidenceConsistencyFailures[0].failure,'Min exceeds Max.');assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');
});

test('10.12.33 classifier graph structure preserves relative temporal evidence without exact time scale',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['PID labels are readable'],interpretation:['Only instantaneous PID readings are available; no time-based behavior can be determined from this static snapshot.'],diagnosticSignificance:'INCONCLUSIVE',nextTest:['Capture upstream A/F and downstream O2 data simultaneously over time.'],pidNames:['Long FT #1','Short FT #1','AFS Voltage B1S1','O2S B1S2','Engine Speed'],sensorNames:['upstream A/F sensor','downstream O2 sensor'],valuesAndScales:[],traceFindings:[],classifierGraphEvidence:['axes and gridlines are visible','plotted traces with repeated scale markings and legends'],unreadableOrUncertain:['Exact X-axis time units are unreadable'],visibleVehicle:{description:'',evidence:[]}});
  assert.equal(corrected.evidenceType.hasAxes,true);assert.equal(corrected.evidenceType.hasGridlines,true);assert.equal(corrected.evidenceType.hasPlottedTraces,true);assert.equal(corrected.evidenceType.hasMultipleTraceSamples,true);assert.equal(corrected.evidenceType.timeSeriesAvailable,true);assert.equal(corrected.evidenceType.exactTimeScaleKnown,false);assert.equal(corrected.evidenceType.isStaticPidTable,false);assert.equal(corrected.analysisMode,'TEMPORAL_GRAPH');assert.equal(corrected.semanticConsistencyStatus,'RECONCILED');assert.equal(corrected.freshResultVerification,'PASS');assert.doesNotMatch(corrected.interpretation.join(' '),/static snapshot|no time-based behavior/i);assert.doesNotMatch(corrected.nextTest.join(' '),/capture upstream A\/F and downstream O2/i);assert.match(corrected.nextTest.join(' '),/Closed Loop Status/i);
});

test('10.12.33 true instantaneous PID table remains static evidence',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:97,observed:['Long FT #1 Current: -6.249%','Engine Speed Current: 912 RPM'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Long FT #1','Engine Speed'],sensorNames:[],valuesAndScales:[],traceFindings:[],classifierGraphEvidence:['PID table with one value per row'],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});assert.equal(corrected.evidenceType.isStaticPidTable,true);assert.equal(corrected.evidenceType.timeSeriesAvailable,false);assert.equal(corrected.analysisMode,'PID_SNAPSHOT');assert.match(corrected.interpretation.join(' '),/Only instantaneous PID readings/i);
});

test('10.12.33 unresolved evidence contradiction fails fresh verification and withholds conclusions',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:97,observed:['plotted traces visible across horizontal axis'],interpretation:['Only instantaneous PID readings are available.'],diagnosticSignificance:'SIGNIFICANT',nextTest:['Replace sensor.'],pidNames:['O2S B1S2'],sensorNames:[],valuesAndScales:[],traceFindings:[],classifierGraphEvidence:['plotted traces visible'],unreadableOrUncertain:['plotted traces are unreadable'],visibleVehicle:{description:'',evidence:[]}});assert.equal(corrected.evidenceType.hasPlottedTraces,true);assert.equal(corrected.evidenceType.timeSeriesAvailable,false);assert.equal(corrected.freshResultVerification,'PASS');assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');
});

test('10.12.34 hard gate reports exact Current above Max failure and bypasses normal reasoning',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['Long FT #1 Current: +6.249%','Long FT #1 Min: −6.249%','Long FT #1 Max: +5.467%','plotted traces visible across horizontal axis'],interpretation:['Long FT #1 is significant.','O2S B1S2 responds normally.'],diagnosticSignificance:'SIGNIFICANT',nextTest:['Add Fuel System Status / Closed Loop Status.'],pidNames:['Long FT #1','O2S B1S2'],sensorNames:[],valuesAndScales:[],traceFindings:['Long FT #1 plotted trace varies','O2S B1S2 plotted trace responds'],classifierGraphEvidence:['axes gridlines plotted traces'],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}}),failure=corrected.evidenceConsistencyFailures[0];assert.equal(corrected.freshResultVerification,'PASS');assert.equal(corrected.semanticConsistencyStatus,'FAIL_NUMERIC_EVIDENCE');assert.equal(failure.pidName,'Long FT #1');assert.equal(failure.current,'+6.249');assert.equal(failure.minimum,'−6.249');assert.equal(failure.maximum,'+5.467');assert.equal(failure.failureCode,'CURRENT_ABOVE_MAX');assert.equal(failure.failure,'Current exceeds Max.');assert.deepEqual(corrected.traceFindings,[]);assert.deepEqual(corrected.interpretation,[]);assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.equal(corrected.nextTestSelection,'BLOCKED_NUMERIC_EVIDENCE');assert.deepEqual(corrected.nextTest,[]);
});

test('10.12.34 accepts valid signed ranges and rejects Current below Min',()=>{
  for(const current of ['+4.0','−4.0']){const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:[`Long FT #1 Current: ${current}%`,'Long FT #1 Min: −6.0%','Long FT #1 Max: +6.0%','plotted traces visible'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Long FT #1'],sensorNames:[],valuesAndScales:[],traceFindings:['Long FT #1 plotted trace varies'],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});assert.equal(corrected.freshResultVerification,'PASS',current);assert.equal(corrected.numericValidation.currentMinMaxConsistency,'PASS',current);assert.equal(corrected.numericEvidence[0].current,current.startsWith('+')?4:-4,current);}
  const below=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['Long FT #1 Current: −7.0%','Long FT #1 Min: −6.0%','Long FT #1 Max: +6.0%'],interpretation:['Long FT is abnormal.'],diagnosticSignificance:'SIGNIFICANT',nextTest:[],pidNames:['Long FT #1'],sensorNames:[],valuesAndScales:[],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});assert.equal(below.freshResultVerification,'PASS');assert.equal(below.evidenceConsistencyFailures[0].failureCode,'CURRENT_BELOW_MIN');assert.equal(below.evidenceConsistencyFailures[0].failure,'Current is below Min.');
});

test('10.12.34 rejects malformed and contradictory duplicate numeric fields',()=>{
  const malformed=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['Short FT #1 Current: unreadable','Short FT #1 Min: -2%','Short FT #1 Max: +2%'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Short FT #1'],sensorNames:[],valuesAndScales:[],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});assert.equal(malformed.freshResultVerification,'PASS');assert.equal(malformed.evidenceConsistencyFailures[0].failureCode,'NUMERIC_PARSE_FAILURE');
  const duplicate=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['Short FT #1 Current: +1%','Short FT #1 Current: -1%','Short FT #1 Min: -2%','Short FT #1 Max: +2%'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Short FT #1'],sensorNames:[],valuesAndScales:[],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});assert.equal(duplicate.freshResultVerification,'PASS');assert.equal(duplicate.evidenceConsistencyFailures[0].failureCode,'CONTRADICTORY_DUPLICATE_VALUES');
});

test('10.12.34 valid graph with missing closed-loop status preserves 10.12.30 selector',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['plotted traces visible across horizontal axis'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:['Capture AFS B1S1 and O2S B1S2 over time.'],pidNames:['Long FT #1','Short FT #1','AFS B1S1','O2S B1S2','Engine Speed'],sensorNames:[],valuesAndScales:['Long FT #1 Current: -4%','Long FT #1 Min: -6%','Long FT #1 Max: +6%','Short FT #1 Current: +1%','Short FT #1 Min: -2%','Short FT #1 Max: +2%'],traceFindings:['multiple plotted points across the interval'],unreadableOrUncertain:['Exact time scale unreadable'],visibleVehicle:{description:'',evidence:[]}});assert.equal(corrected.freshResultVerification,'PASS');assert.equal(corrected.evidenceInventoryStatus,'PASS');assert.equal(corrected.candidateNextTestRejected,'DUPLICATES ACTIVE EVIDENCE');assert.match(corrected.nextTest[0],/Fuel System Status \/ Closed Loop Status/i);
});

test('10.12.35 semantic PID aliases inventory acquired sensors and advance to closed-loop status',()=>{
  const variants=[['Air Fuel Sensor Bank 1 Sensor 1','O2 Sensor Bank 1 Sensor 2'],['Upstream A/F Sensor','Rear O2 Sensor']];for(const [upstream,downstream] of variants){const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['Static PID table'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:['Capture upstream and downstream sensors.'],pidNames:['Long FT #1','Short FT #1',upstream,downstream,'RPM'],sensorNames:[upstream,downstream],valuesAndScales:['Long FT #1 Current: -6.249%','Long FT #1 Min: -6.249%','Long FT #1 Max: -5.467%','Short FT #1 Current: +1.563%','Short FT #1 Min: -2.342%','Short FT #1 Max: +1.563%','AFS Voltage B1S1 Current: 3.225 V','AFS Voltage B1S1 Min: 3.200 V','AFS Voltage B1S1 Max: 3.303 V','O2S B1S2 Current: 0.016 V','O2S B1S2 Min: 0.000 V','O2S B1S2 Max: 0.035 V','Engine Speed Current: 912 RPM','Engine Speed Min: 912 RPM','Engine Speed Max: 994 RPM'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});assert.equal(corrected.freshResultVerification,'PASS');assert.equal(corrected.evidenceInventory.upstreamAirFuel,'PRESENT');assert.equal(corrected.evidenceInventory.downstreamO2,'PRESENT');assert.ok(corrected.evidenceInventory.acquiredEvidenceClasses.includes('upstreamAirFuel'));assert.ok(corrected.evidenceInventory.acquiredEvidenceClasses.includes('downstreamO2'));assert.match(corrected.nextTest[0],/Fuel System Status \/ Closed Loop Status/);assert.doesNotMatch(corrected.nextTest.join(' '),/capture upstream|capture.*downstream/i);assert.match(corrected.nextTestReason,/Closed-loop status is required/i);}
});

test('10.12.35 static evidence requests a material temporal characteristic only after loop status is present',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['Static PID values','Fuel System Status: Closed Loop'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['AFS B1S1','O2S B1S2','Fuel System Status'],sensorNames:[],valuesAndScales:['AFS B1S1 Current: 3.225 V','O2S B1S2 Current: 0.016 V'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});assert.equal(corrected.analysisMode,'PID_SNAPSHOT');assert.equal(corrected.evidenceInventory.upstreamAirFuel,'PRESENT');assert.equal(corrected.evidenceInventory.downstreamO2,'PRESENT');assert.equal(corrected.evidenceInventory.closedLoopStatus,'PRESENT');assert.match(corrected.nextTest[0],/synchronized time-series capture of the already-present/i);assert.match(corrected.nextTestReason,/missing evidence characteristic is synchronized temporal behavior/i);
});

test('10.12.36 validates the frozen final numeric evidence before interpretation',()=>{
  const analyze=(current,minimum,maximum)=>correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:[`Long FT #1 Current: ${current}%`,`Long FT #1 Min: ${minimum}%`,`Long FT #1 Max: ${maximum}%`],interpretation:['Calculate combined fuel trim and diagnose the mixture.'],diagnosticSignificance:'SIGNIFICANT',nextTest:['Replace a component.'],pidNames:['Long FT #1'],sensorNames:[],valuesAndScales:[],traceFindings:['Long FT #1 trace varies'],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});
  const above=analyze('+6.249','-6.249','+5.467');assert.equal(above.numericValidation.validationStage,'POST_FINALIZATION_PRE_INTERPRETATION');assert.equal(above.numericValidation.finalizedEvidenceFrozen,'PASS');assert.ok(Object.isFrozen(above.numericEvidence));assert.ok(above.numericEvidence.every(Object.isFrozen));assert.equal(above.evidenceConsistencyFailures[0].failure,'Current exceeds Max.');assert.equal(above.freshResultVerification,'PASS');assert.deepEqual(above.interpretation,[]);assert.deepEqual(above.traceFindings,[]);assert.deepEqual(above.nextTest,[]);assert.equal(above.nextTestReason,'');assert.equal(above.reasoningEvidence.combinedTrim,null);
  for(const [current,minimum,maximum] of [['-6.249','-6.249','-5.467'],['1.563','-2.342','1.563']]){const valid=analyze(current,minimum,maximum);assert.equal(valid.numericValidation.currentMinMaxConsistency,'PASS');assert.equal(valid.freshResultVerification,'PASS');assert.equal(valid.numericEvidence[0].sourceField,'FINAL_NORMALIZED_PID_CURRENT_MIN_MAX');}
  const reversed=analyze('1.0','5.0','-5.0');assert.equal(reversed.numericValidation.currentMinMaxConsistency,'FAIL');assert.equal(reversed.evidenceConsistencyFailures[0].failure,'Min exceeds Max.');assert.deepEqual(reversed.nextTest,[]);
});

test('10.12.36 one invalid PID fails the complete evidence set while valid evidence retains 10.12.35 routing',()=>{
  const base={status:'PARTIAL',confidence:98,observed:['plotted traces visible across horizontal axis'],interpretation:['Diagnostic conclusion.'],diagnosticSignificance:'SIGNIFICANT',nextTest:['Capture upstream A/F and downstream O2 over time.'],pidNames:['Long FT #1','Short FT #1','AFS Voltage B1S1','O2S B1S2','Engine Speed'],sensorNames:['upstream A/F sensor','downstream O2 sensor'],valuesAndScales:['Long FT #1 Current: +6.249%','Long FT #1 Min: -6.249%','Long FT #1 Max: +5.467%','Short FT #1 Current: +1%','Short FT #1 Min: -2%','Short FT #1 Max: +2%','AFS Voltage B1S1 Current: 3.225 V','AFS Voltage B1S1 Min: 3.2 V','AFS Voltage B1S1 Max: 3.303 V','O2S B1S2 Current: 0.016 V','O2S B1S2 Min: 0 V','O2S B1S2 Max: 0.035 V','Engine Speed Current: 912 RPM','Engine Speed Min: 900 RPM','Engine Speed Max: 994 RPM'],traceFindings:['multiple plotted points across the interval'],unreadableOrUncertain:['Exact time scale unreadable'],visibleVehicle:{description:'',evidence:[]}};
  const failed=correctAutomotiveGraphReasoning(base);assert.equal(failed.evidenceConsistencyFailures.length,1);assert.equal(failed.freshResultVerification,'PASS');assert.deepEqual(failed.interpretation,[]);assert.deepEqual(failed.nextTest,[]);
  const valid=correctAutomotiveGraphReasoning({...base,valuesAndScales:base.valuesAndScales.map(value=>value==='Long FT #1 Max: +5.467%'?'Long FT #1 Max: +6.249%':value)});assert.equal(valid.freshResultVerification,'PASS');assert.match(valid.nextTest[0],/Fuel System Status \/ Closed Loop Status/i);assert.doesNotMatch(valid.nextTest.join(' '),/capture upstream|capture.*downstream/i);
});

test('10.12.42 binds Current Min and Max by explicit role within each PID-owned segment',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:[],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Long FT #1','Short FT #1','O2S B1S2','AFS B1S1','Engine Speed'],sensorNames:[],valuesAndScales:['Long FT #1 Current: -6.249% Min: -6.249% Max: -5.467%','Short FT #1 Current: +0.781% Min: -2.342% Max: +1.563%','O2S B1S2 Current: 0.055 V Min: 0.000 V Max: 0.055 V','AFS B1S1 Current: 3.249 V Min: 3.191 V Max: 3.303 V','Engine Speed Current: 905 RPM Min: 899 RPM Max: 994 RPM'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});const byName=name=>corrected.numericEvidence.find(row=>row.pidName===name);assert.deepEqual([byName('Long FT #1').current,byName('Long FT #1').minimum,byName('Long FT #1').maximum],[-6.249,-6.249,-5.467]);assert.deepEqual([byName('Short FT #1').current,byName('Short FT #1').minimum,byName('Short FT #1').maximum],[.781,-2.342,1.563]);assert.deepEqual([byName('O2S B1S2').current,byName('O2S B1S2').minimum,byName('O2S B1S2').maximum],[.055,0,.055]);assert.deepEqual([byName('AFS B1S1').current,byName('AFS B1S1').minimum,byName('AFS B1S1').maximum],[3.249,3.191,3.303]);assert.deepEqual([byName('Engine Speed').current,byName('Engine Speed').minimum,byName('Engine Speed').maximum],[905,899,994]);assert.equal(corrected.freshResultVerification,'PASS');
});

test('10.12.42 preserves missing roles and isolates adjacent PID values',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:[],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Long FT #1','Short FT #1'],sensorNames:[],valuesAndScales:['Long FT #1 Current: -6.249% Min: -6.249%','Short FT #1 Current: +1.000% Min: -2.000% Max: +2.000%'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});const ltft=corrected.numericEvidence.find(row=>row.pidName==='Long FT #1'),stft=corrected.numericEvidence.find(row=>row.pidName==='Short FT #1');assert.equal(ltft.current,-6.249);assert.equal(ltft.minimum,-6.249);assert.equal(ltft.maximum,null);assert.notEqual(ltft.minimum,0);assert.equal(ltft.bindingStatus,'INCOMPLETE');assert.deepEqual([stft.current,stft.minimum,stft.maximum],[1,-2,2]);assert.ok(ltft.sourceRegions.every(region=>region.startsWith('PID_OWNED_SEGMENT_')));
});

test('10.12.43 recovers a complete Engine Speed triplet from split PID-owned OCR tokens',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:[],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Engine Speed','Short FT #1'],sensorNames:[],valuesAndScales:['Engine Speed','Current','+2,244 RPM','Min','800 RPM','3,100 RPM','Max','Short FT #1 Current: +1.000% Min: -2.000% Max: +2.000%'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}});const rpm=corrected.numericEvidence.find(row=>row.pidName==='Engine Speed'),stft=corrected.numericEvidence.find(row=>row.pidName==='Short FT #1');assert.deepEqual([rpm.current,rpm.minimum,rpm.maximum],[2244,800,3100]);assert.equal(rpm.bindingStatus,'COMPLETE');assert.equal(rpm.currentMinMaxConsistent,true);assert.equal(rpm.rawCurrent,'+2,244');assert.notEqual(rpm.current,22.44);assert.deepEqual([stft.current,stft.minimum,stft.maximum],[1,-2,2]);assert.equal(corrected.freshResultVerification,'PASS');
});

test('10.12.43 keeps Engine Speed incomplete instead of borrowing from an adjacent PID',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:[],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Engine Speed','Short FT #1'],sensorNames:[],valuesAndScales:['Engine Speed','Current +2244 RPM','Min 800 RPM','Short FT #1','Current +1.000%','Min -2.000%','Max +2.000%'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}}),rpm=corrected.numericEvidence.find(row=>row.pidName==='Engine Speed');assert.deepEqual([rpm.current,rpm.minimum,rpm.maximum],[2244,800,null]);assert.equal(rpm.bindingStatus,'INCOMPLETE');
});

test('10.12.44 recovers Engine RPM aliases and bidirectional PID-local roles without merging Vehicle Speed',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:['Engine RPM Current: 2167 RPM'],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Vehicle Speed','Engine RPM'],sensorNames:[],valuesAndScales:['Min','Current','Max','Engine RPM','701 RPM','2167 RPM','3188 RPM','Vehicle Speed Current: 42 MPH Min: 0 MPH Max: 65 MPH'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}}),rpm=corrected.numericEvidence.find(row=>row.pidName==='Engine Speed');assert.deepEqual([rpm.current,rpm.minimum,rpm.maximum],[2167,701,3188]);assert.equal(rpm.candidateAudit.canonicalPid,'Engine Speed');assert.ok(rpm.candidateAudit.rawEvidenceTokens.some(token=>token.includes('Engine RPM')));assert.deepEqual(rpm.candidateAudit.candidates.map(candidate=>candidate.status),['ACCEPTED','ACCEPTED','ACCEPTED']);assert.ok(rpm.candidateAudit.candidates.every(candidate=>candidate.reason==='PID_LOCAL_EXPLICIT_ROLE_BINDING'));assert.ok(rpm.candidateAudit.rawEvidenceTokens.every(token=>!token.includes('Vehicle Speed')));assert.equal(corrected.freshResultVerification,'PASS');
});

test('10.12.44 keeps missing Engine Speed roles rejected with auditable evidence reasons',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'PARTIAL',confidence:98,observed:[],interpretation:[],diagnosticSignificance:'INCONCLUSIVE',nextTest:[],pidNames:['Engine Speed (RPM)'],sensorNames:[],valuesAndScales:['Engine Speed (RPM)','Current 2167 RPM'],traceFindings:[],unreadableOrUncertain:[],visibleVehicle:{description:'',evidence:[]}}),rpm=corrected.numericEvidence.find(row=>row.pidName==='Engine Speed');assert.deepEqual([rpm.current,rpm.minimum,rpm.maximum],[2167,null,null]);assert.equal(rpm.bindingStatus,'INCOMPLETE');assert.deepEqual(rpm.rejectedCandidates.map(candidate=>candidate.role),['minimum','maximum']);assert.ok(rpm.rejectedCandidates.every(candidate=>candidate.reason==='NO_PID_LOCAL_PARSEABLE_EVIDENCE'));
});

test('10.12.48 aligns diagnostic significance with missing context without changing validated triplets',()=>{
  const corrected=correctAutomotiveGraphReasoning({status:'READY',confidence:99,observed:['axes gridlines and plotted traces are visible'],interpretation:['AFS Voltage shows continuous activity, suggesting normal sensor operation.','One captured value cannot verify sensor performance.','O2S B1S2 behavior depends on operating condition, sensor type, mixture state, and system context.','AFS B1S1 has a correct switching frequency and fast response time.'],diagnosticSignificance:'NORMAL_OR_EXPECTED',nextTest:['Replace no components.'],pidNames:['Long FT #1','Short FT #1','O2S B1S2','AFS B1S1','Engine Speed'],sensorNames:['upstream A/F sensor','downstream O2 sensor'],valuesAndScales:['Long FT #1 Current: -6.249% Min: -6.249% Max: -5.467%','Short FT #1 Current: +0.781% Min: -2.342% Max: +1.563%','O2S B1S2 Current: 0.055 V Min: 0.000 V Max: 0.055 V','AFS B1S1 Current: 3.249 V Min: 3.191 V Max: 3.303 V','Engine Speed Current: 905 RPM Min: 899 RPM Max: 994 RPM'],traceFindings:['AFS B1S1 visible trace variation is present','O2S B1S2 remains in a low displayed voltage range'],classifierGraphEvidence:['axes and gridlines','multiple plotted traces across a horizontal axis'],unreadableOrUncertain:['Exact horizontal time scale is unreadable'],visibleVehicle:{description:'',evidence:[]}}),byName=name=>corrected.numericEvidence.find(row=>row.pidName===name),text=corrected.interpretation.join(' ');assert.deepEqual([byName('Long FT #1').current,byName('Long FT #1').minimum,byName('Long FT #1').maximum],[-6.249,-6.249,-5.467]);assert.deepEqual([byName('Short FT #1').current,byName('Short FT #1').minimum,byName('Short FT #1').maximum],[.781,-2.342,1.563]);assert.deepEqual([byName('O2S B1S2').current,byName('O2S B1S2').minimum,byName('O2S B1S2').maximum],[.055,0,.055]);assert.deepEqual([byName('AFS B1S1').current,byName('AFS B1S1').minimum,byName('AFS B1S1').maximum],[3.249,3.191,3.303]);assert.deepEqual([byName('Engine Speed').current,byName('Engine Speed').minimum,byName('Engine Speed').maximum],[905,899,994]);assert.ok(corrected.numericEvidence.every(row=>row.evidenceState==='COMPLETE_VALID'));assert.equal(corrected.freshResultVerification,'PASS');assert.equal(corrected.diagnosticSignificance,'INDETERMINATE');assert.equal(corrected.diagnosticSignificanceReason,'MISSING_CONTEXT_OR_UNVERIFIED_PERFORMANCE');assert.equal(corrected.diagnosticSignificanceAlignment.status,'APPLIED');assert.doesNotMatch(text,/suggesting normal sensor operation|correct switching frequency|fast response time/i);assert.match(text,/cannot verify sensor performance/i);assert.match(corrected.nextTest[0],/Fuel System Status \/ Closed Loop Status/i);assert.match(corrected.nextTestReason,/cannot be assigned full diagnostic significance/i);
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
          : calls === 2 ? { status: 'IDENTIFIED', primaryComponent: 'Alternator', componentConfidence: 0.94, system: 'Charging system', secondaryComponents: ['serpentine belt', 'pulley'], supportingEvidence: ['vented aluminum housing', 'belt-driven pulley', 'electrical charging connection'], possibleAlternatives: [], uncertaintyReason: null, drivetrainDiscrimination: drivetrain() }
          : { status: 'NO_VISIBLE_CONCERN_DETECTED', conditionConfidence: 0.82, observedCondition: [], possibleConcerns: [], connectionAssessments: [{location:'Alternator belt path',seatingStatus:'NO_GAP_OR_SEPARATION_VISIBLE',visibleEvidence:'The belt is visibly aligned on the pulley.'}], noVisibleConcernMessage: 'No visible defect can be confirmed from this image. Inspect the component physically before making a repair decision.', unableToInspectReason: null, visibleEvidence: ['Alternator housing and belt path are visible.'], recommendedVerification: ['Inspect the alternator and belt physically before making a repair decision.'], safetyDrivabilityImpact: null };
        return { ok: true, status: 200, async json() { return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] }; } };
      }
    });
    assert.equal(calls, 3);
    assert.equal(result.semanticResult.normalizedConfidence, 99);
    assert.equal(result.semanticResult.componentIdentification.primaryComponent, 'Alternator');
    assert.equal(result.semanticResult.componentIdentification.rawComponentConfidence, 0.94);
    assert.equal(result.semanticResult.componentIdentification.normalizedComponentConfidence, 94);
    assert.equal(result.semanticResult.componentIdentification.semanticRequestId, body.transactionId);
    assert.equal(result.semanticResult.componentIdentification.imageHash, body.imageHash);
    assert.notEqual(result.semanticResult.normalizedConfidence, result.semanticResult.componentIdentification.normalizedComponentConfidence);
    assert.equal(result.serverDiagnostic.componentIdentificationAttempted, true);
    assert.equal(result.serverDiagnostic.componentResultPresent, true);
    assert.equal(result.semanticResult.visualConditionInspection.status, 'NO_VISIBLE_CONCERN_DETECTED');
    assert.equal(result.semanticResult.visualConditionInspection.normalizedConditionConfidence, 82);
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
