import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const between=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,`missing ${start}`);return html.slice(a,b)};
function harness(){
  const authoritative=html.indexOf("const blank=()=>"),parseStart=html.indexOf('function parseVehicle(text){',authoritative),parseEnd=html.indexOf('function blowerOperatingStateEvidence',parseStart),parse=html.slice(parseStart,parseEnd),pending=between('function setPendingQuestion(','function handleMixedIntentDiagnosticEvidence');
  return Function(`function normalize(text){return String(text||'').trim()}${parse};let state={vehicle:{year:'',make:'',model:'',engine:'',drivetrain:'',configuration:''},component:'',complaint:'',symptoms:'',guidanceRequest:'NO',guidanceIntent:'',mechanicalGuidanceActive:false,pendingQuestion:null,routingDiagnostics:{}};let reply='';function vehicleLabel(){return [state.vehicle.year,state.vehicle.make,state.vehicle.model,state.vehicle.engine].filter(Boolean).join(' ')}function ask(text){reply=text}${pending};return{run:text=>handleMechanicalGuidanceIntake(text),answer:text=>consumePendingQuestionAnswer(text),state,get reply(){return reply}}`)();
}

test('10.13.38 binds Six cylinder to the pending mechanical configuration question',()=>{
  const h=harness();h.run("Help me install this alternator in this 2019 Chevrolet Equinox. What's the easiest and best way to get that alternator out of there?");assert.equal(h.state.pendingQuestion.target_field,'vehicle.configuration');assert.equal(h.answer('Six cylinder.'),true);assert.equal(h.state.mechanicalGuidanceActive,true);assert.equal(h.state.guidanceIntent,'Mechanical Service Guidance');assert.match(h.state.vehicle.configuration,/Technician-provided: V6.*verification pending/i);assert.equal(h.state.pendingQuestion,null);assert.doesNotMatch(h.reply,/Finding recorded|scan data|symptom-based/i);assert.equal(h.state.stage,'mechanical-guidance');
});

test('natural engine, drivetrain, and shorthand answers bind to mechanical pending context',()=>{
  for(const [question,answer,field,expected] of [
    ['Walk me through replacing the alternator on a 2019 Equinox.','It\'s the 1.5 turbo.','engine','1.5L Turbo'],
    ['Walk me through replacing the alternator on a 2019 Equinox.','1.5.','engine','1.5L'],
    ['Walk me through replacing the alternator on a 2019 Equinox.','V6.','engine','V6'],
  ]){const h=harness();h.run(question);assert.equal(h.state.vehicle.engine,'',answer);assert.equal(h.state.pendingQuestion?.expected_answer_class,'vehicle-configuration',answer);assert.equal(h.answer(answer),true,answer);assert.equal(h.state.vehicle[field],expected,answer);assert.equal(h.state.mechanicalGuidanceActive,true);assert.doesNotMatch(h.reply,/diagnostic|scan data/i)}
  const h=harness();h.run('Help me remove the alternator on a 2019 Equinox.');h.state.pendingQuestion.expected_answer_class='vehicle-configuration';assert.equal(h.answer('all wheel drive'),true);assert.equal(h.state.vehicle.drivetrain,'AWD');assert.equal(h.state.stage,'mechanical-guidance');
});

test('pending answers are routed before generic diagnostic intake and diagnostic dispatcher remains present',()=>{
  assert.match(html,/consumePendingQuestionAnswer\(text\)\)return[\s\S]{0,120}handleMechanicalGuidanceIntake\(text\)/);
  assert.match(html,/diagnosticEvidenceWrite:'BLOCKED'/);
  assert.match(html,/P0704_SWITCH_FUNCTIONAL_TEST_FAILED_NO_STATE_CHANGE/);
  assert.match(html,/function handleP0704ArchitectureDiscriminationEvidence/);
});
