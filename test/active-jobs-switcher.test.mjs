import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('persistent quick toolbar exposes Active Jobs without adding a floating overlay',()=>{
  assert.match(html,/id="quickActiveJobs"[^>]*>🗂️<br>Active Jobs/);
  assert.match(html,/grid-template-columns:repeat\(7,1fr\)/);
  assert.match(html,/id="activeJobsModal"/);
  assert.doesNotMatch(html,/floating-active-jobs/);
});

test('opening the switcher saves current work and displays human-readable active RO cards',()=>{
  assert.match(html,/async function showActiveJobs\(\)\{if\(activeJobsOpening\)return;activeJobsOpening=true;try\{await persist\('open active jobs switcher',true\);await renderActiveJobs\(\)/);
  assert.match(html,/async function renderActiveJobs\(\)/);
  assert.match(html,/savedWorkLabel\(record\)/);
  assert.match(html,/Current job/);
  assert.match(html,/document\.addEventListener\('click',event=>\{if\(!event\.target\.closest\('#quickActiveJobs'\)\)return;event\.preventDefault\(\);event\.stopImmediatePropagation\(\);showActiveJobs\(\)\},true\)/);
  assert.match(html,/escape=value=>String\(value\?\?''\)\.replace/);
  const rendererSource=html.slice(html.indexOf('async function renderActiveRepairOrders'),html.indexOf('let activeJobsOpening'));
  assert.doesNotMatch(rendererSource,/escapeHtml\(/);
});

test('switching uses the existing isolated RO restore and New Walk-In honors draft protection',()=>{
  assert.match(html,/await openRepairOrder\(button\.dataset\.roId\)/);
  assert.match(html,/activeJobsNewRo'\)\?\.addEventListener\('click',async\(\)=>\{\$\('activeJobsModal'\)\?\.classList\.add\('hidden'\);await startNewRepairOrder\(\)\}/);
  assert.match(html,/const choice=await chooseNewRoAction\(\)/);
  assert.match(html,/await core\.setActivePhotoRecord\?\.\(activeId\)/);
});
