import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('const GUIDED_WORKFLOWS=');
const end=html.indexOf('function add(',start);
assert.ok(start>=0&&end>start,'AX guided-test engine was not found');
const source=html.slice(start,end);

function harness(){
  return Function(`
    let state={activeDtc:'P0340',diagnosticTestState:null,liveData:'',lastReply:'',vehicle:{year:'2014',make:'Toyota',model:'Camry',engine:''}};
    const responses=[];
    function workflowName(){return 'Camshaft Position Circuit'}
    function ask(text){state.lastReply=text;responses.push(text)}
    ${source}
    return {state,responses,ensureGuidedState,handleGuidedFinding,interpretFinding,normalizeFinding,classifyFindingIntent,repairDiagnosticText,FINDING_INTENT,GUIDED_WORKFLOWS};
  `)();
}

test('AU DTC and vehicle canonicalization remains present in BA',()=>{
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

test('BA engine is authoritative, guarded, and exposes compact debug state',()=>{
  assert.match(html,/diagnosticTestState:null/);
  assert.match(html,/localStorage\.setItem\(STATE_KEY,JSON\.stringify\(state\)\)/);
  assert.match(html,/state\.stage==='diagnostic'.*handleGuidedFinding\(text\)/);
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

test('cam/crank correlation technician-language pass variants commit and advance once',()=>{
  const inputs=['Cam and crank signals are synchronized correctly while cranking','Cam and crank signals are synchronize correctly while cranking','cam and crank are in sync','the signals line up correctly','correlation looks correct','Cam and crank signal is synchronized','They are synchronized while cranking','The cam and crank signals match'];
  for(const input of inputs){const h=atCorrelation();h.handleGuidedFinding(input);const guided=h.state.diagnosticTestState,correlation=guided.tests.find(item=>item.id==='cam-correlation');assert.equal(correlation.status,'pass',input);assert.equal(guided.currentTestId,'cam-further-isolation',input);assert.deepEqual(guided.tests.slice(0,3).map(item=>item.status),['pass','pass','pass'],input);assert.equal(guided.lastCompletedResult.testId,'cam-correlation',input);assert.match(h.state.lastReply,/Cam\/Crank Correlation passes/,input);assert.match(h.state.lastReply,/Further Circuit\/Component Isolation/,input);assert.match(h.state.lastReply,/report the measured result/i,input);assert.doesNotMatch(h.state.lastReply,/do not have a confirmed result/i,input)}
});

test('correlation negation takes precedence and cannot be classified as pass',()=>{
  const inputs=['cam and crank are not synchronized','they are out of sync','the signals do not line up','correlation is incorrect','cam and crank timing is off','the relationship is wrong',"the signals don't match"];
  for(const input of inputs){const h=atCorrelation();h.handleGuidedFinding(input);const guided=h.state.diagnosticTestState,correlation=guided.tests.find(item=>item.id==='cam-correlation');assert.equal(correlation.status,'fail',input);assert.notEqual(correlation.status,'pass',input);assert.equal(guided.currentTestId,'cam-further-isolation',input);assert.match(h.state.lastReply,/Cam\/Crank Correlation fails/,input)}
});

test('ambiguous correlation response remains uncommitted on the current test',()=>{
  const h=atCorrelation(),guided=h.state.diagnosticTestState,correlation=guided.tests.find(item=>item.id==='cam-correlation');h.handleGuidedFinding("maybe they're okay");assert.equal(correlation.status,'in_progress');assert.equal(guided.currentTestId,'cam-correlation');assert.match(h.state.lastReply,/do not have a confirmed result/i)
});

test('repeated correlation pass observation cannot duplicate or double-advance',()=>{
  const h=atCorrelation(),input='Cam and crank signals are synchronize correctly while cranking';h.handleGuidedFinding(input);const guided=h.state.diagnosticTestState,reply=h.state.lastReply,count=h.responses.length;h.handleGuidedFinding(input);assert.equal(h.responses.length,count);assert.equal(h.state.lastReply,reply);assert.equal(guided.currentTestId,'cam-further-isolation');assert.equal(guided.tests.filter(item=>item.id==='cam-correlation'&&item.status==='pass').length,1);assert.equal(guided.tests.find(item=>item.id==='cam-further-isolation').status,'in_progress')
});

test('post-correlation PASS activates required isolation and cannot render Complete',()=>{
  const h=atCorrelation();h.handleGuidedFinding('Cam and crank signals are synchronized correctly while cranking');const guided=h.state.diagnosticTestState,correlation=guided.tests.find(item=>item.id==='cam-correlation'),isolation=guided.tests.find(item=>item.id==='cam-further-isolation');assert.equal(correlation.status,'pass');assert.equal(isolation.status,'in_progress');assert.equal(guided.currentTestId,'cam-further-isolation');assert.equal(guided.lastCompletedResult.testName,'Cam/Crank Correlation');assert.match(h.state.lastReply,/Further Circuit\/Component Isolation/);assert.match(h.state.lastReply,/perform the next circuit or component isolation check/i);assert.doesNotMatch(h.state.lastReply,/Guided checks are complete|repair decision/i)
});
