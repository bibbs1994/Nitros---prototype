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
