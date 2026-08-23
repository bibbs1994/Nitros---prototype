import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const toolbar=html.match(/<script id="nitros-ask-oliver-toolbar">([\s\S]*?)<\/script>/)?.[1]||'';

test('Ask Oliver is a persistent seventh toolbar action, not a new floating control',()=>{
  assert.match(html,/id="quickAskOliver"[^>]*aria-label="Ask Oliver for help with this repair order"[^>]*>🧠<br>Ask Oliver/);
  assert.match(html,/\.quick-toolbar\{[^}]*grid-template-columns:repeat\(7,1fr\)/);
  assert.doesNotMatch(html,/ask-oliver-(?:fab|floating)/i);
});

test('Ask Oliver carries active RO and inspection context into Guided Walkthrough assistance',()=>{
  assert.match(toolbar,/window\.NitrosRepairOrderCore\?\.collectDraft\?\.\(\)/);
  for(const field of ['customer','ro','vehicle','vin','mileage','stage','screenId','screen','section','findings','measurements','notes','dtcs','photos'])assert.match(toolbar,new RegExp(`${field}(?::|,)`));
  assert.match(toolbar,/window\.NitrosGuidedWalkthrough\?\.openContextual\?\.\(context\(\)\)/);
  assert.doesNotMatch(toolbar,/NitrosSmartOliver/);
  assert.match(html,/openContextual,exit:stop/);
  assert.match(html,/Current inspection section: \$\{payload\.section\}/);
});

test('toolbar opens contextual mode without navigating the active portal screen',()=>{
  assert.match(html,/function openContextual\(payload=\{\}\)\{state=null;contextualMode=true/);
  assert.match(html,/Current portal screen: \$\{name\}/);
  assert.match(html,/guidedWalkthroughContextualAsk/);
  assert.doesNotMatch(toolbar,/NitrosGuidedWalkthrough\.(?:start|restart)/);
  assert.doesNotMatch(toolbar,/(?:showScreen|startNewRepairOrder|openRepairOrder)\(/);
});
