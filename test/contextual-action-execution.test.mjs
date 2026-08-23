import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const guided=html.match(/<script id="nitros-guided-walkthrough-phase1">([\s\S]*?)<\/script>/)?.[1]||'';

test('contextual assistance executes structured actions through walkthrough navigation and highlighting',()=>{
  assert.match(guided,/function executeContextualAction\(step/);
  assert.match(guided,/navigateToStep\(action\)/);
  assert.match(guided,/NitrosContextualScreenAssistance\?\.show\(\{\.\.\.action,el\}\)/);
  assert.match(guided,/function renderContextualStep\(step/);
  assert.match(guided,/function nextContextual\(\)/);
});

test('Next and Show Me act on the actual current contextual target',()=>{
  assert.match(guided,/guidedWalkthroughNext'\)\.addEventListener\('click',\(\)=>contextualMode\?nextContextual\(\)/);
  assert.match(guided,/guidedWalkthroughShow'\)\.addEventListener\('click',\(\)=>contextualMode\?\(logContextualAction\('Show Me'\),executeContextualAction\(contextualStep\)\)/);
  assert.match(guided,/afterStepId:.*contextualStep\?\.id/);
});

test('Why uses the active contextual field rather than the full walkthrough fallback',()=>{
  assert.match(guided,/function whyContextual\(\)\{logContextualAction\('Why'\);const step=contextualStep/);
  assert.match(guided,/step\?\.why\|\|step\?\.instruction/);
  assert.match(guided,/guidedWalkthroughWhy'\)\.addEventListener\('click',\(\)=>contextualMode\?whyContextual\(\):help\('why'\)/);
  assert.doesNotMatch(guided,/guidedWalkthroughWhy'\)\.addEventListener\('click',\(\)=>help\('why'\)/);
});

test('Digital Inspection steps have field-specific Why explanations',()=>{
  for(const phrase of ['tire pressure','remaining pad material','Rotor condition','Fluid level, condition','Lighting and wiper condition','Battery condition and charging','Photos preserve evidence'])assert.match(html,new RegExp(phrase,'i'));
});

test('Digital Inspection continues through repair priorities instead of ending at the first mapped subsection',()=>{
  for(const id of ['priority-immediate','priority-soon','priority-monitor','technician-signature','customer-signature','build-estimate'])assert.match(html,new RegExp(`id:'${id}'`));
  assert.match(guided,/discoverNext\(currentScreen,contextualStep\?\.target\)/);
  assert.doesNotMatch(guided,/There are no more actionable controls in this contextual sequence/);
});

test('unresolved contextual next steps retain ticket-ready diagnostics',()=>{
  for(const field of ['UNRESOLVED_NEXT_CONTROL','route:currentScreen','inspectionSection','activeRO','vehicle','currentStepId','lastSuccessfulTarget','attemptedNextTarget','recentActions','nitros:contextual-walkthrough-unresolved'])assert.match(guided,new RegExp(field.replace(/[?:]/g,'\\$&')));
  assert.match(guided,/Walkthrough could not determine the next control\./);
});

test('Building Estimate has deterministic controls and preserves estimate context after the inspection transition',()=>{
  for(const id of ['estimate-labor-rate','estimate-repair-operation','estimate-labor-lookup','estimate-labor-hours','estimate-line-description','estimate-line-parts','estimate-add-line','estimate-supplies','estimate-tax','estimate-authorization-status','estimate-create-workorder'])assert.match(html,new RegExp(`id:'${id}'`));
  assert.match(guided,/const liveScreen=context\(\)\.screen;if\(liveScreen!==contextualPayload\?\.screenId\)contextualPayload=/);
  assert.match(html,/current==='estimate'\?'Building Estimate'/);
  assert.match(guided,/estimate:'The estimate converts documented findings into priced, authorized repair work\.'/);
});

test('Job Clock stage completes once and routes to the real Completion Wizard screen',()=>{
  assert.match(html,/id:'workorder-internal-technician-notes',[\s\S]*?nextScreen:'review'/);
  assert.match(html,/review:\[\{id:'review-save-report',screen:'review',target:'#submitCheckin'/);
  assert.match(guided,/let state=null,[\s\S]*?contextualCompletedStages=\[\]/);
  assert.match(guided,/function completeContextualStage\(step,currentScreen\)/);
  assert.match(guided,/contextualCompletedStages\.push\(currentScreen\)/);
  assert.match(guided,/navigateToStep\(\{screen:nextScreen\}\)/);
  assert.match(guided,/if\(completeContextualStage\(contextualStep,currentScreen\)\)return/);
  assert.match(guided,/if\(!contextualCompletedStages\.includes\(currentScreen\)\)step=window\.NitrosContextualScreenAssistance\?\.discoverNext/);
});
