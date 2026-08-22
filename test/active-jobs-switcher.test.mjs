import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('persistent quick toolbar exposes Active Jobs without adding a floating overlay',()=>{
  assert.match(html,/id="quickActiveJobs"[^>]*>🗂️<br>Active Jobs/);
  assert.match(html,/grid-template-columns:repeat\(6,1fr\)/);
  assert.match(html,/id="activeJobsModal"/);
  assert.doesNotMatch(html,/floating-active-jobs/);
});

test('opening the switcher saves current work and displays human-readable active RO cards',()=>{
  assert.match(html,/async function showActiveJobs\(\)\{await persist\('open active jobs switcher',true\);await renderActiveJobs\(\)/);
  assert.match(html,/async function renderActiveJobs\(\)/);
  assert.match(html,/savedWorkLabel\(record\)/);
  assert.match(html,/Current job/);
  assert.match(html,/quickActiveJobs'\)\?\.addEventListener\('click',showActiveJobs\)/);
});

test('switching uses the existing isolated RO restore and New Walk-In saves instead of discarding',()=>{
  assert.match(html,/await openRepairOrder\(button\.dataset\.roId\)/);
  assert.match(html,/activeJobsNewRo'\)\?\.addEventListener\('click',async\(\)=>\{\$\('activeJobsModal'\)\?\.classList\.add\('hidden'\);await startNewRepairOrder\(true\)\}/);
  assert.match(html,/const choice=skipChoice\?'save':await chooseNewRoAction\(\)/);
  assert.match(html,/await core\.setActivePhotoRecord\?\.\(activeId\)/);
});
