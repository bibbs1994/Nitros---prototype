import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const authority=html.indexOf("const STATE_KEY='nitros_diagnostic_case_v10120'");
function extract(name,next){const start=html.indexOf(`function ${name}(`,authority),end=html.indexOf(`function ${next}(`,start);assert.ok(start>=0&&end>start);return html.slice(start,end).trim()}
const normalizeBlowerResult=Function(`return (${extract('normalizeBlowerResult','handleBlowerGuidedResult')})`)();

test('natural confirmation responses normalize into authoritative split blower evidence',()=>{
  for(const response of ['Yes.','It works on high only.','One through three are dead but four works.','High works. Nothing on the lower speeds.']){
    const result=normalizeBlowerResult('blower-symptom-confirmation',response);assert.ok(result,response);assert.equal(result.status,'FAIL');assert.equal(result.facts.blowerHighSpeed,'OPERATES');assert.equal(result.facts.lowerBlowerSpeeds,'INOPERATIVE');
  }
});

test('guided HVAC workflow enforces one pending test and persists evidence',()=>{
  assert.match(html,/currentTestStatus:'PENDING',completedTests:\[\],evidence:\[\],passedTests:\[\],failedTests:\[\],nextTest:null,diagnosticConclusionState:'UNCONFIRMED'/);
  assert.match(html,/activateBlowerTest\('blower-symptom-confirmation'\)/);
  assert.match(html,/guided\.completedTests\.push\(record\);guided\.evidence\.push\(record\)/);
  assert.match(html,/activateBlowerTest\('blower-control-connector-inspection'\)/);
  assert.match(html,/Since high speed operates, the blower motor is capable of running/);
  assert.match(html,/test targets, not confirmed failed parts|no component is confirmed failed/i);
});

test('shop-language connector and command findings drive deterministic branches',()=>{
  assert.equal(normalizeBlowerResult('blower-control-connector-inspection',"Connector's melted.").status,'FAIL');
  assert.equal(normalizeBlowerResult('blower-control-connector-inspection','Looks good.').status,'PASS');
  assert.equal(normalizeBlowerResult('blower-lower-speed-command-test','Nothing changes when I move the switch.').status,'FAIL');
  assert.equal(normalizeBlowerResult('blower-lower-speed-command-test',"I've got 12 volts there.").status,'PASS');
});

test('authoritative display exposes guided test state without OEM fabrication',()=>{
  for(const label of ['Current Diagnostic Test:','Current Test Status:','Completed Tests:','Evidence:','Failed Tests:','Passed Tests:','Next Test:','Diagnostic Conclusion State:'])assert.match(html,new RegExp(label));
  assert.match(html,/Exact cavities and wire colors require verified service information/);
});

test('Talk establishes voice session, final replies auto-speak once, and replay is forced',()=>{
  assert.match(html,/NitrosOliverVoiceSession=\{active:true,awaitingReply:true/);
  assert.match(html,/nitros:oliver-final-reply/);
  assert.match(html,/speakOliver\(clean\)/);
  assert.match(html,/clean===lastRequestText&&now-lastRequestAt<1200/);
  assert.match(html,/force:true/);
  assert.match(html,/browserProvider\.cancel\(\);browserProvider\.resume\(\)/);
});
