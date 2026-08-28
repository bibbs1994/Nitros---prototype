import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('const DTC_PATTERN=');
const end=html.indexOf('function add(',start);
assert.ok(start>=0&&end>start,'authoritative intake helpers were not found');
const helpers=Function(`${html.slice(start,end)};return {normalize,codes,parseVehicle,concern}`)();

const examples=[
  ['I have a P0340 on a 2014 Toyota Camry.','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['2014 Toyota Camry with P0340.','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['Got a P0340, working on a 2014 Camry.','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['P0340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['p0340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['P 0340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['2014 Toyota Camry P0340','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ["I've got a P0 340 on a 2014 Toyota Camry",'P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['PO340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['P O 340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['po340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['code PO340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['2014 Camry with code P0340','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['Toyota Camry 2014, P0-3.4_0','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['U 0 1 0 0 2018 Ford F-150','U0100',{year:'2018',make:'Ford',model:'F-150'}],
  ['2016 Chevy Silverado with a code P06DD','P06DD',{year:'2016',make:'Chevrolet',model:'Silverado'}],
  ['2016 Chevrolet Silverado with a P06DD and the check engine light is on','P06DD',{year:'2016',make:'Chevrolet',model:'Silverado'}],
  ['2016 Chevrolet Silverado code P zero six D D','P06DD',{year:'2016',make:'Chevrolet',model:'Silverado'}],
  ['2016 Chevrolet Silverado code PO6DD','P06DD',{year:'2016',make:'Chevrolet',model:'Silverado'}],
  ['2016 Chevrolet Silverado code P06 DD','P06DD',{year:'2016',make:'Chevrolet',model:'Silverado'}],
  ['C-0-0-3-5 2017 Chevrolet Silverado','C0035',{year:'2017',make:'Chevrolet',model:'Silverado'}]
];

test('combined DTC and vehicle intake is order and separator independent',()=>{
  for(const [input,code,vehicle] of examples){
    assert.deepEqual(helpers.codes(input),[code],input);
    assert.deepEqual(helpers.parseVehicle(input),{...vehicle,engine:''},input);
  }
});

test('multiple DTCs are canonicalized, ordered, and not discarded',()=>{
  assert.deepEqual(helpers.codes('2019 Honda Accord has P0 340, U-0-1-0-0 and C0035.'),['P0340','U0100','C0035']);
});

test('ordinary prose does not fabricate a DTC',()=>{
  assert.deepEqual(helpers.codes('Customer says it runs rough on cold mornings.'),[]);
  assert.deepEqual(helpers.codes('Oliver observed oil around the Toyota motor.'),[]);
  assert.equal(helpers.normalize('Oliver observed oil around the Toyota motor.'),'Oliver observed oil around the Toyota motor.');
  assert.equal(helpers.concern('2014 Toyota Camry P0340 with rough idle'),'rough idle');
});

test('authoritative processing applies vehicle, every DTC, and concern before returning',()=>{
  const processSource=html.slice(html.indexOf('function process('),html.indexOf('function renderTranscript('));
  assert.match(processSource,/incomingDtcCodes=codes\(text\)/);
  assert.match(processSource,/const v=parseVehicle\(text\),found=incomingDtcCodes,reportedConcern=concern\(text\)/);
  assert.match(processSource,/state\.dtcs=\[\.\.\.new Set\(\[\.\.\.found,\.\.\.state\.dtcs\]\)\]/);
  assert.match(processSource,/if\(v\|\|found\.length\)/);
});

test('V3 Direct AI combined entry delegates to authoritative state and does not request the DTC again',()=>{
  const sendSource=html.slice(html.indexOf('async function send('),html.indexOf('function closeMode('));
  assert.match(sendSource,/directCodes\.length&&hasVehicleFact&&window\.NitrosDiagnosticV10120/);
  assert.match(sendSource,/window\.NitrosDiagnosticV10120\.process\(text\)/);
  assert.match(sendSource,/const authoritative=window\.NitrosDiagnosticV10120\.getState\(\)/);
  const processSource=html.slice(html.indexOf('function process('),html.indexOf('function renderTranscript('));
  assert.match(processSource,/if\(v\|\|found\.length\)\{if\(!dtcArchitectureReady\)advanceIntake\(\)/);
  assert.match(html,/if\(state\.intakeStep==='status'\)return`Is \$\{state\.activeDtc\} current, pending, history, or intermittent\?`/);
});

test('V3 partial vehicle intake retains approved Camry identity and asks only for year',()=>{
  assert.deepEqual(helpers.parseVehicle('P0340 on a Camry.'),{year:'',make:'Toyota',model:'Camry',engine:''});
  assert.match(html,/What is the missing vehicle \$\{missing\.join\(' and '\)\}\?/);
});

test('standalone DTC, standalone vehicle, and New Case paths remain available',()=>{
  assert.deepEqual(helpers.codes('P0340'),['P0340']);
  assert.deepEqual(helpers.parseVehicle('2014 Toyota Camry'),{year:'2014',make:'Toyota',model:'Camry',engine:''});
  assert.match(html,/resetNaturalCase\(\);window\.NitrosDiagnosticV10120\?\.reset\(\)/);
  assert.match(html,/function reset\(\)\{window\.resetOcrSessionState\?\.\('authoritative New Case command'\);state=blank\(\)/);
});

function statusHarness(input){
  const statusStart=html.indexOf('function diagnosticStatus('),processStart=html.indexOf('function process(',statusStart),processEnd=html.indexOf('function renderTranscript(',processStart);
  assert.ok(statusStart>=0&&processStart>statusStart&&processEnd>processStart,'status intake functions were not found');
  return Function(`
    let state={activeDtc:'P0340',dtcs:['P0340'],status:'',stage:'status',intakeStep:'status',additionalTesting:{active:false},history:[]};
    const replies=[];
    function add(){} function ask(text){replies.push(text)} function isDiagnosticComplete(){return false}
    function isolateMeasurementContext(){return {spans:[],protectedNumericTokens:[]}} function diagnosticMeasurement(){return null} function blowerOperatingStateEvidence(){return null}
    function ensureGuidedState(){throw new Error('guided testing must not run during status intake')}
    function handleGuidedFinding(){throw new Error('guided finding must not run during status intake')}
    function parseVehicle(){throw new Error('vehicle parsing must not run for a status answer')}
    function applyDtcKnowledgeResolution(){}
    function codes(){return []}
    function concern(){throw new Error('concern parsing must not run for a status answer')}
    function advanceIntake(){state.intakeStep=state.status?'complaint':'status';state.stage=state.intakeStep}
    function nextQuestion(){return state.status?'What is the customer complaint?':\`Is \${state.activeDtc} current, pending, history, or intermittent?\`}
    ${html.slice(statusStart,processEnd)}
    process(${JSON.stringify(input)});
    return {state,replies};
  `)();
}

test('VO recognizes all four diagnostic status values in natural technician replies',()=>{
  for(const [input,expected] of [['P0340 is current.','current'],["It's current",'current'],['Current','current'],['The code is pending','pending'],["It's a history code",'history'],['The code is historical','history'],['Intermittent','intermittent']]){
    const result=statusHarness(input);
    assert.equal(result.state.status,expected,input);
    assert.equal(result.state.stage,'complaint',input);
    assert.equal(result.replies.length,1,input);
    assert.match(result.replies[0],new RegExp(`Code status recorded as ${expected}\\. What is the customer complaint\\?`),input);
    assert.doesNotMatch(result.replies[0],/current, pending, history, or intermittent/i,input);
  }
});

test('VO leaves genuinely ambiguous status answers at the status question',()=>{
  const result=statusHarness('I need to check that');
  assert.equal(result.state.status,'');
  assert.equal(result.state.stage,'status');
  assert.match(result.replies[0],/Is P0340 current, pending, history, or intermittent\?/);
});

test('V4 preserves authoritative persistence and one service-worker authority',()=>{
  assert.match(html,/const STATE_KEY='nitros_diagnostic_case_v10120'/);
  assert.equal((html.match(/navigator\.serviceWorker\.register\(/g)||[]).length,1);
  assert.match(html,/version:'10\.13\.87'/);
});
