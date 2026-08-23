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
  assert.match(script,/target:'#saveAppointment'/);
  assert.match(script,/document\.addEventListener\('click'/);
  assert.match(script,/el\.scrollIntoView/);
});

test('post-appointment steps navigate with the existing portal screen architecture',()=>{
  assert.match(script,/function navigateToStep\(step\)\{if\(!step\|\|step\.future\|\|!step\.screen\)return false/);
  assert.match(script,/core\.showScreen\(step\.screen\)/);
  assert.match(script,/window\.showScreen\(step\.screen\)/);
  assert.match(script,/function render\(\)\{if\(!state\?\.active\)return;const step=current\(\);navigateToStep\(step\)/);
  assert.match(script,/advance\(delta,skipped=false\)[\s\S]*?render\(\)/);
  assert.match(script,/id:'checkin',[\s\S]*?screen:'home'/);
  assert.match(script,/id:'dashboard',[\s\S]*?screen:'home'/);
});

test('inspection documentation photos precede Evidence and Show Me resolves each stable target',()=>{
  const expected=['photo-front-left','photo-front-right','photo-rear-left','photo-rear-right','photo-odometer','photo-vin'];
  for(const id of expected)assert.match(html,new RegExp(`data-walkthrough-target="${id}"`));
  const positions=expected.map(id=>script.indexOf(`id:'${id}'`));
  assert.ok(positions.every((position,index)=>position>=0&&(index===0||position>positions[index-1])));
  assert.ok(script.indexOf("id:'evidence'")>positions.at(-1));
  assert.match(script,/Guided Walkthrough target not found/);
  assert.match(script,/el\.scrollIntoView\(\{behavior:'smooth',block:'center',inline:'nearest'\}\)/);
  assert.match(script,/function positionPanelForTarget\(el\)/);
  assert.match(script,/window\.addEventListener\('resize',\(\)=>\{if\(state\?\.active\)showHighlight\(\)\}\)/);
  assert.match(script,/\^\(BUTTON\|A\)\$\/\.test\(el\.tagName\)/);
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
