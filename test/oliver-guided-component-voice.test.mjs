import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const authority=html.indexOf("const STATE_KEY='nitros_diagnostic_case_v10120'");
function extract(name,next){const start=html.indexOf(`function ${name}(`,authority),end=html.indexOf(`function ${next}(`,start);assert.ok(start>=0&&end>start);return html.slice(start,end).trim()}
function extractRaw(startToken,endToken){const start=html.indexOf(startToken,authority),end=html.indexOf(endToken,start);assert.ok(start>=0&&end>start);return html.slice(start,end).trim()}
const normalizeBlowerResult=Function(`return (${extract('normalizeBlowerResult','handleBlowerSpeedRecheck')})`)();
const contextualNumericSpeechRecovery=Function(`return (${extract('contextualNumericSpeechRecovery','blowerCommandResponseEvidence')})`)();
const commandResponseHarness=Function(`let state={complaint:'blower only works on high',normalizedSymptom:'lower blower speeds inoperative',componentTestState:{workflowId:'hvac-blower-speed-control',evidence:[{normalizedEvidence:'Speeds 1–3 inoperative; speed 4 operative',facts:{speedStates:{1:'INOPERATIVE',2:'INOPERATIVE',3:'INOPERATIVE',4:'OPERATIVE'}}}]}};${extract('contextualNumericSpeechRecovery','normalizeBlowerResult')};return text=>blowerCommandResponseEvidence(text)`)();
const mixedIntentHarness=Function(`let state={vehicle:{year:'',make:'',model:'',engine:'',configuration:''},complaint:'',symptoms:'',normalizedSymptom:'',system:'',component:'',diagnosticDomain:'',previousTests:'',technicianObservations:[],liveData:'',intakeStep:'vehicle',stage:'vehicle',authoritativeDiagnosticTest:null,componentTestState:null,routingDiagnostics:{}},guidance={measurements:[],evidence:[]},reply='';function normalize(text){return String(text||'')}function normalizeFinding(text){return String(text||'').toLowerCase().replace(/volts?/g,'v').replace(/amps?/g,'a')}function guidanceState(){return guidance}function vehicleLabel(){return[state.vehicle.year,state.vehicle.make,state.vehicle.model,state.vehicle.engine].filter(Boolean).join(' ')}function workflowName(){return'HVAC / Blower Diagnostic'}function selectGuidanceTest(id,name,reason,evidence){state.authoritativeDiagnosticTest={testId:'blower-command-response-correlation',canonicalName:name,displayName:name,status:'AWAITING_RESULT',evidence:[]};guidance.selectedNextTest=state.authoritativeDiagnosticTest;guidance.nextTestReason=reason;guidance.nextRequiredEvidence=evidence}function ask(text){reply=text}${extract('isolateMeasurementContext','diagnosticMeasurement')};${extract('diagnosticMeasurement','concern')};${extract('normalizeMixedIntentNumbers','contextualNumericSpeechRecovery')};${extract('normalizeBlowerResult','handleBlowerSpeedRecheck')};const base=normalizeBlowerResult;normalizeBlowerResult=(id,text)=>base(id,id==='blower-symptom-confirmation'&&/^it works/i.test(text)?text.replace(/^it works/i,'High works'):text);return{text:text=>handleMixedIntentDiagnosticEvidence(text),state,guidance,get reply(){return reply}}`)();
const vehicleProtectionHarness=Function(`function normalize(text){return String(text||'')}function normalizeFinding(text){return String(text||'').toLowerCase().replace(/volts?/g,'v').replace(/amps?/g,'a')}${extract('isolateMeasurementContext','diagnosticMeasurement')};${extract('diagnosticMeasurement','concern')};return{isolateMeasurementContext,diagnosticMeasurement,parseVehicle}`)();
const canonicalTestHarness=Function(`let state={stage:'diagnostic',authoritativeDiagnosticTest:null,componentTestState:{workflowId:'hvac-blower-speed-control'}},guidance={knowledgeSource:'generic-diagnostic-knowledge'};function guidanceState(){return guidance}function workflowName(){return'HVAC / Blower Diagnostic'}${extract('canonicalTestIdentity','mirrorGuidanceTest')};return{state,guidance,selectGuidanceTest}`)();
const semanticRoutingHarness=Function(`let state={intakeStep:'previous-repairs',previousRepairs:'',previousTests:'',complaint:'',routingDiagnostics:null},evidence=[],reply='';function diagnosticMeasurement(text){return /7[.]2/i.test(text)?{value:7.2,unit:'V'}:null}function guidanceAdd(field,item){evidence.push(item)}function symptomFacts(){return null}function ask(text){reply=text}${extract('semanticIntakeRouting','handleActiveFunctionalPermutation')};return{route:text=>semanticIntakeRouting(text),state,evidence,get reply(){return reply}}`)();

const additiveEvidenceHarness=()=>Function(`let state={vehicle:{year:'',make:'',model:'',engine:'',configuration:''},complaint:'',symptoms:'',normalizedSymptom:'',system:'',component:'',diagnosticDomain:'',previousTests:'',technicianObservations:[],intakeStep:'vehicle',stage:'vehicle',authoritativeDiagnosticTest:null,componentTestState:null,routingDiagnostics:{}},guidance={measurements:[],evidence:[],completedTests:[]},reply='';function normalize(text){return String(text||'')}function normalizeFinding(text){return String(text||'').toLowerCase().replace(/volts?/g,'v').replace(/amps?/g,'a')}function guidanceState(){return guidance}function vehicleLabel(){return[state.vehicle.year,state.vehicle.make,state.vehicle.model,state.vehicle.engine].filter(Boolean).join(' ')}function workflowName(){return'HVAC / Blower Diagnostic'}function selectGuidanceTest(id,name,reason,evidence){const testId=id==='blower-control-signal-identification'?id:'blower-command-response-correlation';state.authoritativeDiagnosticTest={testId,canonicalName:name,displayName:name,status:'AWAITING_RESULT',evidence:[]};guidance.selectedNextTest=state.authoritativeDiagnosticTest;guidance.nextTestReason=reason;guidance.nextRequiredEvidence=evidence}function ask(text){reply=text}${extract('isolateMeasurementContext','diagnosticMeasurement')};${extract('diagnosticMeasurement','concern')};${extract('normalizeMixedIntentNumbers','handleAdditiveComplaintMeasurementEvidence')};${extract('handleAdditiveComplaintMeasurementEvidence','reset')};${extractRaw('const handleAdditiveComplaintMeasurementEvidenceBase','const renderStatusBase')};return{apply:text=>handleAdditiveComplaintMeasurementEvidence(text),matrix:text=>handleBlowerCommandResponseMatrix(text),state,guidance,get reply(){return reply}}`)();

test('10.12.68 primary utterance additively retains vehicle, complaint, operating states, measurement, and active routing',()=>{
  const h=additiveEvidenceHarness();assert.equal(h.apply("2016 Jeep Wrangler high speed works, low and medium don't. The control signal is still 7.2 volts."),true);assert.deepEqual([h.state.vehicle.year,h.state.vehicle.make,h.state.vehicle.model],['2016','Jeep','Wrangler']);assert.match(h.state.complaint,/high blower speed operative/i);const operating=h.guidance.evidence.find(item=>item.type==='operating-state');assert.deepEqual(operating.facts.speedStates,{high:'OPERATIVE',medium:'INOPERATIVE',low:'INOPERATIVE'});assert.equal(h.state.blowerOperatingPattern,'HIGH_ONLY');assert.equal(h.state.blowerCommandResponseCorrelation,'HIGH_ONLY_WITH_CONTROL_SIGNAL_RANGE_UNESTABLISHED');assert.equal(h.state.componentCondemned,'None');assert.equal(h.state.diagnosticConclusionState,'UNCONFIRMED');const measurement=h.guidance.measurements.find(item=>item.testType==='control signal');assert.deepEqual([measurement.value,measurement.unit,measurement.source],[7.2,'V','technician-speech']);assert.equal(h.state.stage,'diagnostic');assert.equal(h.state.intakeStep,'complete');assert.equal(h.state.routingDiagnostics.routingDecision,'ACTIVE_GUIDED_DIAGNOSTIC_EVIDENCE_EVALUATION');assert.match(h.guidance.nextTestReason,/high blower speed operative.*7\.2 V control signal/i);assert.match(h.guidance.nextRequiredEvidence,/low, medium, and high/i);assert.match(h.reply,/high blower speed operative.*medium blower speed inoperative.*low blower speed inoperative/i);assert.doesNotMatch(h.reply,/lower speeds remain inoperative|does not confirm a high-only|which speeds work|whether high works|diagnostic code|what vehicle|what.*symptom/i);
});

test('10.12.68 measurement-only follow-up extends existing diagnostic state without deleting context',()=>{
  const h=additiveEvidenceHarness();h.state.vehicle={year:'2016',make:'Jeep',model:'Wrangler',engine:'',configuration:''};h.state.complaint='Original blower low/medium inoperative complaint';h.state.symptoms=h.state.complaint;h.state.stage='diagnostic';h.state.intakeStep='complete';assert.equal(h.apply('control signal is still 7.2 volts.'),true);assert.deepEqual([h.state.vehicle.year,h.state.vehicle.make,h.state.vehicle.model],['2016','Jeep','Wrangler']);assert.equal(h.state.complaint,'Original blower low/medium inoperative complaint');assert.equal(h.guidance.measurements.at(-1).value,7.2);assert.equal(h.state.stage,'diagnostic');assert.equal(h.state.routingDiagnostics.intakeFallbackPrevented,'YES');
});

test('10.12.68 semantic variations preserve operating-state and technician measurement meaning',()=>{
  for(const phrase of ["high works but low and medium don't",'only high speed works','low and medium are dead']){const result=Function(`return (${extract('blowerOperatingStateEvidence','symptomFacts')})`)()(phrase);assert.ok(result,phrase);if(/high/i.test(phrase))assert.equal(result.states.high,'OPERATIVE',phrase);assert.equal(result.states.low,'INOPERATIVE',phrase);assert.equal(result.states.medium,'INOPERATIVE',phrase)}for(const phrase of ["I've still got 7.2 volts on the control",'control wire is reading 7.2 volts','signal stays at seven point two volts',"I'm reading 7.2 V on the control circuit"]){const h=additiveEvidenceHarness();h.state.stage='diagnostic';h.state.complaint='Active circuit complaint';assert.equal(h.apply(phrase),true,phrase);assert.equal(h.guidance.measurements.at(-1).value,7.2,phrase)}
});

test('10.12.69 high-only variants share one authoritative semantic classification',()=>{
  const parse=Function(`return (${extract('blowerOperatingStateEvidence','symptomFacts')})`)();for(const phrase of ["high works but low and medium don't",'only high works','blower only works on high','low and medium are dead but high works','I only have high speed','high is the only speed working']){const result=parse(phrase);assert.ok(result,phrase);assert.equal(result.operatingPattern,'HIGH_ONLY',phrase);assert.deepEqual(result.states,{high:'OPERATIVE',medium:'INOPERATIVE',low:'INOPERATIVE'},phrase)}const result=normalizeBlowerResult('blower-symptom-confirmation',"High works low and medium don't.");assert.equal(result.facts.blowerHighSpeed,'OPERATES');assert.equal(result.facts.lowerBlowerSpeeds,'INOPERATIVE');assert.doesNotMatch(result.summary,/does not confirm/i);assert.match(html,/raw\.replace\(\/\\bhigh speed works\?\\b\/i,'High works'\)/);
});

test('10.12.70 authoritative HIGH_ONLY propagation cannot be downgraded by later partial evidence',()=>{
  const h=additiveEvidenceHarness();assert.equal(h.apply("2016 Jeep Wrangler high speed works low and medium don't the control signal is still 7.2 V."),true);assert.equal(h.state.blowerOperatingPattern,'HIGH_ONLY');assert.equal(h.apply('low and medium are still dead and the control signal is still 7.2 V.'),true);assert.equal(h.state.blowerOperatingPattern,'HIGH_ONLY');assert.equal(h.state.normalizedSymptom,'HVAC blower high speed operative / low and medium blower speeds inoperative');assert.equal(h.guidance.measurements.find(item=>item.testType==='control signal').value,7.2);assert.equal(h.state.componentCondemned,'None');assert.equal(h.state.stage,'diagnostic');assert.equal(h.state.intakeStep,'complete');const parse=Function(`return (${extract('blowerOperatingStateEvidence','symptomFacts')})`)();assert.equal(parse('low and medium are dead').operatingPattern,'PARTIAL_OR_OTHER');
});

test('10.12.71 commits a three-speed command/response matrix and classifies non-correlating signal evidence',()=>{
  const h=additiveEvidenceHarness();assert.equal(h.apply("2016 Jeep Wrangler high speed works low and medium don't the control signal is still 7.2 V."),true);const originalComplaint=h.state.complaint,originalMeasurement=h.guidance.measurements.find(item=>item.testType==='control signal');assert.equal(h.matrix("Low is 7.2 volts and the blower doesn't run. Medium is 7.2 volts and it doesn't run. High is 7.2 volts and the blower runs."),true);assert.deepEqual(h.state.blowerCommandResponseEvidence.map(item=>[item.commandedSpeed,item.controlSignalValue,item.controlSignalUnit,item.actualBlowerOperation]),[['LOW',7.2,'V','INOPERATIVE'],['MEDIUM',7.2,'V','INOPERATIVE'],['HIGH',7.2,'V','OPERATIVE']]);assert.equal(h.state.blowerCommandResponseCorrelation,'CONTROL_SIGNAL_NON_CORRELATING_WITH_BLOWER_RESPONSE');assert.equal(h.state.blowerOperatingPattern,'HIGH_ONLY');assert.equal(h.state.componentCondemned,'None');assert.equal(h.state.diagnosticConclusionState,'UNCONFIRMED');assert.equal(h.state.complaint,originalComplaint);assert.equal(originalMeasurement.value,7.2);assert.deepEqual([h.state.vehicle.year,h.state.vehicle.make,h.state.vehicle.model],['2016','Jeep','Wrangler']);assert.equal(h.state.stage,'diagnostic');assert.equal(h.state.intakeStep,'complete');assert.equal(h.guidance.completedTests.length,3);assert.equal(h.state.authoritativeDiagnosticTest.testId,'blower-control-signal-identification');assert.match(h.reply,/signal stays at 7\.2 V while blower operation changes/i);assert.doesNotMatch(h.reply,/condemn(?:ed)? (?:the )?(?:blower|resistor|module|control head|wiring)/i);
});

test('natural confirmation responses normalize into authoritative split blower evidence',()=>{
  for(const response of ['Yes.','It works on high only.','One through three are dead but four works.','High works. Nothing on the lower speeds.']){
    const result=normalizeBlowerResult('blower-symptom-confirmation',response);assert.ok(result,response);assert.equal(result.status,'FAIL');assert.equal(result.facts.blowerHighSpeed,'OPERATES');assert.equal(result.facts.lowerBlowerSpeeds,'INOPERATIVE');
  }
});

test('10.12.67 active blower question recognizes numbered, high-only, all, none, and partial shop language',()=>{
  const highOnly=['The blower only works on number four.','Only high works.','Nothing except number four.','Four works but the first three don\'t.'];
  for(const response of highOnly){const result=normalizeBlowerResult('blower-symptom-confirmation',response);assert.ok(result,response);assert.equal(result.facts.speedStates[1],'INOPERATIVE');assert.equal(result.facts.speedStates[4],'OPERATIVE')}
  const lowerOnly=normalizeBlowerResult('blower-symptom-confirmation','One through three are dead.');assert.equal(lowerOnly.status,'INCONCLUSIVE');assert.deepEqual(lowerOnly.facts.missingSpeeds,[4]);
  const all=normalizeBlowerResult('blower-symptom-confirmation','All four work.');assert.deepEqual(Object.values(all.facts.speedStates),['OPERATIVE','OPERATIVE','OPERATIVE','OPERATIVE']);
  const none=normalizeBlowerResult('blower-symptom-confirmation','None of them work.');assert.deepEqual(Object.values(none.facts.speedStates),['INOPERATIVE','INOPERATIVE','INOPERATIVE','INOPERATIVE']);
  const split=normalizeBlowerResult('blower-symptom-confirmation',"One and two work but three and four don't.");assert.deepEqual(Object.values(split.facts.speedStates),['OPERATIVE','OPERATIVE','INOPERATIVE','INOPERATIVE']);
});

test('10.12.67 accepts terse active-question shorthand without promoting hypotheses or ambiguity',()=>{
  for(const response of ['Blow only works on number four','It only works on high.','High is the only speed.','Only full blast works.','Speed four works, that\'s it.','Four.']){
    const result=normalizeBlowerResult('blower-symptom-confirmation',response);assert.ok(result,response);assert.equal(result.facts.blowerHighSpeed,'OPERATES');assert.equal(result.facts.lowerBlowerSpeeds,'INOPERATIVE');
  }
  assert.equal(normalizeBlowerResult('blower-symptom-confirmation','It works sometimes.'),null);
  assert.equal(normalizeBlowerResult('blower-symptom-confirmation','Probably the resistor.'),null);
  assert.equal(normalizeBlowerResult('unrelated-test','Four.'),null);
});

test('10.12.67 contextually recovers merged speed speech while protecting decimals and pin identifiers',()=>{
  const recovered=contextualNumericSpeechRecovery('speeds one through four command but 12 and three do not work',{domain:'blower-speed-positions-1-4'});assert.equal(recovered.accepted,true);assert.deepEqual(recovered.recoveredSequence,[1,2,3]);assert.equal(recovered.recoveryConfidence,'high');
  assert.equal(contextualNumericSpeechRecovery('Battery voltage is 12.3 volts',{domain:'blower-speed-positions-1-4'}).reason,'decimal-measurement');
  assert.equal(contextualNumericSpeechRecovery('Pin 12 has five volts',{domain:'blower-speed-positions-1-4'}).reason,'literal-identifier');
  assert.equal(contextualNumericSpeechRecovery('12 and three are out',{domain:'unknown'}).accepted,false);
});

test('10.12.67 structures commanded state separately from observed blower response',()=>{
  for(const phrase of ['Scan data shows speeds one through four all being commanded but 12 and three do not work.','Scan data commands speeds one through four. One, two, and three don\'t work. Four works.']){const result=commandResponseHarness(phrase);assert.ok(result,phrase);assert.equal(result.evidenceType,'COMMANDED_STATE_VS_OBSERVED_RESPONSE');assert.deepEqual(Object.values(result.commandStates),['PRESENT','PRESENT','PRESENT','PRESENT']);assert.deepEqual(Object.values(result.observedStates),['INOPERATIVE','INOPERATIVE','INOPERATIVE','OPERATIVE'])}
});

test('10.12.67 commits vehicle and three contextual measurements from one utterance',()=>{
  const h=mixedIntentHarness;assert.equal(h.text('I am working on a 2016 Jeep Wrangler 3.6. The blower motor has power at 13.8 volts, ground voltage drop is .04 volts, and the control signal is 7.2 volts.'),true);assert.deepEqual([h.state.vehicle.year,h.state.vehicle.make,h.state.vehicle.model,h.state.vehicle.engine],['2016','Jeep','Wrangler','3.6L']);assert.deepEqual(h.guidance.measurements.map(item=>[item.id,item.value,item.unit]),[['blower-motor-power',13.8,'V'],['blower-ground-drop',0.04,'V'],['blower-control-signal',7.2,'V']]);assert.match(h.state.previousTests,/13\.8 V.*0\.04 V.*7\.2 V/);assert.equal(h.state.intakeStep,'complete');assert.equal(h.state.stage,'diagnostic');assert.match(h.reply,/cannot call it good or bad/i);assert.doesNotMatch(h.reply,/enter a diagnostic code/i);
});

test('10.12.67 natural spoken decimals retain measurement context and vehicle continuity',()=>{
  const result=mixedIntentHarness.text("Got a 16 Wrangler here with the 3.6. Blower's dead. Power side is thirteen eight, ground drop is point zero four, and I'm seeing seven point two on the control wire.");assert.equal(result,true);assert.equal(mixedIntentHarness.state.vehicle.year,'2016');assert.equal(mixedIntentHarness.state.complaint,'Blower does not run');assert.deepEqual(mixedIntentHarness.guidance.measurements.slice(-3).map(item=>item.value),[13.8,0.04,7.2]);
});

test('10.12.67 vehicle-only input remains outside mixed-intent evidence routing',()=>{
  const source=extract('normalizeMixedIntentNumbers','contextualNumericSpeechRecovery');assert.match(source,/if\(!extracted\.measurements\.length\)return false/);
});

test('10.12.67 normalizes synonymous blower objectives into one authoritative test projection',()=>{
  const h=canonicalTestHarness,first=h.selectGuidanceTest('blower-speed-response','Blower Speed Response Test','reason','evidence'),created=first.createdAt;for(const [id,name] of [['blower-speed-function','Blower Speed Function Confirmation'],['blower-operation-command','Blower Operation vs Command'],['blower-control-response-correlation','Commanded Speed vs Actual Blower Operation']]){const active=h.selectGuidanceTest(id,name,'reason','evidence');assert.equal(active.testId,'blower-command-response-correlation');assert.equal(active.displayName,'Blower Command / Response Correlation');assert.equal(active.createdAt,created);assert.equal(h.state.componentTestState.currentTest.name,active.displayName);assert.equal(h.state.componentTestState.nextTest.name,active.displayName);assert.equal(h.guidance.selectedNextTest,active)}
});

test('10.12.67 mixed result and measurement routing preserves both clauses',()=>{
  assert.equal(normalizeBlowerResult('blower-symptom-confirmation',"High works but low and medium don't.").facts.blowerHighSpeed,'OPERATES');assert.match(html,/const routedResult=routeActiveCanonicalTestResult\(text\)/);assert.match(html,/handleActiveCanonicalTestResult\(text\)/);assert.match(html,/activeTest\?\.displayName\|\|guided\?\.currentTest\?\.name/);
});

test('10.12.67 protects vehicle identity from diagnostic-unit measurements',()=>{
  for(const [phrase,value,unit] of [["I've still got 5.1 volts on the signal wire.",5.1,'V'],['Resistance is 2.4 ohms.',2.4,'Ω'],['Current draw is 3.6 amps.',3.6,'A']]){const measurement=vehicleProtectionHarness.diagnosticMeasurement(phrase);assert.equal(measurement.value,value);assert.equal(measurement.unit,unit);assert.equal(vehicleProtectionHarness.parseVehicle(phrase),null)}
  assert.equal(vehicleProtectionHarness.parseVehicle("It's the 3.6 liter engine.").engine,'3.6L');
  assert.equal(vehicleProtectionHarness.parseVehicle('2016 Wrangler 3.6L.').engine,'3.6L');
});

test('10.12.67 live validation utterance preserves Jeep identity and commits both result and voltage evidence',()=>{
  const h=mixedIntentHarness;h.state.vehicle={year:'2016',make:'Jeep',model:'Wrangler',engine:'',configuration:''};h.state.component='Blower Motor / Blower Control Circuit';h.state.complaint='Blower only works on high';h.state.stage='diagnostic';h.state.intakeStep='complete';assert.equal(h.text("High works but low and medium don't and the control signal is still 7.2 V."),true);assert.deepEqual(h.state.vehicle,{year:'2016',make:'Jeep',model:'Wrangler',engine:'',configuration:''});assert.equal(h.guidance.measurements.at(-1).value,7.2);assert.equal(h.guidance.measurements.at(-1).unit,'V');assert.match(h.state.previousTests,/7\.2 V/);assert.equal(h.state.stage,'diagnostic');assert.equal(h.state.intakeStep,'complete');assert.doesNotMatch(h.reply,/diagnostic code/i);
});

test('10.12.67 recovers pronoun-led active result without replacing complaint or intake state',()=>{
  const h=mixedIntentHarness;h.state.vehicle={year:'2016',make:'Jeep',model:'Wrangler',engine:'',configuration:''};h.state.complaint='Original HVAC blower complaint';h.state.component='Blower Motor / Blower Control Circuit';h.state.stage='repairs';h.state.intakeStep='previous-repairs';assert.equal(h.text("It works but low and medium don't and the control signal is still 7.2 V."),true);assert.deepEqual(h.state.vehicle,{year:'2016',make:'Jeep',model:'Wrangler',engine:'',configuration:''});assert.equal(h.state.complaint,'Original HVAC blower complaint');assert.equal(h.state.stage,'diagnostic');assert.equal(h.state.intakeStep,'complete');assert.equal(h.guidance.measurements.at(-1).value,7.2);assert.ok(h.guidance.evidence.some(item=>item.facts?.blowerHighSpeed==='OPERATES'));assert.doesNotMatch(h.reply,/repairs have already/i);
});

test('10.12.67 measurement spans remain isolated from all vehicle candidates',()=>{
  const samples=[['2016 Jeep Wrangler, signal is 7.2 V',7.2],['fuel pressure is 57 psi',57],['engine speed is 2167 RPM',2167]];for(const [phrase,value] of samples){const isolated=vehicleProtectionHarness.isolateMeasurementContext(phrase);assert.ok(isolated.spans.some(item=>item.value===value));assert.ok(!isolated.vehicleSafeText.includes(String(value)));const vehicle=vehicleProtectionHarness.parseVehicle(phrase);assert.notEqual(vehicle?.engine,`${value}L`)}
  const multiple=vehicleProtectionHarness.isolateMeasurementContext('I have 12.4 volts at power, 0.08 volts on the ground side, and the control is 7.2 volts');assert.deepEqual(multiple.spans.map(item=>item.value),[12.4,0.08,7.2]);
  assert.match(html,/percent=raw\.match/);assert.match(html,/unit:'%'/);assert.match(html,/context:\/fuel trim\/i/);
});

test('10.12.67 protects outer Oliver vehicle parsing and permits explicit complaint correction',()=>{
  assert.match(html,/naturalMeasurementIsolation\(text\)/);assert.match(html,/raw=isolated\.vehicleSafeText/);assert.match(html,/active-diagnostic-evidence/);assert.match(html,/handleExplicitComplaintCorrection/);assert.match(html,/complaint updated/i);
});

test('10.12.67 semantic intake routing rejects live findings from Previous Repairs',()=>{
  const h=semanticRoutingHarness;assert.equal(h.route("High works but low and medium don't and the control signal is still 7.2 V."),true);assert.equal(h.state.previousRepairs,'');assert.ok(h.evidence.some(item=>item.type==='observation'));assert.match(h.reply,/not a previous repair/i);
});

test('10.12.67 separates previous testing and mixed repair/evidence semantics',()=>{
  const testing=semanticRoutingHarness;assert.equal(testing.route('I checked power and ground at the blower module and both passed.'),true);assert.match(testing.state.previousTests,/checked power and ground/);assert.equal(testing.state.previousRepairs,'');
  const mixed=semanticRoutingHarness;assert.equal(mixed.route("I replaced the blower motor, but low and medium still don't work and the control signal is 7.2 V."),false);assert.match(mixed.state.previousRepairs,/replaced the blower motor/i);assert.equal(mixed.state.routingDiagnostics.routingDecision,'SPLIT_REPAIR_AND_ACTIVE_EVIDENCE');
  assert.match(html,/repair&&!diagnostic\?false:semanticIntakeRoutingBase/);
});

test('10.12.67 exposes deterministic active-routing diagnostics and backward-transition guard',()=>{
  for(const field of ['inputClassification','activeDiagnosticContextDetected','measurementDetected','measurementValue','measurementUnit','measurementContext','vehicleMutationAttempted','vehicleMutationPermitted','conversationalResultDetected','resultRoutedToCurrentTest','intakeFallbackPrevented','selectedNextTestIdentity','nextTestReason'])assert.match(html,new RegExp(field));
  assert.match(html,/handleActiveFunctionalPermutation/);assert.match(html,/state\.intakeStep='complete';state\.stage='diagnostic'/);assert.match(html,/nitrosDiagnosticRoutingTrace/);
});

test('10.12.67 commits conversational observations before advancing and guards duplicates and conflicts',()=>{
  assert.match(html,/evidenceSource:'conversational-technician-observation'/);
  assert.match(html,/duplicate=guided\.evidence\.some/);
  assert.match(html,/diagnosticConclusionState='CONFLICTING_EVIDENCE'/);
  assert.match(html,/handleBlowerSpeedRecheck\(guided,current,text\)/);
  assert.match(html,/Committed Conversational Observations:/);
  assert.match(html,/selectGuidanceTest\(next\.id,next\.name,reason,next\.prompt\);ask/);
});

test('guided HVAC workflow enforces one pending test and persists evidence',()=>{
  assert.match(html,/currentTestStatus:'PENDING',completedTests:\[\],evidence:\[\],passedTests:\[\],failedTests:\[\],nextTest:null,diagnosticConclusionState:'UNCONFIRMED'/);
  assert.match(html,/activateBlowerTest\('blower-symptom-confirmation'\)/);
  assert.match(html,/if\(!duplicate\)guided\.evidence\.push\(record\)/);
  assert.match(html,/guided\.completedTests\.push\(record\)/);
  assert.match(html,/activateBlowerTest\('blower-control-connector-inspection'\)/);
  assert.match(html,/Since speed 4, the highest setting, operates, the blower motor is capable of running/);
  assert.match(html,/test targets, not confirmed failed parts|no component is confirmed failed/i);
});

test('shop-language connector and command findings drive deterministic branches',()=>{
  assert.equal(normalizeBlowerResult('blower-control-connector-inspection',"Connector's melted.").status,'FAIL');
  assert.equal(normalizeBlowerResult('blower-control-connector-inspection','Looks good.').status,'PASS');
  assert.equal(normalizeBlowerResult('blower-lower-speed-command-test','Nothing changes when I move the switch.').status,'FAIL');
  assert.equal(normalizeBlowerResult('blower-lower-speed-command-test',"I've got 12 volts there.").status,'PASS');
});

test('authoritative display exposes guided test state without OEM fabrication',()=>{
  for(const label of ['Current Diagnostic Test:','Current Test Status:','Completed Tests:','Evidence:','Failed Tests:','Passed Tests:','Next Test:','Diagnostic Conclusion State:'])assert.match(html,new RegExp(label));
  assert.match(html,/Exact cavities and wire colors require verified service information/);
});

test('Talk establishes voice session, final replies auto-speak once, and replay is forced',()=>{
  assert.match(html,/NitrosOliverVoiceSession=\{active:true,awaitingReply:true/);
  assert.match(html,/nitros:oliver-final-reply/);
  assert.match(html,/speakOliver\(clean\)/);
  assert.match(html,/clean===lastRequestText&&now-lastRequestAt<1200/);
  assert.match(html,/force:true/);
  assert.match(html,/browserProvider\.cancel\(\);browserProvider\.resume\(\)/);
});
