import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('const GUIDED_WORKFLOWS=');
const end=html.indexOf('function add(',start);
assert.ok(start>=0&&end>start,'AX guided-test engine was not found');
const source=html.slice(start,end);

function harness(activeDtc='P0340'){
  return Function(`
    let state={schema:1,id:'CASE-PRESERVE-342',activeDtc:${JSON.stringify(activeDtc)},dtcs:[${JSON.stringify(activeDtc)}],stage:'diagnostic',diagnosticTestState:null,liveData:'Prior verified evidence',verifiedRepairInformation:null,repairInformationRequired:false,repairInformationLoaded:false,repairInformationSource:'',repairInformationLoadedAt:'',repairInformationEvidence:[],lastReply:'',history:[{who:'Oliver',text:'Prior evidence',at:'2026-08-09T11:00:00.000Z'}],vehicle:{year:'2012',make:'Toyota',model:'Camry',engine:''}};
    const responses=[];
    function workflowName(){return 'Camshaft Position Circuit'}
    function vehicleLabel(){return [state.vehicle.year,state.vehicle.make,state.vehicle.model,state.vehicle.engine].filter(Boolean).join(' ')}
    function ask(text){state.lastReply=text;responses.push(text)}
    ${source}
    return {state,responses,ensureGuidedState,handleGuidedFinding,handleRepairInformationImport,interpretFinding,normalizeFinding,classifyFindingIntent,repairDiagnosticText,FINDING_INTENT,GUIDED_WORKFLOWS};
  `)();
}

test('AU DTC and vehicle canonicalization remains present in BE',()=>{
  assert.match(html,/const DTC_PATTERN=.*\[0-9A-FO\]/);
  assert.match(html,/replace\(\/O\/g,'0'\)/);
  assert.match(html,/function parseVehicle\(text\)/);
});

test('power and ground passes persist and advance one test at a time',()=>{
  const h=harness();h.ensureGuidedState();
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-power-reference');
  h.handleGuidedFinding('Found 5v on the cam power side');
  assert.equal(h.state.diagnosticTestState.tests[0].status,'pass');
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-ground');
  assert.match(h.responses.at(-1),/Next we'll test Cam Sensor Ground/i);
  assert.doesNotMatch(h.responses.at(-1),/signal.*correlation/i);
  h.handleGuidedFinding('Ground is good');
  assert.equal(h.state.diagnosticTestState.tests[0].status,'pass');
  assert.equal(h.state.diagnosticTestState.tests[1].status,'pass');
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-signal');
  assert.match(h.responses.at(-1),/Next we'll test Cam Signal Activity/i);
});

test('signal failure commits and advances to the next pending required test',()=>{
  const h=harness();h.ensureGuidedState();
  h.handleGuidedFinding('Found 5v on the cam power side');
  h.handleGuidedFinding('Ground checks out');
  h.handleGuidedFinding('No signal');
  const guided=h.state.diagnosticTestState;
  assert.deepEqual(guided.tests.slice(0,3).map(item=>item.status),['pass','pass','fail']);
  assert.equal(guided.currentTestId,'cam-correlation');
  assert.match(h.responses.at(-1),/cam and crank correlation/i);
  assert.doesNotMatch(h.responses.at(-1),/pin \d|wire color|connector [A-Z0-9]/i);
});

test('ambiguous voltage finding remains on the current test',()=>{
  const h=harness();h.ensureGuidedState();h.handleGuidedFinding('I got something there');
  assert.equal(h.state.diagnosticTestState.tests[0].status,'inconclusive');
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-power-reference');
  assert.match(h.responses.at(-1),/actual measurement/i);
});

test('spoken and typed voltage findings normalize equivalently',()=>{
  const h=harness(),testDef=h.GUIDED_WORKFLOWS.P0340.tests[0];
  const voice=h.interpretFinding(testDef,'Found five volts on the cam power side');
  const typed=h.interpretFinding(testDef,'Found 5v on the cam power side');
  assert.equal(voice.value,typed.value);
  assert.equal(voice.unit,typed.unit);
  assert.equal(voice.result,typed.result);
});

test('guided state survives the same JSON persistence used by the authoritative case',()=>{
  const h=harness();h.ensureGuidedState();h.handleGuidedFinding('Found 5v on the cam power side');h.handleGuidedFinding('Ground is good');
  const restored=JSON.parse(JSON.stringify(h.state));
  assert.equal(restored.vehicle.model,'Camry');
  assert.equal(restored.activeDtc,'P0340');
  assert.deepEqual(restored.diagnosticTestState.tests.slice(0,2).map(item=>item.status),['pass','pass']);
  assert.equal(restored.diagnosticTestState.currentTestId,'cam-signal');
});

test('BE engine is authoritative, guarded, and exposes compact debug state',()=>{
  assert.match(html,/diagnosticTestState:null/);
  assert.match(html,/localStorage\.setItem\(STATE_KEY,JSON\.stringify\(state\)\)/);
  assert.match(html,/\['diagnostic','circuit-isolation','mechanical-diagnosis'\]\.includes\(state\.stage\).*handleGuidedFinding\(text\)/);
  assert.match(html,/verified repair information/);
  for(const field of ['avNormalizedFinding','avMatchedTestId','avInterpretedValue','avUnit','avResult','avNextTestId'])assert.match(html,new RegExp(field));
});

function atGround(){const h=harness();h.ensureGuidedState();h.handleGuidedFinding('I measured 5 V');assert.equal(h.state.diagnosticTestState.currentTestId,'cam-ground');return h}

test('expected ground specification does not mutate or advance the test state',()=>{
  const h=atGround(),before=JSON.stringify(h.state.diagnosticTestState);
  h.handleGuidedFinding('I should have less than 0.1 V on the ground.');
  assert.equal(JSON.stringify(h.state.diagnosticTestState),before);
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-ground');
  assert.match(h.responses.at(-1),/target specification.*actual measurement/i);
  assert.match(h.responses.at(-1),/≤ 0\.1 V/);
});

test('actual good and bad ground readings evaluate only after measurement intent',()=>{
  const good=atGround();good.handleGuidedFinding('I measured 0.04 V.');
  assert.equal(good.state.diagnosticTestState.tests[1].status,'pass');
  assert.equal(good.state.diagnosticTestState.currentTestId,'cam-signal');
  const bad=atGround();bad.handleGuidedFinding('I measured 0.42 V.');
  assert.equal(bad.state.diagnosticTestState.tests[1].status,'fail');
  assert.equal(bad.state.diagnosticTestState.currentTestId,'cam-signal');
});

test('questions, numbered specifications, procedures, and uncertain claims cannot complete a test',()=>{
  for(const input of ['Should I have less than 0.1 volts?','Should be 5 V.','The specification is 0.1 volts maximum.','I need less than 0.1 V.','Anything under 100 mV is good.','I should backprobe the connector.','Looks okay.']){
    const h=atGround(),before=JSON.stringify(h.state.diagnosticTestState);h.handleGuidedFinding(input);
    assert.equal(JSON.stringify(h.state.diagnosticTestState),before,input);
    assert.equal(h.state.diagnosticTestState.currentTestId,'cam-ground',input);
  }
});

test('completed ground result freezes reply identity before advancing to signal',()=>{
  const h=atGround();h.handleGuidedFinding('Should I have less than 0.1 V on the ground?');
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-ground');
  h.handleGuidedFinding('I measured 0.04 V');
  const completed=h.state.diagnosticTestState.lastCompletedResult;
  assert.equal(completed.testId,'cam-ground');
  assert.equal(completed.testName,'Cam Sensor Ground');
  assert.equal(completed.workflowName,'Camshaft Position Circuit');
  assert.equal(completed.expectedResult,'0.1 V');
  assert.equal(completed.comparator,'<=');
  assert.equal(completed.actualObservedMeasurement,0.04);
  assert.equal(completed.status,'pass');
  assert.equal(completed.nextTestId,'cam-signal');
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-signal');
  assert.match(h.state.lastReply,/0\.04 V\. Cam Sensor Ground passes/);
  assert.match(h.state.lastReply,/Next we'll test Cam Signal Activity/);
  assert.doesNotMatch(h.state.lastReply,/Cam Signal Activity is inconclusive/i);
});

test('failing ground reply also uses the frozen completed-test identity',()=>{
  const h=atGround();h.handleGuidedFinding('I measured 0.4 V');
  const completed=h.state.diagnosticTestState.lastCompletedResult;
  assert.equal(completed.testId,'cam-ground');assert.equal(completed.status,'fail');
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-signal');
  assert.match(h.state.lastReply,/Cam Sensor Ground fails/);
  assert.doesNotMatch(h.state.lastReply,/Ground Circuit Isolation is inconclusive/i);
});

test('committed AX power failure cannot be downgraded while parked on isolation',()=>{
  const h=harness(),guided=h.ensureGuidedState(),power=guided.tests.find(item=>item.id==='cam-power-reference'),isolation=guided.tests.find(item=>item.id==='cam-power-isolation');
  Object.assign(power,{status:'fail',technicianFinding:'No voltage',interpretedValue:0,unit:'V',timestamp:'2026-08-09T12:00:00.000Z',source:'technician-input'});guided.currentTestId='cam-power-isolation';guided.nextRecommendedTest='cam-power-isolation';
  h.handleGuidedFinding('I measured 5.0 V on the power side.');
  assert.equal(power.status,'fail');
  assert.equal(isolation.status,'in_progress');
  assert.equal(guided.lastCompletedResult.testId,'cam-power-reference');
  assert.equal(guided.lastCompletedResult.status,'fail');
  assert.equal(guided.currentTestId,'cam-ground');
  assert.match(h.state.lastReply,/Power\/Reference fails/);
  assert.match(h.state.lastReply,/cam sensor ground/i);
  assert.doesNotMatch(h.state.lastReply,/inconclusive|actual measurement|Power\/Reference Feed Isolation/i);
});

test('rapid duplicate delivery cannot reinterpret one reading against the next test',()=>{
  const h=atGround();h.handleGuidedFinding('I measured 0.04 V');const reply=h.state.lastReply,count=h.responses.length;
  h.handleGuidedFinding('I measured 0.04 V');
  assert.equal(h.responses.length,count);
  assert.equal(h.state.lastReply,reply);
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-signal');
  assert.equal(h.state.diagnosticTestState.tests[2].status,'in_progress');
});

test('natural spoken readings and qualitative signal observations remain valid',()=>{
  const h=atGround();h.handleGuidedFinding("I'm getting forty millivolts.");
  assert.equal(h.state.diagnosticTestState.tests[1].interpretedValue,0.04);
  assert.equal(h.state.diagnosticTestState.tests[1].status,'pass');
  h.handleGuidedFinding('The signal is switching.');
  assert.equal(h.state.diagnosticTestState.tests[2].status,'pass');
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-correlation');
});

test('natural decimal phrases normalize as actual measurements',()=>{
  const h=harness(),ground=h.GUIDED_WORKFLOWS.P0340.tests[1];
  for(const input of ['Point zero four volts.','I got .04.','Meter says .04 volts.','Zero point zero four.']){
    const result=h.interpretFinding(ground,input);assert.equal(result.intent,h.FINDING_INTENT.ACTUAL,input);assert.equal(result.value,0.04,input);assert.equal(result.result,'pass',input);
  }
  const power=h.interpretFinding(h.GUIDED_WORKFLOWS.P0340.tests[0],"I've got five point one volts.");
  assert.equal(power.value,5.1);assert.equal(power.result,'pass');
});

test('diagnostic text repair produces clean Unicode and preserves engineering symbols',()=>{
  const h=harness();
  assert.equal(h.repairDiagnosticText('â€œ5.2 Vâ€ â€” â‰¤ 0.1 V'),'“5.2 V” — ≤ 0.1 V');
  const clean='≥ ± – — “ ” ° Ω µ 40 mV 0–5 V';
  assert.equal(h.repairDiagnosticText(clean),clean);
  assert.doesNotMatch(h.responses.join(' '),/Ã¢â‚¬|â€œ|â€|�/);
});

function atCorrelation(){const h=harness(),guided=h.ensureGuidedState();for(const id of ['cam-power-reference','cam-ground','cam-signal']){const record=guided.tests.find(item=>item.id===id);Object.assign(record,{status:'pass',technicianFinding:'Verified',timestamp:'2026-08-09T12:00:00.000Z',source:'technician-input'})}guided.currentTestId='cam-correlation';guided.nextRecommendedTest='cam-correlation';return h}

test('cam/crank correlation technician-language pass variants commit and reach the repair-information gate once',()=>{
  const inputs=['Cam and crank are in synced and passed','Cam and crank are in sync','Cam and crank are synced','Cam crank correlation passed','They line up correctly','Cam and crank signals are synchronized correctly while cranking','Cam and crank signals are synchronize correctly while cranking','correlation looks correct','Cam and crank signal is synchronized','They are synchronized while cranking','The cam and crank signals match','Cam and crank correlate','Cam and crank correlation is good','Timing correlation is good'];
  for(const input of inputs){const h=atCorrelation();h.handleGuidedFinding(input);const guided=h.state.diagnosticTestState,correlation=guided.tests.find(item=>item.id==='cam-correlation'),gate=guided.tests.find(item=>item.id==='verified-repair-information-required');assert.equal(correlation.status,'pass',input);assert.equal(guided.currentTestId,'verified-repair-information-required',input);assert.equal(gate.status,'pending',input);assert.deepEqual(guided.tests.slice(0,3).map(item=>item.status),['pass','pass','pass'],input);assert.equal(guided.lastCompletedResult.testId,'cam-correlation',input);assert.match(h.state.lastReply,/Cam\/Crank Correlation passes/,input);assert.match(h.state.lastReply,/Verified Repair Information Required/,input);assert.match(h.state.lastReply,/Load the applicable wiring diagram or diagnostic procedure/i,input);assert.doesNotMatch(h.state.lastReply,/Further Circuit\/Component Isolation|actual measurement or a clear pass\/fail/i,input)}
});

test('correlation negation takes precedence and cannot be classified as pass',()=>{
  const inputs=['Cam and crank are not in sync','Cam and crank are out of sync','Cam crank correlation failed',"They don't line up",'Cam and crank do not correlate','cam and crank are not synchronized','correlation is incorrect','cam and crank timing is off','the relationship is wrong',"the signals don't match","Cam and crank aren't synced",'Cam and crank did not pass','Correlation is not good'];
  for(const input of inputs){const h=atCorrelation();h.handleGuidedFinding(input);const guided=h.state.diagnosticTestState,correlation=guided.tests.find(item=>item.id==='cam-correlation');assert.equal(correlation.status,'fail',input);assert.notEqual(correlation.status,'pass',input);assert.equal(guided.currentTestId,'cam-mechanical-isolation',input);assert.equal(h.state.stage,'mechanical-diagnosis',input);assert.match(h.state.lastReply,/Cam\/Crank Correlation fails/,input)}
});

test('ambiguous correlation response remains uncommitted on the current test',()=>{
  for(const input of ["maybe they're okay",'I checked the cam and crank',"I'm looking at the correlation"]){const h=atCorrelation(),guided=h.state.diagnosticTestState,correlation=guided.tests.find(item=>item.id==='cam-correlation');h.handleGuidedFinding(input);assert.equal(correlation.status,'in_progress',input);assert.equal(guided.currentTestId,'cam-correlation',input);assert.match(h.state.lastReply,/do not have a confirmed result/i,input)}
});

test('explicit correlation pass and fail observations retain deterministic routing',()=>{
  const passed=atCorrelation();passed.handleGuidedFinding('Correlation passed');assert.equal(passed.state.diagnosticTestState.tests.find(test=>test.id==='cam-correlation').status,'pass');assert.equal(passed.state.diagnosticTestState.currentTestId,'verified-repair-information-required');
  const failed=atCorrelation();failed.handleGuidedFinding('Correlation failed');assert.equal(failed.state.diagnosticTestState.tests.find(test=>test.id==='cam-correlation').status,'fail');assert.equal(failed.state.diagnosticTestState.currentTestId,'cam-mechanical-isolation');
});

test('repeated correlation pass observation cannot duplicate or double-advance',()=>{
  const h=atCorrelation(),input='Cam and crank signals are synchronize correctly while cranking';h.handleGuidedFinding(input);const guided=h.state.diagnosticTestState,reply=h.state.lastReply,count=h.responses.length;h.handleGuidedFinding(input);assert.equal(h.responses.length,count);assert.equal(h.state.lastReply,reply);assert.equal(guided.currentTestId,'verified-repair-information-required');assert.equal(guided.tests.filter(item=>item.id==='cam-correlation'&&item.status==='pass').length,1);assert.equal(guided.tests.find(item=>item.id==='verified-repair-information-required').status,'pending')
});

test('post-correlation PASS keeps four passes and waits for verified repair information without fabrication',()=>{
  const h=atCorrelation();h.handleGuidedFinding('Cam and crank signals are synchronized correctly while cranking');const guided=h.state.diagnosticTestState,correlation=guided.tests.find(item=>item.id==='cam-correlation'),gate=guided.tests.find(item=>item.id==='verified-repair-information-required');assert.equal(correlation.status,'pass');assert.equal(gate.status,'pending');assert.equal(guided.currentTestId,'verified-repair-information-required');assert.equal(h.state.stage,'circuit-isolation');assert.equal(guided.lastCompletedResult.testName,'Cam/Crank Correlation');assert.deepEqual(guided.tests.slice(0,4).map(item=>item.status),['pass','pass','pass','pass']);assert.match(h.state.lastReply,/Load the applicable wiring diagram or diagnostic procedure/i);assert.doesNotMatch(h.state.lastReply,/Further Circuit\/Component Isolation|pin \d|connector [A-Z0-9]|wire color|\d+(?:\.\d+)?\s*(?:V|ohm)/i)
});

test('P0342 correlation PASS persists evidence and atomically enters the verified-information gate',()=>{
  for(const input of ['Cam and crank correlation passes the signals are synchronized','Cam and crank are synchronized','Correlation looks good']){
    const h=harness('P0342'),before={id:h.state.id,vehicle:structuredClone(h.state.vehicle),dtcs:[...h.state.dtcs],history:structuredClone(h.state.history),liveData:h.state.liveData};
    h.ensureGuidedState();h.handleGuidedFinding(input);
    const guided=h.state.diagnosticTestState,correlation=guided.tests.find(item=>item.id==='cam-correlation'),gate=guided.tests.find(item=>item.id==='verified-repair-information-required');
    assert.equal(correlation.status,'pass',input);assert.equal(correlation.technicianFinding,input,input);assert.equal(correlation.source,'technician-input',input);
    assert.equal(guided.currentTestId,'verified-repair-information-required',input);assert.equal(gate.status,'pending',input);assert.equal(h.state.stage,'circuit-isolation',input);
    assert.match(h.state.lastReply,/Verified Repair Information Required/,input);assert.match(h.state.lastReply,/Load the applicable wiring diagram or diagnostic procedure/i,input);assert.doesNotMatch(h.state.lastReply,/Finding recorded|Continue with the next verified measurement/i,input);
    assert.equal(h.state.id,before.id,input);assert.deepEqual(h.state.vehicle,before.vehicle,input);assert.deepEqual(h.state.dtcs,before.dtcs,input);assert.deepEqual(h.state.history,before.history,input);assert.match(h.state.liveData,/Prior verified evidence/,input);
  }
});

test('P0342 correlation FAIL and ambiguity cannot take the PASS isolation route',()=>{
  const failed=harness('P0342');failed.ensureGuidedState();failed.handleGuidedFinding('Cam and crank correlation fails, they are out of sync');
  assert.equal(failed.state.diagnosticTestState.tests[0].status,'fail');assert.equal(failed.state.diagnosticTestState.currentTestId,'cam-mechanical-isolation');assert.equal(failed.state.stage,'mechanical-diagnosis');
  const ambiguous=harness('P0342');ambiguous.ensureGuidedState();ambiguous.handleGuidedFinding("I'm not sure if cam and crank are synchronized");
  assert.equal(ambiguous.state.diagnosticTestState.tests[0].status,'in_progress');assert.equal(ambiguous.state.diagnosticTestState.currentTestId,'cam-correlation');assert.equal(ambiguous.state.stage,'diagnostic');
});

test('typed and normalized speech P0342 findings use the same canonical transition',()=>{
  const typed=harness('P0342'),voice=harness('P0342');typed.ensureGuidedState();voice.ensureGuidedState();
  typed.handleGuidedFinding('Cam and crank are synchronized');voice.handleGuidedFinding(voice.normalizeFinding('Cam and crank are synchronized'));
  for(const h of [typed,voice]){assert.equal(h.state.diagnosticTestState.lastCompletedResult.status,'pass');assert.equal(h.state.diagnosticTestState.currentTestId,'verified-repair-information-required');assert.equal(h.state.stage,'circuit-isolation')}
});

test('verified DTC-applicable repair information selects a concrete isolation test and accepts only its evidence',()=>{
  const h=atCorrelation();h.state.verifiedRepairInformation={source:'Verified OEM procedure',isolationTests:[{id:'cmp-signal-continuity',verified:true,dtcs:['P0340'],vehicle:'2012 Toyota Camry',name:'CMP Signal Circuit Continuity',componentOrCircuit:'Check the CMP signal circuit continuity',testLocation:'the two service-information test points',method:'the continuity method and connector conditions in the loaded procedure',criterion:'0.5 Ω maximum from the verified procedure',comparator:'<=',maximum:0.5,requestedResult:'Tell me the measured resistance with units.'}]};
  h.handleGuidedFinding('Cam and crank correlation passes');const guided=h.state.diagnosticTestState,selected=guided.selectedIsolationTest,record=guided.tests.find(item=>item.id===selected.id);
  assert.equal(guided.currentTestId,'verified-cmp-signal-continuity');assert.equal(record.status,'in_progress');assert.equal(h.state.stage,'circuit-isolation');assert.match(h.state.lastReply,/CMP signal circuit continuity/);assert.match(h.state.lastReply,/two service-information test points/);assert.match(h.state.lastReply,/0\.5 Ω maximum/);assert.doesNotMatch(h.state.lastReply,/Further Circuit\/Component Isolation/);
  const before=JSON.stringify(guided);h.handleGuidedFinding('I checked something else');assert.equal(JSON.stringify(guided),before);assert.match(h.state.lastReply,/actual measurement or direct observation/i);
  h.handleGuidedFinding('I measured 0.4 ohms');assert.equal(record.status,'pass');assert.equal(record.interpretedValue,0.4);assert.equal(record.unit,'Ω');assert.equal(guided.currentTestId,'verified-repair-information-required');assert.equal(guided.tests.find(item=>item.id==='verified-repair-information-required').status,'pending');
});

test('repair-information gate and completed PASS history survive JSON reload',()=>{
  const h=atCorrelation();h.handleGuidedFinding('Cam and crank are synchronized');const restored=JSON.parse(JSON.stringify(h.state));assert.equal(restored.stage,'circuit-isolation');assert.equal(restored.diagnosticTestState.currentTestId,'verified-repair-information-required');assert.equal(restored.diagnosticTestState.tests.find(item=>item.id==='verified-repair-information-required').status,'pending');assert.deepEqual(restored.diagnosticTestState.tests.slice(0,4).map(item=>item.status),['pass','pass','pass','pass'])
});

test('BD sufficient imported repair information attaches to the active case and resumes exactly once',()=>{
  const h=atCorrelation();h.handleGuidedFinding('Cam and crank are synchronized');const before={id:h.state.id,vehicle:structuredClone(h.state.vehicle),dtc:h.state.activeDtc,workflow:h.state.diagnosticTestState.workflowId,passes:h.state.diagnosticTestState.tests.slice(0,4).map(test=>test.status)};
  const detail={kind:'text-data',fileName:'camry-p0340-procedure.json',importedAt:'2026-08-09T15:00:00.000Z',parsedData:{schema:'nitros-verified-repair-information',source:'Verified service procedure',dtcs:['P0340'],vehicle:'2012 Toyota Camry',isolationTests:[{id:'cmp-continuity',verified:true,name:'CMP Signal Circuit Continuity',componentOrCircuit:'Check CMP signal circuit continuity',testLocation:'verified test point A to verified test point B',method:'Key OFF continuity test using the imported connector conditions',criterion:'0.5 Ω maximum',comparator:'<=',maximum:0.5,requestedResult:'Tell me the measured resistance with units.'}]}};
  assert.equal(h.handleRepairInformationImport(detail),true);const guided=h.state.diagnosticTestState,gate=guided.tests.find(test=>test.id==='verified-repair-information-required');
  assert.equal(h.state.id,before.id);assert.deepEqual(h.state.vehicle,before.vehicle);assert.equal(h.state.activeDtc,before.dtc);assert.equal(guided.workflowId,before.workflow);assert.deepEqual(guided.tests.slice(0,4).map(test=>test.status),before.passes);
  assert.equal(h.state.repairInformationRequired,false);assert.equal(h.state.repairInformationLoaded,true);assert.equal(h.state.repairInformationSource,'Verified service procedure');assert.equal(h.state.repairInformationLoadedAt,detail.importedAt);assert.equal(h.state.verifiedRepairInformation.caseId,before.id);assert.equal(h.state.repairInformationEvidence.at(-1).usable,true);assert.equal(gate.status,'pass');
  assert.equal(guided.currentTestId,'verified-cmp-continuity');assert.match(h.state.lastReply,/Repair information loaded\. Continuing the CMP circuit diagnosis/);assert.match(h.state.lastReply,/verified test point A to verified test point B/);assert.doesNotMatch(h.state.lastReply,/Power\/Reference|Cam Sensor Ground|Signal Activity|Cam\/Crank Correlation passes/);
  const current=guided.currentTestId,count=guided.tests.length;assert.equal(h.handleRepairInformationImport(detail),false);assert.equal(guided.currentTestId,current);assert.equal(guided.tests.length,count);
});

test('BD insufficient import remains required, preserves history, and records case evidence',()=>{
  const h=atCorrelation();h.handleGuidedFinding('Correlation looks good');const before=JSON.stringify(h.state.diagnosticTestState.tests.slice(0,4)),caseId=h.state.id;
  assert.equal(h.handleRepairInformationImport({kind:'pdf-attachment',fileName:'partial.pdf',importedAt:'2026-08-09T15:05:00.000Z',usableContent:false,missingInformation:['Readable connector/test-point details','Expected result or specification']}),true);
  assert.equal(h.state.id,caseId);assert.equal(JSON.stringify(h.state.diagnosticTestState.tests.slice(0,4)),before);assert.equal(h.state.diagnosticTestState.currentTestId,'verified-repair-information-required');assert.equal(h.state.repairInformationRequired,true);assert.equal(h.state.repairInformationLoaded,false);assert.equal(h.state.repairInformationLoadedAt,'');assert.equal(h.state.repairInformationEvidence.at(-1).usable,false);assert.match(h.state.lastReply,/does not contain enough verified CMP isolation information/);assert.match(h.state.lastReply,/Readable connector\/test-point details, Expected result or specification/);
});

test('BD authoritative repair-information fields render and New Case clears them',()=>{
  for(const field of ['repairInformationRequired','repairInformationLoaded','repairInformationSource','repairInformationLoadedAt','repairInformationEvidence'])assert.match(html,new RegExp(field));
  assert.match(html,/Repair Information: \$\{repairInformation\}/);assert.match(html,/function reset\(\).*state=blank\(\)/);assert.match(html,/importRepairInformation:handleRepairInformationImport/);
});
