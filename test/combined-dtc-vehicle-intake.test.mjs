import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('const DTC_PATTERN=');
const end=html.indexOf('function add(',start);
assert.ok(start>=0&&end>start,'authoritative intake helpers were not found');
const helpers=Function(`${html.slice(start,end)};return {normalize,codes,parseVehicle,concern}`)();

const examples=[
  ['P0340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['p0340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['P 0340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['2014 Toyota Camry P0340','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ["I've got a P0 340 on a 2014 Toyota Camry",'P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['PO340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['P O 340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['po340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['code PO340 2014 Toyota Camry','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['2014 Camry with code P0340','P0340',{year:'2014',make:'',model:'Camry'}],
  ['Toyota Camry 2014, P0-3.4_0','P0340',{year:'2014',make:'Toyota',model:'Camry'}],
  ['U 0 1 0 0 2018 Ford F-150','U0100',{year:'2018',make:'Ford',model:'F-150'}],
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
  assert.match(processSource,/const v=parseVehicle\(text\),found=codes\(text\),reportedConcern=concern\(text\)/);
  assert.match(processSource,/state\.dtcs=\[\.\.\.new Set\(\[\.\.\.found,\.\.\.state\.dtcs\]\)\]/);
  assert.match(processSource,/if\(v\|\|found\.length\)/);
});

test('BF preserves authoritative persistence and one service-worker authority',()=>{
  assert.match(html,/const STATE_KEY='nitros_diagnostic_case_v10120'/);
  assert.equal((html.match(/navigator\.serviceWorker\.register\(/g)||[]).length,1);
  assert.match(html,/version:'10\.12\.7VM'/);
});
