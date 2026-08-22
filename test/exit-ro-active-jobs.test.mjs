import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Exit RO is persistent during RO workflow and has nested workflow controls',()=>{
  assert.match(html,/id="exitRoControl"[^>]*>Exit RO/);
  assert.match(html,/exit-ro-control\.visible/);
  assert.match(html,/id="exitRoEvidence"[^>]*>Exit RO/);
  assert.match(html,/id="exitRoGuide"[^>]*>Exit RO/);
  assert.match(html,/id="exitRoDiagnostic"[^>]*>Exit RO/);
});

test('Exit RO saves and returns directly to the Active Jobs switcher without discard or archive',()=>{
  const exitSource=html.slice(html.indexOf('async function exitCurrentRepairOrder'),html.indexOf('function updateExitRoControl'));
  assert.match(html,/async function exitCurrentRepairOrder\(\)\{await persist\('exit repair order to active jobs',true\);/);
  assert.match(html,/core\.showScreen\('home'\);await renderActiveJobs\(\);\$\('activeJobsModal'\)\?\.classList\.remove\('hidden'\)/);
  assert.doesNotMatch(exitSource,/(?:abandon\(|archiveSavedWork\(|remove\(activeId\))/);
  assert.match(html,/\['exitRoControl','exitRoEvidence','exitRoGuide','exitRoDiagnostic'\]/);
});

test('Exit RO keeps existing Active Jobs and isolated resume paths available',()=>{
  assert.match(html,/id="quickActiveJobs"/);
  assert.match(html,/async function openRepairOrder\(id\)/);
  assert.match(html,/await core\.setActivePhotoRecord\?\.\(activeId\)/);
  assert.match(html,/record\.diagnosticInformation\)localStorage\.setItem\('nitros_diagnostic_case_v10120'/);
});
