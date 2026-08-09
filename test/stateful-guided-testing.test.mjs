import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('const GUIDED_WORKFLOWS=');
const end=html.indexOf('function add(',start);
assert.ok(start>=0&&end>start,'AV guided-test engine was not found');
const source=html.slice(start,end);

function harness(){
  return Function(`
    let state={activeDtc:'P0340',diagnosticTestState:null,liveData:'',vehicle:{year:'2014',make:'Toyota',model:'Camry',engine:''}};
    const responses=[];
    function ask(text){responses.push(text)}
    ${source}
    return {state,responses,ensureGuidedState,handleGuidedFinding,interpretFinding,normalizeFinding,classifyFindingIntent,repairDiagnosticText,FINDING_INTENT,GUIDED_WORKFLOWS};
  `)();
}

test('AU DTC and vehicle canonicalization remains present in AV',()=>{
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
  assert.match(h.responses.at(-1),/Next, test the cam sensor ground/i);
  assert.doesNotMatch(h.responses.at(-1),/signal.*correlation/i);
  h.handleGuidedFinding('Ground is good');
  assert.equal(h.state.diagnosticTestState.tests[0].status,'pass');
  assert.equal(h.state.diagnosticTestState.tests[1].status,'pass');
  assert.equal(h.state.diagnosticTestState.currentTestId,'cam-signal');
  assert.match(h.responses.at(-1),/cam signal is switching/i);
});

test('signal failure routes to isolation without discarding prior passes',()=>{
  const h=harness();h.ensureGuidedState();
  h.handleGuidedFinding('Found 5v on the cam power side');
  h.handleGuidedFinding('Ground checks out');
  h.handleGuidedFinding('No signal');
  const guided=h.state.diagnosticTestState;
  assert.deepEqual(guided.tests.slice(0,3).map(item=>item.status),['pass','pass','fail']);
  assert.equal(guided.currentTestId,'cam-signal-isolation');
  assert.match(h.responses.at(-1),/signal circuit or sensor/i);
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

test('AV engine is authoritative, guarded, and exposes compact debug state',()=>{
  assert.match(html,/diagnosticTestState:null/);
  assert.match(html,/localStorage\.setItem\(STATE_KEY,JSON\.stringify\(state\)\)/);
  assert.match(html,/state\.stage==='diagnostic'.*handleGuidedFinding\(text\)/);
  assert.match(html,/verified repair information/);
  for(const field of ['avNormalizedFinding','avMatchedTestId','avInterpretedValue','avUnit','avResult','avNextTestId'])assert.match(html,new RegExp(field));
});

function atGround(){const h=harness();h.ensureGuidedState();h.handleGuidedFinding('I measured 5 V');assert.equal(h.state.diagnosticTestState.currentTestId,'cam-ground');return h}

test('expected ground specification does not mutate or advance the test state',()=>{
  const h=atGround(),before=JSON.stringify(h.state);
  h.handleGuidedFinding('I should have less than 0.1 V on the ground.');
  assert.equal(JSON.stringify(h.state),before);
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
  assert.equal(bad.state.diagnosticTestState.currentTestId,'cam-ground-isolation');
});

test('questions, numbered specifications, procedures, and uncertain claims cannot complete a test',()=>{
  for(const input of ['Should I have less than 0.1 volts?','Should be 5 V.','The specification is 0.1 volts maximum.','I need less than 0.1 V.','Anything under 100 mV is good.','I should backprobe the connector.','Looks okay.']){
    const h=atGround(),before=JSON.stringify(h.state);h.handleGuidedFinding(input);
    assert.equal(JSON.stringify(h.state),before,input);
    assert.equal(h.state.diagnosticTestState.currentTestId,'cam-ground',input);
  }
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
