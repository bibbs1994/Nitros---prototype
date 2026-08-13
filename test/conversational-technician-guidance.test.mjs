import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('10.12.62 exposes persistent conversational evidence and developer trace state',()=>{
  assert.match(html,/const blankGuidance=\(\)=>\(\{knowledgeSource:'generic-diagnostic-knowledge'/);
  assert.match(html,/conversationalGuidance:Object\.assign\(blankGuidance\(\),x\.conversationalGuidance\|\|\{\}\)/);
  assert.match(html,/window\.NitrosConversationalGuidanceCore=Object\.freeze/);
  assert.match(html,/Service Information Provider:/);
  assert.match(html,/Next-Test Reason:/);
  assert.match(html,/Next Required Evidence:/);
});

test('conversation routes completed checks, prior repair, unavailable scope, and excessive ground drop',()=>{
  assert.match(html,/power and ground both passed/i);
  assert.match(html,/won't recommend replacing it again/i);
  assert.match(html,/No scope available — recorded/);
  assert.match(html,/ground side is excessive voltage drop/i);
  assert.match(html,/ground-path-segment-isolation/);
  assert.match(html,/alternate-non-scope-test/);
});

test('voice implementation remains frozen while diagnostic guidance changes',()=>{
  assert.match(html,/window\.NitrosOliverSpeech=\(\(\)=>\{/);
  assert.match(html,/rate:\.94,pitch:\.995,volume:\.88/);
  assert.match(html,/rate:\.94,pitch:\.995,volume:\.88,gain:\.88/);
  assert.match(html,/utterance=new SpeechSynthesisUtterance\(text\)/);
});

test('blower high-only and P0340 guidance remain evidence-first and non-condemning',()=>{
  assert.match(html,/A lower-speed control fault is possible but no component is confirmed failed/);
  assert.match(html,/The guided P0340 checks are complete/);
  assert.match(html,/do not replace a part from this evidence alone/i);
});
