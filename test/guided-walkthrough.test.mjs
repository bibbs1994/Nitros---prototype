import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script id="nitros-guided-walkthrough-phase1">([\s\S]*?)<\/script>/)?.[1]||'';

test('Guided Walkthrough is an optional real-portal guidance layer',()=>{
  assert.match(html,/id="guidedWalkthroughLaunch"[^>]*>Guided Walkthrough/);
  assert.match(html,/Your actual RO and vehicle information remain part of the normal portal workflow/);
  assert.match(script,/target:'\[data-go="schedule"\]'/);
  assert.match(script,/target:'#quickActiveJobs'/);
  assert.match(script,/target:'#quickVehicleButton'/);
  assert.match(script,/document\.addEventListener\('click'/);
  assert.match(script,/el\.scrollIntoView/);
});

test('walkthrough progress is isolated, resumable, restart-confirmed, and non-destructive',()=>{
  assert.match(script,/STORAGE_KEY='nitros_guided_walkthrough_v1'/);
  assert.match(script,/active:true/);
  assert.match(script,/completed:/);
  assert.match(script,/skipped:/);
  assert.match(html,/Resume Walkthrough/);
  assert.match(script,/hasProgress=Boolean\(saved&&\(saved\.active\|\|saved\.stepIndex>0\|\|saved\.completed\?\.length\|\|saved\.skipped\?\.length\)\)/);
  assert.match(script,/confirm\('Restart the walkthrough\? This only clears walkthrough progress; it will not change any repair order or vehicle data\.'/);
  assert.doesNotMatch(script,/removeItem\('activeRepairOrderId'\)|resetActiveWorkspace|abandon\(/);
});

test('walkthrough exposes reusable role-ready steps and controls',()=>{
  for(const text of ['Full Workflow','Office','Technician','Future / Not Yet Available','Show Me','Why?','Need help?','Exit Walkthrough'])assert.match(html,new RegExp(text.replace(/[?]/g,'\\$&')));
  assert.match(script,/role:'office'/);
  assert.match(script,/role:'technician'/);
  assert.match(script,/future:true/);
  assert.match(script,/window\.NitrosGuidedWalkthrough=Object\.freeze/);
});
