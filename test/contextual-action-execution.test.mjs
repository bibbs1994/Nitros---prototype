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
  assert.match(guided,/guidedWalkthroughShow'\)\.addEventListener\('click',\(\)=>contextualMode\?executeContextualAction\(contextualStep\)/);
  assert.match(guided,/afterStepId:.*contextualStep\?\.id/);
});

test('Why uses the active contextual field rather than the full walkthrough fallback',()=>{
  assert.match(guided,/function whyContextual\(\)\{const step=contextualStep/);
  assert.match(guided,/step\?\.why\|\|step\?\.instruction/);
  assert.match(guided,/guidedWalkthroughWhy'\)\.addEventListener\('click',\(\)=>contextualMode\?whyContextual\(\):help\('why'\)/);
  assert.doesNotMatch(guided,/guidedWalkthroughWhy'\)\.addEventListener\('click',\(\)=>help\('why'\)/);
});

test('Digital Inspection steps have field-specific Why explanations',()=>{
  for(const phrase of ['tire pressure','remaining pad material','Rotor condition','Fluid level, condition','Lighting and wiper condition','Battery condition and charging','Photos preserve evidence'])assert.match(html,new RegExp(phrase,'i'));
});
