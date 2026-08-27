import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function nextRequiredIntakeStep(');
const end=html.indexOf('function renderTranscript(',start);
assert.ok(start>=0&&end>start,'authoritative intake state machine was not found');
const intakeSource=html.slice(start,end);

function intakeHarness(initial){
  return Function('initial',`
    let state=JSON.parse(JSON.stringify(initial)),rendered=[];
    function vehicleLabel(){return '2012 Toyota Camry'}
    function add(){} function save(){} function speakOliver(){}
    function normalizeBlowerResult(){return null} function normalizeMixedIntentNumbers(text){return String(text||'')} function blowerOperatingStateEvidence(){return null} function symptomFacts(){return null} function semanticIntakeRouting(){return false} function isolateMeasurementContext(){return {spans:[],protectedNumericTokens:[],vehicleSafeText:''}} function diagnosticMeasurement(){return null}
    function ask(text){state.lastReply=text;rendered.push({text,state:JSON.parse(JSON.stringify(state))})}
    function isDiagnosticComplete(){return false}
    function ensureGuidedState(){return {currentTestId:'cam-power-reference'}}
    function testDefinition(){return {prompt:'Test the cam sensor power/reference and give me the measured voltage.'}}
    function handleGuidedFinding(){throw new Error('guided testing started before intake completion')}
    function parseVehicle(){return null} function codes(){return []} function concern(){return ''}
    function applyDtcKnowledgeResolution(){}
    ${intakeSource}
    return {state,rendered,process};
  `)(initial);
}

function awaitingRepairs(){return {vehicle:{year:'2012',make:'Toyota',model:'Camry',engine:''},activeDtc:'P0340',dtcs:['P0340'],status:'current',complaint:'MIL on',symptoms:'None',previousRepairs:'',previousTests:'',stage:'repairs',intakeStep:'previous-repairs',additionalTesting:{active:false},diagnosticTestState:null,history:[]}}

test('V1 commits a free-text none-prefixed repair answer before advancing the pointer',()=>{
  const h=intakeHarness(awaitingRepairs());
  h.process('None runs perfectly');
  assert.equal(h.state.previousRepairs,'None runs perfectly');
  assert.equal(h.state.previousTests,'');
  assert.equal(h.state.intakeStep,'previous-testing');
  assert.equal(h.state.stage,'tests');
  assert.match(h.state.lastReply,/Previous repairs recorded as “None runs perfectly\.” What diagnostic testing has already been performed\?/);
});

test('V1 exact none belongs only to previous testing and completes intake',()=>{
  const h=intakeHarness(awaitingRepairs());
  h.process('None runs perfectly');
  h.process('none');
  assert.equal(h.state.previousRepairs,'None runs perfectly');
  assert.equal(h.state.previousTests,'None');
  assert.equal(h.state.intakeStep,'complete');
  assert.equal(h.state.stage,'diagnostic');
  assert.match(h.state.lastReply,/Previous testing recorded as “None\.” Intake is complete for P0340\./);
});

test('V1 voice transcripts use the same authoritative intake transition as typed text',()=>{
  const typed=intakeHarness(awaitingRepairs()),voice=intakeHarness(awaitingRepairs());
  typed.process('None runs perfectly');
  const voiceTranscript={transcript:'None runs perfectly'};
  voice.process(voiceTranscript.transcript);
  delete typed.state.activeCasePrompt?.rebuiltAt;delete voice.state.activeCasePrompt?.rebuiltAt;
  assert.deepEqual(voice.state,typed.state);
  typed.process('none');voice.process({transcript:'none'}.transcript);delete typed.state.activeCasePrompt?.rebuiltAt;delete voice.state.activeCasePrompt?.rebuiltAt;
  assert.deepEqual(voice.state,typed.state);
});

test('V1 refresh between repair and testing answers preserves the authoritative pointer',()=>{
  const first=intakeHarness(awaitingRepairs());first.process('None runs perfectly');
  const restored=intakeHarness(JSON.parse(JSON.stringify(first.state)));
  restored.process('none');
  assert.equal(restored.state.previousRepairs,'None runs perfectly');
  assert.equal(restored.state.previousTests,'None');
  assert.equal(restored.state.intakeStep,'complete');
  assert.equal(restored.state.stage,'diagnostic');
});

test('V1 migrates a pre-pointer tests-stage case to previous testing on PWA resume',()=>{
  const legacyStart=html.indexOf('function legacyIntakeStep('),legacyEnd=html.indexOf('function load(',legacyStart);
  const legacy=Function(`${html.slice(legacyStart,legacyEnd)};return legacyIntakeStep`)();
  assert.equal(legacy('repairs'),'previous-repairs');
  assert.equal(legacy('tests'),'previous-testing');
  assert.equal(legacy('diagnostic'),'complete');
});

test('V1 Developer Mode exposes intake pointer and both committed fields',()=>{
  assert.match(html,/Intake Step: \$\{esc\(state\.intakeStep\)\}/);
  assert.match(html,/Previous Repairs: \$\{esc\(state\.previousRepairs\|\|'Not recorded'\)\}/);
  assert.match(html,/Previous Testing: \$\{esc\(state\.previousTests\|\|'Not recorded'\)\}/);
});
