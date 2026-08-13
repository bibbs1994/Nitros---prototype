import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const analyzer=readFileSync(new URL('../image-analysis-ad.js',import.meta.url),'utf8');

test('A: symptom entry recognizes free-form HVAC complaint without an intake gate',()=>{
  assert.match(html,/ONLY WORKS ON HIGH/);
  assert.match(html,/caseData\.system=\/blower\/i\.test\(system\)\?'HVAC'/);
  assert.match(html,/vinRequired:false,engineRequired:false,repairOrderRequired:false/);
});

test('B: DTC entry preserves normalization and evidence-first diagnosis',()=>{
  assert.match(html,/t=t\.replace\(\/\\b\(\[PCBU\]\)/);
  assert.match(html,/return'dtc-diagnosis'/);
  assert.match(html,/test target, not a confirmed failed part/);
});

test('C: repair request is independently classified and OEM claims remain guarded',()=>{
  assert.match(html,/return'repair-replacement-guidance'/);
  assert.match(html,/ball joint\|wiring harness/);
  assert.match(html,/vehicle-specific torque values and procedures must be verified/);
});

test('D: follow-up component location uses persisted vehicle and complaint context',()=>{
  assert.match(html,/conversationStorageKey\(\)/);
  assert.match(html,/blower-speed resistor or control module/);
});

test('E: explicit corrections replace active vehicle fields',()=>{
  assert.match(html,/correction=raw\.match/);
  assert.match(html,/for\(const key of \['year','make','model','engine'\]\)if\(corrected\[key\]\)caseData\[key\]=corrected\[key\]/);
});

test('F: new topic resets only the conversational case',()=>{
  assert.match(html,/new case\|start new case\|reset case\|clear case\|different vehicle/);
  assert.match(html,/resetNaturalCase\(\);window\.NitrosDiagnosticV10120\?\.reset/);
  assert.doesNotMatch(html,/resetNaturalCase\(\)[^\n]+localStorage\.clear/);
});

test('G: approved graph and rendered-evidence architecture remains present',()=>{
  const graphArchitecture=html+'\n'+analyzer;
  for(const marker of ['renderedPidEvidence','Diagnostic Significance','Next Test','Why'])assert.match(graphArchitecture,new RegExp(marker));
});

test('developer diagnostics expose universal routing and context state',()=>{
  for(const marker of ['Universal Technician Entry:','detectedIntent','conversationContextId','contextDisposition','routingTarget'])assert.match(html,new RegExp(marker));
});
