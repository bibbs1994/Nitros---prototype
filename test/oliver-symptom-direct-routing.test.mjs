import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

const authoritativeStart=html.indexOf("const STATE_KEY='nitros_diagnostic_case_v10120'");
function extract(name,next){const start=html.indexOf(`function ${name}(`,authoritativeStart),end=html.indexOf(`function ${next}(`,start);assert.ok(start>=0&&end>start);return html.slice(start,end).trim()}
const symptomFacts=Function(`return (${extract('symptomFacts','concern')})`)();
const parseVehicle=Function(`const normalize=value=>String(value);return (${extract('parseVehicle','symptomFacts')})`)();

test('10.12.51 normalizes blower high-only language while retaining original wording',()=>{
  const expected='HVAC blower operates only at highest speed / lower blower speeds inoperative';
  for(const phrase of ['blower only works on high','fan only works on high','heater fan only has high speed','no low blower speeds','blower speeds 1 2 and 3 don\'t work','only maximum fan speed works']){
    const fact=symptomFacts(phrase);assert.ok(fact,phrase);assert.equal(fact.normalized,expected,phrase);assert.equal(fact.system,'HVAC');assert.equal(fact.domain,'HVAC / Blower Diagnostic');
  }
  assert.equal(symptomFacts('blower only works on high').original,'blower only works on high');
});

test('exact live utterance captures engine and manual HVAC configuration',()=>{
  assert.deepEqual(parseVehicle('2016 Jeep Wrangler 3.6 manual three knob HVAC blower only works on high'),{year:'2016',make:'Jeep',model:'Wrangler',engine:'3.6L',configuration:'Manual three-knob HVAC'});
  assert.match(html,/const eng=\(t\.match\(\/\\b\(\\d\\\.\\d\)\\s\*\(\?:L\|liter\)\?\\b\/i/);
  assert.match(html,/Manual three-knob HVAC/);
  assert.match(html,/vehicle:\{year:'',make:'',model:'',engine:'',drivetrain:'',configuration:''\}/);
});

test('symptom without a DTC atomically enters HVAC diagnosis',()=>{
  assert.match(html,/if\(symptom&&!found\.length\)\{state\.activeDtc='';state\.intakeStep='complete';state\.stage='diagnostic'/);
  assert.match(html,/No trouble code is required to start this diagnosis/);
  assert.match(html,/blower-symptom-confirmation/);
  assert.match(html,/no component is confirmed failed/);
  assert.match(html,/Exact cavities and wire colors require verified service information/);
});

test('authoritative display agrees with normalized symptom workflow',()=>{
  for(const label of ['Configuration:','Active DTC:','Complaint:','Normalized Symptom:','Workflow:','Stage:','Intake Step:'])assert.match(html,new RegExp(label));
  assert.match(html,/if\(state\.diagnosticDomain\)return state\.diagnosticDomain/);
});
