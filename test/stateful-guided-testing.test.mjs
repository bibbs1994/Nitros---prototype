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
    return {state,responses,ensureGuidedState,handleGuidedFinding,interpretFinding,normalizeFinding,GUIDED_WORKFLOWS};
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
