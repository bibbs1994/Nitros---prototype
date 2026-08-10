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
    let state={schema:1,id:'CASE-PRESERVE-342',activeDtc:${JSON.stringify(activeDtc)},dtcs:[${JSON.stringify(activeDtc)}],stage:'diagnostic',diagnosticTestState:null,liveData:'Prior verified evidence',verifiedRepairInformation:null,repairInformation:{status:'required',source:'',verifiedAt:'',evidenceReference:null},pendingRepairInformation:null,repairInformationRequired:false,repairInformationLoaded:false,repairInformationSource:'',repairInformationLoadedAt:'',repairInformationEvidence:[],lastReply:'',history:[{who:'Oliver',text:'Prior evidence',at:'2026-08-09T11:00:00.000Z'}],vehicle:{year:'2012',make:'Toyota',model:'Camry',engine:''}};
    const responses=[];
    function workflowName(){return 'Camshaft Position Circuit'}
    function vehicleLabel(){return [state.vehicle.year,state.vehicle.make,state.vehicle.model,state.vehicle.engine].filter(Boolean).join(' ')}
    function ask(text){state.lastReply=text;responses.push(text)}
    ${source}
    return {state,responses,ensureGuidedState,handleGuidedFinding,handleRepairInformationImport,verifyPendingRepairInformation,interpretFinding,normalizeFinding,classifyFindingIntent,repairDiagnosticText,repairDecisionReply,diagnosticConclusion,diagnosticCompletionGate,deriveDiagnosticDisposition,applyNoFaultAction,isDiagnosticComplete,continueToRepairDecision,missingRepairDecisionEvidence,FINDING_INTENT,GUIDED_WORKFLOWS};
  `)();
}

test('AU DTC and vehicle canonicalization remains present in BF',()=>{
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

test('BF engine is authoritative, guarded, and exposes compact debug state',()=>{
  assert.match(html,/diagnosticTestState:null/);
  assert.match(html,/localStorage\.setItem\(STATE_KEY,JSON\.stringify\(state\)\)/);
  assert.match(html,/\['diagnostic','circuit-isolation','mechanical-diagnosis','repair-decision'\]\.includes\(state\.stage\).*handleGuidedFinding\(text\)/);
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

test('V4 current ground test consumes direct natural-language voltage-drop measurements',()=>{
  const variants=['Cam sensor ground voltage drop is 0.04 V.','Cam sensor ground voltage drop is 0.04 volts.','Ground voltage drop: 0.04 V','I got forty millivolts'];
  for(const input of variants){const h=atGround();h.handleGuidedFinding(input);const guided=h.state.diagnosticTestState,ground=guided.tests[1];assert.equal(ground.status,'pass',input);assert.equal(ground.interpretedValue,0.04,input);assert.equal(ground.unit,'V',input);assert.equal(ground.technicianFinding,input,input);assert.equal(guided.currentTestId,'cam-signal',input);assert.match(h.state.lastReply,/0\.04 V\. Cam Sensor Ground passes.+Next we'll test Cam Signal Activity\./,input);assert.doesNotMatch(h.state.lastReply,/do not have a confirmed result/i,input)}
});

test('V4 generic current-test ingestion normalizes diagnostic measurement units and applies configured criteria',()=>{
  const h=harness(),cases=[
    [{kind:'generic',comparator:'<=',maximum:0.05},'Current draw is 40 milliamps',0.04,'A','pass'],
    [{kind:'generic',comparator:'range',minimum:950,maximum:1050},'Frequency is 1 kilohertz',1000,'Hz','pass'],
    [{kind:'generic',comparator:'>=',minimum:40},'Fuel pressure is 42 psi',42,'psi','pass'],
    [{kind:'generic',comparator:'<=',maximum:100},'Temperature is 105 degrees celsius',105,'°C','fail'],
    [{kind:'generic',comparator:'<=',maximum:1},'Resistance is 1.2 kilohms',1200,'Ω','fail']
  ];
  for(const [definition,input,value,unit,result] of cases){const parsed=h.interpretFinding(definition,input);assert.equal(parsed.intent,h.FINDING_INTENT.ACTUAL,input);assert.equal(parsed.value,value,input);assert.equal(parsed.unit,unit,input);assert.equal(parsed.result,result,input)}
});

test('V4 measurement ingestion remains fail closed without a numeric value or direct observation',()=>{
  const h=atGround();h.handleGuidedFinding('The ground circuit needs more testing');assert.equal(h.state.diagnosticTestState.tests[1].status,'in_progress');assert.equal(h.state.diagnosticTestState.currentTestId,'cam-ground');assert.match(h.state.lastReply,/actual measurement or direct observation/i)
});

test('cam signal activity natural-language variants pass only at the activity checkpoint',()=>{
  const inputs=['Kim voltage switching from 0.2 to 4.8 oscillating','Cam signal toggles between 0.2 and 4.8 volts','The waveform is pulsing high and low',"I'm seeing it toggle high and low"];
  for(const input of inputs){const h=atGround();h.handleGuidedFinding('I measured 0.04 V');h.handleGuidedFinding(input);const guided=h.state.diagnosticTestState,signal=guided.tests.find(item=>item.id==='cam-signal'),correlation=guided.tests.find(item=>item.id==='cam-correlation');assert.equal(signal.status,'pass',input);assert.equal(signal.technicianFinding,input);assert.equal(guided.currentTestId,'cam-correlation',input);assert.equal(correlation.status,'in_progress',input);const completed=guided.tests.filter(item=>['pass','fail'].includes(item.status)).length;h.handleGuidedFinding(input);assert.equal(guided.currentTestId,'cam-correlation',input);assert.equal(guided.tests.filter(item=>['pass','fail'].includes(item.status)).length,completed,input)}
});

test('cam signal activity negation and static voltage never pass',()=>{
  const inputs=['Cam signal is not switching','Cam signal is stuck at 4.8 volts','No cam signal, flat line','There is voltage','4.8 volts'];
  for(const input of inputs){const h=harness(),test=h.GUIDED_WORKFLOWS.P0340.tests[2],result=h.interpretFinding(test,input);assert.notEqual(result.result,'pass',input)}
});

test('cam signal activity acknowledgements preserve both voltage endpoints and switching terminology',()=>{
  const cases=[
    ['Cam voltage switching from 0.02 to 4.8 volts',/Cam signal is switching from 0\.02 V to 4\.8 V\./],
    ['Signal goes from about 0 to 5 volts',/Cam signal is switching from 0 V to 5 V\./],
    ['I have 0.1 low and 4.9 high',/Cam signal is switching from 0\.1 V to 4\.9 V\./],
    ['Cam signal is switching between 0.04 and 4.7 volts',/Cam signal is switching from 0\.04 V to 4\.7 V\./],
    ['Kim signal toggles from 0.02 to 4.8 V',/Cam signal is toggling from 0\.02 V to 4\.8 V\./]
  ];
  for(const [input,summary] of cases){const h=atGround();h.handleGuidedFinding('I measured 0.04 V');h.handleGuidedFinding(input);const guided=h.state.diagnosticTestState;assert.match(h.state.lastReply,summary,input);assert.match(h.state.lastReply,/Cam Signal Activity passes\. Next we'll test Cam\/Crank Correlation\./,input);assert.equal(guided.currentTestId,'cam-correlation',input);assert.equal(guided.tests[2].technicianFinding,input,input);const count=guided.tests.filter(item=>['pass','fail'].includes(item.status)).length;h.handleGuidedFinding(input);assert.equal(guided.currentTestId,'cam-correlation',input);assert.equal(guided.tests.filter(item=>['pass','fail'].includes(item.status)).length,count,input)}
});

test('single-value cam signal observations retain the existing acknowledgement behavior',()=>{
  const h=atGround();h.handleGuidedFinding('I measured 0.04 V');h.handleGuidedFinding('Cam signal switching at 4.8 volts');assert.match(h.state.lastReply,/^4\.8 V\. Cam Signal Activity passes\./);assert.equal(h.state.diagnosticTestState.currentTestId,'cam-correlation')
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

test('BF import attaches to the active case but cannot satisfy the gate without explicit verification',()=>{
  const h=atCorrelation();h.handleGuidedFinding('Cam and crank are synchronized');const before={id:h.state.id,vehicle:structuredClone(h.state.vehicle),dtc:h.state.activeDtc,workflow:h.state.diagnosticTestState.workflowId,passes:h.state.diagnosticTestState.tests.slice(0,4).map(test=>test.status)},detail={kind:'text-data',fileName:'camry-p0340-procedure.txt',fileSize:4200,text:'Applicable 2012 Camry P0340 service procedure',importedAt:'2026-08-09T15:00:00.000Z'};
  assert.equal(h.handleRepairInformationImport(detail),true);const guided=h.state.diagnosticTestState,gate=guided.tests.find(test=>test.id==='verified-repair-information-required');assert.equal(guided.currentTestId,'verified-repair-information-required');assert.equal(gate.status,'pending');assert.equal(h.state.repairInformation.status,'required');assert.equal(h.state.repairInformationRequired,true);assert.equal(h.state.repairInformationLoaded,false);assert.equal(h.state.pendingRepairInformation.eligible,true);assert.equal(h.state.repairInformationEvidence.at(-1).confirmed,false);assert.match(h.state.lastReply,/choose “Use as Verified Repair Information\.”/);
  assert.equal(h.state.id,before.id);assert.deepEqual(h.state.vehicle,before.vehicle);assert.equal(h.state.activeDtc,before.dtc);assert.equal(guided.workflowId,before.workflow);assert.deepEqual(guided.tests.slice(0,4).map(test=>test.status),before.passes);
});

function verifiedP0340RepairInformation(){return {kind:'text-data',fileName:'verified-procedure.json',fileSize:8192,text:'Structured verified P0340 repair information',importedAt:'2026-08-09T15:05:00.000Z',parsedData:{isolationTests:[{id:'cmp-signal-circuit-continuity',verified:true,dtcs:['P0340'],vehicle:'2012 Toyota Camry',name:'CMP Signal Circuit Continuity',componentOrCircuit:'CMP signal circuit continuity',testLocation:'the two verified CMP circuit endpoints',method:'the continuity method in the loaded procedure',criterion:'1 Ω maximum',comparator:'<=',maximum:1,requestedResult:'Report the measured resistance with units.'}]}}}

test('V2 explicit verification atomically selects and persists one evidence-supported P0340 circuit-isolation test',()=>{
  const h=atCorrelation();h.handleGuidedFinding('Correlation passed');h.state.intakeStep='complete';const before={id:h.state.id,vehicle:structuredClone(h.state.vehicle),dtc:h.state.activeDtc,workflow:h.state.diagnosticTestState.workflowId,passes:h.state.diagnosticTestState.tests.slice(0,4).map(test=>test.status)};h.handleRepairInformationImport(verifiedP0340RepairInformation());assert.equal(h.verifyPendingRepairInformation(),true);
  const guided=h.state.diagnosticTestState,gate=guided.tests.find(test=>test.id==='verified-repair-information-required'),review=guided.tests.find(test=>test.id==='repair-information-review'),selected=guided.tests.find(test=>test.id==='verified-cmp-signal-circuit-continuity');assert.equal(h.state.id,before.id);assert.deepEqual(h.state.vehicle,before.vehicle);assert.equal(h.state.activeDtc,before.dtc);assert.equal(guided.workflowId,before.workflow);assert.deepEqual(guided.tests.slice(0,4).map(test=>test.status),before.passes);assert.equal(h.state.stage,'circuit-isolation');assert.equal(h.state.intakeStep,'complete');assert.equal(h.state.repairInformation.status,'verified');assert.equal(h.state.repairInformationRequired,false);assert.equal(h.state.repairInformationLoaded,true);assert.equal(h.state.repairInformation.evidenceReference.fileName,'verified-procedure.json');assert.equal(gate.status,'pass');assert.equal(review.status,'pending');assert.equal(guided.currentTestId,'verified-cmp-signal-circuit-continuity');assert.equal(guided.selectedIsolationTest.kind,'circuit-isolation');assert.equal(selected.status,'in_progress');assert.equal(guided.lastCompletedResult.testId,'verified-repair-information-required');assert.equal(guided.lastCompletedResult.status,'pass');assert.equal(h.state.repairInformationEvidence.at(-1).confirmed,true);assert.match(h.state.lastReply,/Verified repair information is attached\. Next test: CMP signal circuit continuity/);assert.match(h.state.lastReply,/two verified CMP circuit endpoints/);assert.match(h.state.lastReply,/1 Ω maximum/);assert.doesNotMatch(h.state.lastReply,/pin \d|connector\s+[A-Z]\d|wire color/i);const reply=h.state.lastReply,testCount=guided.tests.length;assert.equal(h.verifyPendingRepairInformation(),false);assert.equal(guided.tests.length,testCount);assert.equal(h.state.lastReply,reply);
  const restored=JSON.parse(JSON.stringify(h.state));assert.equal(restored.repairInformation.status,'verified');assert.equal(restored.diagnosticTestState.currentTestId,'verified-cmp-signal-circuit-continuity');assert.equal(restored.diagnosticTestState.selectedIsolationTest.id,'verified-cmp-signal-circuit-continuity');assert.equal(restored.diagnosticTestState.tests.filter(test=>test.id==='verified-cmp-signal-circuit-continuity').length,1);assert.notEqual(restored.diagnosticTestState.currentTestId,'repair-information-review');
});

test('V2 insufficient accepted repair information remains safely stopped without fabricating a test',()=>{
  const h=atCorrelation();h.handleGuidedFinding('Correlation passed');h.state.intakeStep='complete';const guided=h.state.diagnosticTestState,before={id:h.state.id,vehicle:structuredClone(h.state.vehicle),dtc:h.state.activeDtc,workflow:guided.workflowId,passes:guided.tests.slice(0,4).map(test=>test.status)};h.handleRepairInformationImport({kind:'pdf-attachment',fileName:'incomplete-procedure.pdf',fileSize:4096,isolationTests:[{id:'partial',verified:true,dtcs:['P0340'],name:'CMP test'}]});assert.equal(h.verifyPendingRepairInformation(),true);const gate=guided.tests.find(test=>test.id==='verified-repair-information-required');assert.equal(h.state.id,before.id);assert.deepEqual(h.state.vehicle,before.vehicle);assert.equal(h.state.activeDtc,before.dtc);assert.equal(guided.workflowId,before.workflow);assert.deepEqual(guided.tests.slice(0,4).map(test=>test.status),before.passes);assert.equal(guided.currentTestId,'verified-repair-information-required');assert.equal(gate.status,'pending');assert.equal(h.state.stage,'circuit-isolation');assert.equal(h.state.intakeStep,'complete');assert.equal(h.state.repairInformation.status,'available');assert.equal(h.state.repairInformationRequired,true);assert.equal(h.state.repairInformationLoaded,true);assert.equal(guided.selectedIsolationTest,null);assert.match(h.state.lastReply,/does not yet provide a verified, DTC-applicable circuit-isolation test/i);assert.match(h.state.lastReply,/component or circuit, test location, method, criterion, and requested result/i);assert.doesNotMatch(h.state.lastReply,/pin \d|connector\s+[A-Z]\d|wire color|0\.5 Ω|continuity criterion/i);
});

test('V5 incomplete document extraction remains at repair-information gate and names exact missing fields',()=>{
  const h=atCorrelation();h.handleGuidedFinding('Correlation passed');h.state.intakeStep='complete';const guided=h.state.diagnosticTestState;h.handleRepairInformationImport({kind:'image-analysis',fileName:'partial-oem-screen.png',imageHash:'fresh-hash',analysis:{category:'DOCUMENT_OR_TEXT_SCREENSHOT',documentRepairInformation:{extractionStatus:'INCOMPLETE',dtcApplicability:'APPLICABLE',freshResultVerification:'PASS',missingRequiredFields:['test location','criterion']},isolationTests:[]}});assert.equal(guided.currentTestId,'verified-repair-information-required');assert.equal(h.state.pendingRepairInformation.eligible,false);assert.match(h.state.lastReply,/Missing or unsupported: test location, criterion/i);assert.equal(h.state.repairInformationRequired,true)
});

test('V5 complete DTC-applicable document test enters existing explicit verification path',()=>{
  const h=atCorrelation();h.handleGuidedFinding('Correlation passed');h.state.intakeStep='complete';const test={id:'document-fresh',verified:true,dtcs:['P0340'],name:'CMP Signal Continuity',componentOrCircuit:'CMP signal circuit',testLocation:'ECM terminal 45 to CMP connector terminal 3',method:'Key off, disconnect both connectors, measure resistance end to end',criterion:'1 Ω maximum',comparator:'<=',maximum:1,minimum:null,requestedResult:'Report measured resistance in ohms'};h.handleRepairInformationImport({kind:'image-analysis',fileName:'complete-oem-screen.png',imageHash:'fresh-hash',analysis:{category:'DOCUMENT_OR_TEXT_SCREENSHOT',documentRepairInformation:{extractionStatus:'COMPLETE',dtcApplicability:'APPLICABLE',freshResultVerification:'PASS',missingRequiredFields:[]},isolationTests:[test]}});assert.equal(h.state.pendingRepairInformation.eligible,true);assert.equal(h.verifyPendingRepairInformation(),true);assert.equal(h.state.diagnosticTestState.currentTestId,'verified-document-fresh');assert.match(h.state.lastReply,/Next test: CMP signal circuit/)
});

test('BF invalid or blank imports cannot satisfy the repair-information gate',()=>{
  for(const detail of [{kind:'text-data',fileName:'blank.txt',fileSize:0,text:''},{kind:'image-analysis',fileName:'vehicle.jpg',fileSize:3000,analysis:{category:'AUTOMOTIVE_COMPONENT_OR_VEHICLE'}},{kind:'image-analysis',fileName:'random.jpg',fileSize:3000,analysis:{category:'GENERAL_NON_AUTOMOTIVE_PHOTO'}}]){const h=atCorrelation();h.handleGuidedFinding('They line up correctly');h.handleRepairInformationImport(detail);assert.equal(h.state.pendingRepairInformation.eligible,false);assert.equal(h.verifyPendingRepairInformation(),false);assert.equal(h.state.repairInformation.status,'required');assert.equal(h.state.diagnosticTestState.currentTestId,'verified-repair-information-required');assert.equal(h.state.diagnosticTestState.tests.find(test=>test.id==='verified-repair-information-required').status,'pending',detail.fileName)}
});

test('BF authoritative fields, explicit action, and New Case isolation remain present',()=>{
  for(const field of ['repairInformationRequired','repairInformationLoaded','repairInformationSource','repairInformationLoadedAt','repairInformationEvidence','pendingRepairInformation'])assert.match(html,new RegExp(field));assert.match(html,/repairInformation:\{status:'required'/);assert.match(html,/Repair Information: \$\{repairInformation\}/);assert.match(html,/function reset\(\).*state=blank\(\)/);assert.match(html,/verifyRepairInformation:verifyPendingRepairInformation/);
});

function completedRepairDecision(){
  const h=atCorrelation();
  h.handleGuidedFinding('Cam and crank are synchronized correctly');
  h.handleRepairInformationImport(verifiedP0340RepairInformation());
  h.verifyPendingRepairInformation();
  h.handleGuidedFinding('Continuity test passed');
  return h;
}

function awaitingContinuity(){
  const h=atCorrelation();
  h.handleGuidedFinding('Cam and crank are synchronized correctly');
  h.handleRepairInformationImport(verifiedP0340RepairInformation());
  h.verifyPendingRepairInformation();
  return h;
}

test('VI completed required evidence transitions deterministically to repair-decision without another test',()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState;
  assert.equal(h.state.stage,'repair-decision');
  assert.equal(guided.currentTestId,'');
  assert.equal(guided.nextRecommendedTest,'');
  assert.ok(guided.completedAt);
  assert.match(h.state.lastReply,/Diagnostic testing is complete/);
  assert.doesNotMatch(h.state.lastReply,/Next (?:test|we'll test)|load the applicable wiring diagram/i);
});

test("VI what's next after Current Test Complete reviews stored evidence and never restarts testing",()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState,before=JSON.stringify(guided.tests);
  h.handleGuidedFinding("What's next?");
  assert.equal(h.state.stage,'repair-decision');
  assert.equal(guided.currentTestId,'');
  assert.equal(JSON.stringify(guided.tests),before);
  assert.match(h.state.lastReply,/Stored evidence:/);
  assert.doesNotMatch(h.state.lastReply,/Next (?:test|we'll test)|power\/reference.*give me|load the applicable wiring diagram/i);
});

test("VI all-pass evidence refuses to condemn a component",()=>{
  const h=completedRepairDecision();h.handleGuidedFinding("What's wrong with it?");
  assert.match(h.state.lastReply,/does not support condemning a component/i);
  assert.match(h.state.lastReply,/Do not replace a part/i);
});

test('VI repair-decision logic names the exact missing evidence instead of fabricating a test',()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState,ground=guided.tests.find(test=>test.id==='cam-ground');ground.status='pending';guided.currentTestId='';h.state.stage='circuit-isolation';
  h.handleGuidedFinding("What's next?");
  assert.match(h.state.lastReply,/missing: Cam Sensor Ground/i);
  assert.doesNotMatch(h.state.lastReply,/perform|measure|Next test/i);
});

test('VI entering repair-decision preserves every previously passed result',()=>{
  const h=completedRepairDecision(),ids=['cam-power-reference','cam-ground','cam-signal','cam-correlation','verified-repair-information-required','verified-cmp-signal-circuit-continuity'];
  assert.deepEqual(ids.map(id=>h.state.diagnosticTestState.tests.find(test=>test.id===id)?.status),['pass','pass','pass','pass','pass','pass']);
});

test('VI New Case still clears completed and repair-decision state',()=>{
  assert.match(html,/function reset\(\)\{window\.resetOcrSessionState\?\.\('authoritative New Case command'\);state=blank\(\)/);
  assert.match(html,/const blank=\(\)=>\(\{[^\n]+stage:'vehicle',[^\n]+diagnosticTestState:null/);
  assert.match(html,/^\s*if\(\/\^\(new case\|start new case\|clear case\|start over\)\$\//m);
});

test('VJ CMP continuity accepts passing numeric resistance with or without an explicit unit',()=>{
  for(const input of ['0.2 ohms','I have 0.2','point two ohms','0.4 ohms','less than one ohm']){
    const h=awaitingContinuity(),guided=h.state.diagnosticTestState,record=guided.tests.find(test=>test.id==='verified-cmp-signal-circuit-continuity');h.handleGuidedFinding(input);
    assert.equal(record.status,'pass',input);assert.equal(record.technicianFinding,input,input);assert.equal(record.unit,'Ω',input);assert.equal(guided.currentTestId,'',input);assert.equal(h.state.stage,'repair-decision',input);
  }
});

test('VJ CMP continuity stores a failing numeric resistance and enters the supported circuit-fault decision path',()=>{
  const h=awaitingContinuity(),guided=h.state.diagnosticTestState,record=guided.tests.find(test=>test.id==='verified-cmp-signal-circuit-continuity');h.handleGuidedFinding('I measured 1.4 ohms');
  assert.equal(record.status,'fail');assert.equal(record.interpretedValue,1.4);assert.equal(record.unit,'Ω');assert.equal(record.technicianFinding,'I measured 1.4 ohms');assert.equal(guided.currentTestId,'');assert.equal(h.state.stage,'repair-decision');assert.match(h.state.lastReply,/failure in the CMP signal circuit continuity path/i);
});

test('VJ CMP continuity accepts natural-language PASS and open-circuit failure variants',()=>{
  for(const input of ['continuity is good','it passes']){const h=awaitingContinuity(),record=h.state.diagnosticTestState.tests.find(test=>test.id==='verified-cmp-signal-circuit-continuity');h.handleGuidedFinding(input);assert.equal(record.status,'pass',input)}
  for(const input of ['open circuit','OL','infinite resistance','no continuity']){const h=awaitingContinuity(),record=h.state.diagnosticTestState.tests.find(test=>test.id==='verified-cmp-signal-circuit-continuity');h.handleGuidedFinding(input);assert.equal(record.status,'fail',input);assert.equal(record.technicianFinding,input,input);assert.equal(h.state.stage,'repair-decision',input)}
});

test("VJ what's next while continuity is truly pending requests only that result",()=>{
  const h=awaitingContinuity(),guided=h.state.diagnosticTestState,before=JSON.stringify(guided.tests);h.handleGuidedFinding("What's next?");
  assert.equal(guided.currentTestId,'verified-cmp-signal-circuit-continuity');assert.equal(JSON.stringify(guided.tests),before);assert.match(h.state.lastReply,/CMP Signal Circuit Continuity is still awaiting a result/i);assert.match(h.state.lastReply,/measured resistance with units/i);assert.doesNotMatch(h.state.lastReply,/^Correct -|Next test:/i);
});

test("VJ stored completion wins over a stale current-test pointer and cannot replay or reopen the prompt",()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState,record=guided.tests.find(test=>test.id==='verified-cmp-signal-circuit-continuity'),before=JSON.stringify(guided.tests);guided.currentTestId=record.id;guided.nextRecommendedTest=record.id;h.state.stage='circuit-isolation';h.handleGuidedFinding("What's next?");
  assert.equal(record.status,'pass');assert.equal(JSON.stringify(guided.tests),before);assert.equal(guided.currentTestId,'');assert.equal(guided.nextRecommendedTest,'');assert.equal(h.state.stage,'repair-decision');assert.match(h.state.lastReply,/Diagnostic testing is complete/i);assert.doesNotMatch(h.state.lastReply,/still awaiting|Next test:|perform the test/i);
});

function failedContinuityDecision(){const h=awaitingContinuity();h.handleGuidedFinding('open circuit');return h}

test('VK continuity FAIL conclusion identifies the circuit path without condemning a component',()=>{
  const h=failedContinuityDecision(),reply=h.state.lastReply;
  assert.match(reply,/Diagnostic finding: testing identified a failure in the CMP signal circuit continuity path/i);
  assert.match(reply,/exact open or high-resistance location/i);
  assert.match(reply,/sensor, ECM\/PCM, connector, wire, or terminal/i);
  assert.doesNotMatch(reply,/replace (?:the )?(?:camshaft position sensor|ECM|PCM|connector|wire|terminal)/i);
  assert.equal(h.state.stage,'repair-decision');assert.equal(h.state.diagnosticTestState.currentTestId,'');assert.equal(h.state.diagnosticTestState.lastCompletedResult.testName,'CMP Signal Circuit Continuity');assert.equal(h.state.diagnosticTestState.lastCompletedResult.status,'fail');
});

test('VK continuity PASS conclusion does not fabricate a failure or repair recommendation',()=>{
  const h=completedRepairDecision(),reply=h.state.lastReply;
  assert.match(reply,/all required tests are complete/i);assert.match(reply,/Did not prove: that the camshaft position sensor/i);assert.match(reply,/do not replace a part from this evidence alone/i);assert.doesNotMatch(reply,/identified a failure|replace the camshaft position sensor/i);
});

test('VK mixed conclusion accurately incorporates stored PASS and FAIL evidence',()=>{
  const h=failedContinuityDecision(),reply=h.state.lastReply,ids=['cam-power-reference','cam-ground','cam-signal','cam-correlation','verified-repair-information-required','verified-cmp-signal-circuit-continuity'];
  assert.deepEqual(ids.map(id=>h.state.diagnosticTestState.tests.find(test=>test.id===id)?.status),['pass','pass','pass','pass','pass','fail']);
  for(const name of ['Power/Reference','Cam Sensor Ground','Cam Signal Activity','Cam/Crank Correlation','Verified Repair Information Required'])assert.match(reply,new RegExp(name.replace('/','\\/')));
  assert.match(reply,/CMP Signal Circuit Continuity failed/i);
});

test('VK verified repair information remains reference material rather than component-failure proof',()=>{
  const h=failedContinuityDecision();assert.equal(h.state.repairInformation.status,'verified');assert.match(h.state.lastReply,/Verified repair information is reference material, not independent proof that a component failed/i);
});

test('VK repair-decision conclusion persists with authoritative state across JSON refresh and resume',()=>{
  const h=failedContinuityDecision(),restored=JSON.parse(JSON.stringify(h.state));
  assert.equal(restored.stage,'repair-decision');assert.equal(restored.diagnosticTestState.currentTestId,'');assert.equal(restored.diagnosticTestState.tests.find(test=>test.id==='verified-cmp-signal-circuit-continuity').status,'fail');assert.equal(restored.repairInformation.status,'verified');assert.equal(restored.diagnosticTestState.diagnosticConclusion,h.state.lastReply);assert.match(restored.diagnosticTestState.diagnosticConclusion,/CMP signal circuit continuity path/i);
});

test('VL completed authoritative state rejects diagram-import regression and remains repair-decision after refresh',()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState,before=JSON.stringify({stage:h.state.stage,guided,repairInformation:h.state.repairInformation});
  assert.equal(h.isDiagnosticComplete(),true);
  assert.equal(h.handleRepairInformationImport({kind:'image-analysis',fileName:'cam-wiring.png',fileSize:5000,analysis:{category:'AUTOMOTIVE_WIRING_DIAGRAM',runId:'RUN-FRESH'}}),false);
  assert.equal(JSON.stringify({stage:h.state.stage,guided,repairInformation:h.state.repairInformation}),before);
  assert.equal(h.state.stage,'repair-decision');assert.equal(guided.currentTestId,'');assert.equal(guided.nextRecommendedTest,'');assert.deepEqual(guided.tests.filter(test=>['pass','fail'].includes(test.status)).map(test=>test.status),['pass','pass','pass','pass','pass','pass']);
  const restored=JSON.parse(JSON.stringify(h.state));assert.equal(restored.stage,'repair-decision');assert.equal(restored.diagnosticTestState.currentTestId,'');assert.ok(restored.diagnosticTestState.completedAt);
});

test('VL repair-decision action uses the canonical conclusion without reopening a test',()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState,before=JSON.stringify(guided.tests);assert.equal(h.continueToRepairDecision(),true);assert.equal(JSON.stringify(guided.tests),before);assert.equal(h.state.stage,'repair-decision');assert.equal(guided.currentTestId,'');assert.match(h.state.lastReply,/Diagnostic testing is complete/i);
});

test('VM all-PASS P0340 conclusion is explicitly evidence-bound with no component failure confirmed',()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState,before=JSON.stringify(guided.tests);h.state.complaint='intermittent MIL';h.state.symptoms='None reported';h.handleGuidedFinding('What should be repaired?');const reply=h.state.lastReply;
  assert.match(reply,/DIAGNOSTIC TESTING COMPLETE/);assert.match(reply,/Outcome: NO COMPONENT FAILURE CONFIRMED/);assert.match(reply,/completed circuit testing did not identify an electrical circuit failure/i);assert.match(reply,/Power\/Reference, Cam Sensor Ground, Cam Signal Activity, Cam\/Crank Correlation, Verified Repair Information Required, CMP Signal Circuit Continuity passed/);assert.match(reply,/has not proven the CMP sensor itself defective/i);assert.doesNotMatch(reply,/replace (?:the )?(?:camshaft position sensor|CMP sensor|ECM|PCM)/i);
  assert.equal(JSON.stringify(guided.tests),before);assert.equal(h.state.stage,'repair-decision');assert.equal(guided.currentTestId,'');
});

test('VM conclusion integrates stored case context and verified repair information only as support',()=>{
  const h=completedRepairDecision();h.state.status='intermittent';h.state.complaint='MIL';h.state.symptoms='No drivability symptoms';h.handleGuidedFinding("What's the diagnostic conclusion?");const reply=h.state.lastReply;
  assert.match(reply,/Case context: Active DTC P0340; code status intermittent; complaint MIL; symptoms No drivability symptoms/);assert.match(reply,/verified-procedure\.json is reference material used as supporting context, not independent proof of component failure/i);assert.equal(h.state.repairInformation.status,'verified');
});

test('VM next action remains a deliberate repair-decision choice and starts no electrical test',()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState,before=JSON.stringify(guided.tests);h.handleGuidedFinding('What do we do now?');const reply=h.state.lastReply;
  assert.match(reply,/Next action: remain at repair decision and deliberately select the next diagnostic direction/i);assert.match(reply,/No additional test has been started/i);assert.doesNotMatch(reply,/perform the test|give me the measurement|Next test:/i);assert.equal(JSON.stringify(guided.tests),before);assert.equal(guided.currentTestId,'');assert.equal(guided.nextRecommendedTest,'');assert.equal(h.state.stage,'repair-decision');
});

test('VM ordinary repair question cannot bypass the completion-and-evidence gate',()=>{
  const h=awaitingContinuity(),guided=h.state.diagnosticTestState;h.handleGuidedFinding('What should be repaired?');assert.notEqual(h.state.stage,'repair-decision');assert.equal(guided.currentTestId,'verified-cmp-signal-circuit-continuity');assert.doesNotMatch(h.state.lastReply,/Outcome: (?:CONFIRMED FAILURE|SUPPORTED REPAIR DECISION|NO COMPONENT FAILURE CONFIRMED)/);
});

test('VN all-PASS completion derives authoritative no-fault and no-repair disposition',()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState;
  assert.equal(h.state.diagnosticOutcome,'NO FAULT CONFIRMED');assert.equal(h.state.repairDecision,'NO REPAIR AUTHORIZED');assert.equal(h.state.stage,'repair-decision');assert.equal(guided.currentTestId,'');assert.match(h.state.lastReply,/^Diagnostic testing is complete\. No component failure was confirmed\./);assert.match(h.state.lastReply,/No repair is authorized by the current evidence/i);assert.doesNotMatch(h.state.lastReply,/replace (?:the )?(?:CMP|camshaft|ECM|PCM)/i);
});

test('VN Review Test Results exposes unchanged completed history without restarting',()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState,before=JSON.stringify(guided.tests),result=h.applyNoFaultAction('review');assert.equal(result.accepted,true);assert.equal(h.state.repairDecisionView,'results');assert.equal(JSON.stringify(guided.tests),before);assert.equal(guided.currentTestId,'');assert.equal(h.state.stage,'repair-decision');
});

test('VN Perform Additional Testing appends investigation mode without erasing case authority',()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState,before={id:h.state.id,vehicle:structuredClone(h.state.vehicle),dtc:h.state.activeDtc,workflow:guided.workflowId,tests:JSON.stringify(guided.tests),repairInformation:structuredClone(h.state.repairInformation)},result=h.applyNoFaultAction('additional-testing');assert.equal(result.accepted,true);assert.match(result.message,/completed evidence remains unchanged/i);assert.equal(h.state.additionalTesting.active,true);assert.equal(h.state.repairDecisionView,'additional-testing');assert.equal(h.state.id,before.id);assert.deepEqual(h.state.vehicle,before.vehicle);assert.equal(h.state.activeDtc,before.dtc);assert.equal(guided.workflowId,before.workflow);assert.equal(JSON.stringify(guided.tests),before.tests);assert.deepEqual(h.state.repairInformation,before.repairInformation);assert.equal(guided.currentTestId,'');
});

test('VN Close Diagnostic preserves evidence and deterministically authorizes no repair',()=>{
  const h=completedRepairDecision(),guided=h.state.diagnosticTestState,before=JSON.stringify(guided.tests),result=h.applyNoFaultAction('close');assert.equal(result.accepted,true);assert.equal(h.state.diagnosticClosed,true);assert.equal(h.state.diagnosticOutcome,'NO FAULT CONFIRMED');assert.equal(h.state.repairDecision,'NO REPAIR AUTHORIZED');assert.equal(JSON.stringify(guided.tests),before);assert.equal(h.state.stage,'repair-decision');assert.equal(guided.currentTestId,'');assert.match(result.message,/No repair is authorized/i);
});

test('VN no-fault outcome and action state survive existing JSON persistence',()=>{
  const h=completedRepairDecision();h.applyNoFaultAction('review');const restored=JSON.parse(JSON.stringify(h.state));assert.equal(restored.diagnosticOutcome,'NO FAULT CONFIRMED');assert.equal(restored.repairDecision,'NO REPAIR AUTHORIZED');assert.equal(restored.repairDecisionView,'results');assert.equal(restored.diagnosticTestState.currentTestId,'');assert.equal(restored.diagnosticTestState.tests.filter(test=>test.status==='pass').length,6);
});

test('VN status UI exposes authoritative fields and three functional controls',()=>{
  for(const label of ['Review Test Results','Perform Additional Testing','Close Diagnostic — No Fault Confirmed'])assert.match(html,new RegExp(label));for(const id of ['reviewDiagnosticResults','performAdditionalTesting','closeNoFaultDiagnostic','diagnosticCompletedResults'])assert.match(html,new RegExp(id));assert.match(html,/Diagnostic Outcome: \$\{esc\(state\.diagnosticOutcome\)\}/);assert.match(html,/Repair Decision: \$\{esc\(state\.repairDecision\|\|'PENDING'\)\}/);assert.match(html,/additionalTesting\.notes\.push\(\{text,at:new Date\(\)\.toISOString\(\)\}\)/);assert.match(html,/reviewDiagnosticResults,beginAdditionalTesting,closeNoFaultDiagnostic/);
});
