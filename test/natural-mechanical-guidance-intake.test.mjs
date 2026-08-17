import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,`missing ${start}`);return html.slice(a,b)};

function harness(){
  const authoritative=html.indexOf("const blank=()=>"),parseStart=html.indexOf('function parseVehicle(text){',authoritative),parseEnd=html.indexOf('function blowerOperatingStateEvidence',parseStart);assert.ok(parseStart>=0&&parseEnd>parseStart);const source=html.slice(parseStart,parseEnd);
  const pending=extract('function setPendingQuestion(','function handleMechanicalGuidanceIntake');
  const handler=extract('function handleMechanicalGuidanceIntake(text){','function handleMixedIntentDiagnosticEvidence');
  const handlerExpression=handler.replace('function handleMechanicalGuidanceIntake(text)','function(text)');
  return Function(`function normalize(text){return String(text||'').trim()}${source};let state={vehicle:{year:'',make:'',model:'',engine:'',configuration:''},component:'',complaint:'',symptoms:'',guidanceRequest:'NO',guidanceIntent:'',routingDiagnostics:{}};let reply='';function vehicleLabel(){return [state.vehicle.year,state.vehicle.make,state.vehicle.model,state.vehicle.engine].filter(Boolean).join(' ')}function ask(text){reply=text}${pending}const mechanical=${handlerExpression};return{run:text=>mechanical(text),parse:parseVehicle,state,get reply(){return reply}}`)();
}

test('mechanical intake consumes vehicle and alternator-removal intent in one pass',()=>{
  const h=harness();assert.equal(h.run("2019 Chevy Equinox I need to replace the alternator what's the easiest way to get it out"),true);
  assert.deepEqual([h.state.vehicle.year,h.state.vehicle.make,h.state.vehicle.model],['2019','Chevrolet','Equinox']);
  assert.equal(h.state.component,'Alternator');assert.equal(h.state.requestedOperation,'Removal / Replacement');assert.equal(h.state.guidanceRequest,'YES');assert.equal(h.state.guidanceIntent,'Mechanical Service Guidance');assert.match(h.reply,/which engine\/configuration/i);assert.doesNotMatch(h.reply,/which model|missing vehicle model/i);
});

test('model-first and make-omitted Equinox requests infer the vehicle without a DTC gate',()=>{
  for(const input of ['Equinox 2019 Chevy, need to change the alternator','I got a 2019 Equinox and need to change the alternator']){const h=harness();assert.equal(h.run(input),true);assert.deepEqual([h.state.vehicle.year,h.state.vehicle.make,h.state.vehicle.model],['2019','Chevrolet','Equinox']);assert.equal(h.state.guidanceRequest,'YES');assert.doesNotMatch(h.reply,/DTC|diagnostic code|which model/i)}
});

test('supplied engine proceeds to actionable guidance without asking for known facts',()=>{
  const h=harness();assert.equal(h.run('2019 Chevy Equinox 1.5 turbo, walk me through getting the alternator out'),true);assert.deepEqual([h.state.vehicle.year,h.state.vehicle.make,h.state.vehicle.model,h.state.vehicle.engine],['2019','Chevrolet','Equinox','1.5L']);assert.equal(h.state.component,'Alternator');assert.match(h.reply,/disconnect the negative battery cable/i);assert.doesNotMatch(h.reply,/which (?:engine|model)/i);
});

test('whole-utterance mechanical routing precedes diagnostic guidance and legacy intake',()=>{
  assert.match(html,/handleMechanicalGuidanceIntake\(text\)\)return[\s\S]{0,100}handleDiagnosticGuidanceRequest\(text\)/);
  assert.match(html,/inputClassification:'WHOLE_UTTERANCE_MECHANICAL_GUIDANCE'/);
  assert.match(html,/function normalizeConfigurationFacts/);
  assert.match(html,/P0704_SWITCH_FUNCTIONAL_TEST_FAILED_NO_STATE_CHANGE/);
});
