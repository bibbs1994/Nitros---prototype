import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const authority=html.indexOf("const STATE_KEY='nitros_diagnostic_case_v10120'");
function extract(name,next){const start=html.indexOf(`function ${name}(`,authority),end=html.indexOf(`function ${next}(`,start);assert.ok(start>=0&&end>start);return html.slice(start,end).trim()}
const normalizeBlowerResult=Function(`return (${extract('normalizeBlowerResult','handleBlowerSpeedRecheck')})`)();
const contextualNumericSpeechRecovery=Function(`return (${extract('contextualNumericSpeechRecovery','blowerCommandResponseEvidence')})`)();
const commandResponseHarness=Function(`let state={complaint:'blower only works on high',normalizedSymptom:'lower blower speeds inoperative',componentTestState:{workflowId:'hvac-blower-speed-control',evidence:[{normalizedEvidence:'Speeds 1–3 inoperative; speed 4 operative',facts:{speedStates:{1:'INOPERATIVE',2:'INOPERATIVE',3:'INOPERATIVE',4:'OPERATIVE'}}}]}};${extract('contextualNumericSpeechRecovery','normalizeBlowerResult')};return text=>blowerCommandResponseEvidence(text)`)();

test('natural confirmation responses normalize into authoritative split blower evidence',()=>{
  for(const response of ['Yes.','It works on high only.','One through three are dead but four works.','High works. Nothing on the lower speeds.']){
    const result=normalizeBlowerResult('blower-symptom-confirmation',response);assert.ok(result,response);assert.equal(result.status,'FAIL');assert.equal(result.facts.blowerHighSpeed,'OPERATES');assert.equal(result.facts.lowerBlowerSpeeds,'INOPERATIVE');
  }
});

test('10.12.63 active blower question recognizes numbered, high-only, all, none, and partial shop language',()=>{
  const highOnly=['The blower only works on number four.','Only high works.','Nothing except number four.','Four works but the first three don\'t.'];
  for(const response of highOnly){const result=normalizeBlowerResult('blower-symptom-confirmation',response);assert.ok(result,response);assert.equal(result.facts.speedStates[1],'INOPERATIVE');assert.equal(result.facts.speedStates[4],'OPERATIVE')}
  const lowerOnly=normalizeBlowerResult('blower-symptom-confirmation','One through three are dead.');assert.equal(lowerOnly.status,'INCONCLUSIVE');assert.deepEqual(lowerOnly.facts.missingSpeeds,[4]);
  const all=normalizeBlowerResult('blower-symptom-confirmation','All four work.');assert.deepEqual(Object.values(all.facts.speedStates),['OPERATIVE','OPERATIVE','OPERATIVE','OPERATIVE']);
  const none=normalizeBlowerResult('blower-symptom-confirmation','None of them work.');assert.deepEqual(Object.values(none.facts.speedStates),['INOPERATIVE','INOPERATIVE','INOPERATIVE','INOPERATIVE']);
  const split=normalizeBlowerResult('blower-symptom-confirmation',"One and two work but three and four don't.");assert.deepEqual(Object.values(split.facts.speedStates),['OPERATIVE','OPERATIVE','INOPERATIVE','INOPERATIVE']);
});

test('10.12.63 accepts terse active-question shorthand without promoting hypotheses or ambiguity',()=>{
  for(const response of ['Blow only works on number four','It only works on high.','High is the only speed.','Only full blast works.','Speed four works, that\'s it.','Four.']){
    const result=normalizeBlowerResult('blower-symptom-confirmation',response);assert.ok(result,response);assert.equal(result.facts.blowerHighSpeed,'OPERATES');assert.equal(result.facts.lowerBlowerSpeeds,'INOPERATIVE');
  }
  assert.equal(normalizeBlowerResult('blower-symptom-confirmation','It works sometimes.'),null);
  assert.equal(normalizeBlowerResult('blower-symptom-confirmation','Probably the resistor.'),null);
  assert.equal(normalizeBlowerResult('unrelated-test','Four.'),null);
});

test('10.12.63 contextually recovers merged speed speech while protecting decimals and pin identifiers',()=>{
  const recovered=contextualNumericSpeechRecovery('speeds one through four command but 12 and three do not work',{domain:'blower-speed-positions-1-4'});assert.equal(recovered.accepted,true);assert.deepEqual(recovered.recoveredSequence,[1,2,3]);assert.equal(recovered.recoveryConfidence,'high');
  assert.equal(contextualNumericSpeechRecovery('Battery voltage is 12.3 volts',{domain:'blower-speed-positions-1-4'}).reason,'decimal-measurement');
  assert.equal(contextualNumericSpeechRecovery('Pin 12 has five volts',{domain:'blower-speed-positions-1-4'}).reason,'literal-identifier');
  assert.equal(contextualNumericSpeechRecovery('12 and three are out',{domain:'unknown'}).accepted,false);
});

test('10.12.63 structures commanded state separately from observed blower response',()=>{
  for(const phrase of ['Scan data shows speeds one through four all being commanded but 12 and three do not work.','Scan data commands speeds one through four. One, two, and three don\'t work. Four works.']){const result=commandResponseHarness(phrase);assert.ok(result,phrase);assert.equal(result.evidenceType,'COMMANDED_STATE_VS_OBSERVED_RESPONSE');assert.deepEqual(Object.values(result.commandStates),['PRESENT','PRESENT','PRESENT','PRESENT']);assert.deepEqual(Object.values(result.observedStates),['INOPERATIVE','INOPERATIVE','INOPERATIVE','OPERATIVE'])}
});

test('10.12.63 commits conversational observations before advancing and guards duplicates and conflicts',()=>{
  assert.match(html,/evidenceSource:'conversational-technician-observation'/);
  assert.match(html,/duplicate=guided\.evidence\.some/);
  assert.match(html,/diagnosticConclusionState='CONFLICTING_EVIDENCE'/);
  assert.match(html,/handleBlowerSpeedRecheck\(guided,current,text\)/);
  assert.match(html,/Committed Conversational Observations:/);
  assert.match(html,/selectGuidanceTest\(next\.id,next\.name,reason,next\.prompt\);ask/);
});

test('guided HVAC workflow enforces one pending test and persists evidence',()=>{
  assert.match(html,/currentTestStatus:'PENDING',completedTests:\[\],evidence:\[\],passedTests:\[\],failedTests:\[\],nextTest:null,diagnosticConclusionState:'UNCONFIRMED'/);
  assert.match(html,/activateBlowerTest\('blower-symptom-confirmation'\)/);
  assert.match(html,/if\(!duplicate\)guided\.evidence\.push\(record\)/);
  assert.match(html,/guided\.completedTests\.push\(record\)/);
  assert.match(html,/activateBlowerTest\('blower-control-connector-inspection'\)/);
  assert.match(html,/Since speed 4, the highest setting, operates, the blower motor is capable of running/);
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
