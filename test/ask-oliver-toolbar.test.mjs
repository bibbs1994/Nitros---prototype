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

test('Ask Oliver carries active RO and inspection context into the existing assistant',()=>{
  assert.match(toolbar,/window\.NitrosRepairOrderCore\?\.collectDraft\?\.\(\)/);
  for(const field of ['customer','ro','vehicle','vin','mileage','stage','screen','section','findings','measurements','notes','dtcs','photos'])assert.match(toolbar,new RegExp(`${field}(?::|,)`));
  assert.match(toolbar,/window\.NitrosSmartOliver\?\.openContextual\?\.\(context\(\)\)/);
  assert.match(html,/window\.NitrosSmartOliver=Object\.freeze\(\{openContextual:openConsultation/);
  assert.match(html,/Current inspection section: \$\{c\.section\}/);
});

test('opening and closing contextual Oliver preserves the active screen and scroll position',()=>{
  assert.match(html,/returnPosition=\{screen:payload\.screen\|\|document\.querySelector\('\.screen\.active'\)\?\.id\|\|'',scrollY:window\.scrollY\}/);
  assert.match(html,/requestAnimationFrame\(\(\)=>window\.scrollTo\(0,saved\.scrollY\)\)/);
  assert.doesNotMatch(toolbar,/NitrosGuidedWalkthrough\.(?:start|restart)/);
  assert.doesNotMatch(toolbar,/(?:showScreen|startNewRepairOrder|openRepairOrder)\(/);
});
