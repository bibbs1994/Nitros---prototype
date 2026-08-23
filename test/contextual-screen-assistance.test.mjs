import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const contextual=html.match(/<script id="nitros-contextual-screen-assistance">([\s\S]*?)<\/script>/)?.[1]||'';

test('contextual UI questions route before diagnostic guidance',()=>{
  assert.match(html,/ui=window\.NitrosContextualScreenAssistance\?\.resolve\(q,c\)/);
  assert.match(html,/if\(ui\?\.intent\)\{r=ui\.message;window\.NitrosContextualScreenAssistance\.show\(ui\.target\);\}/);
  assert.match(contextual,/type:'contextual_ui_help'/);
  for(const phrase of ['where do i start','how do i use this','walk me through this','show me the next one'])assert.match(contextual,new RegExp(phrase));
});

test('inspection help uses detailed controls and a shared show-me registry',()=>{
  for(const target of ['#batteryStatus','#lightsStatus','#fluidsStatus','#tiresStatus','#brakesStatus','#lfTread','#lfPad','#frontRotor','#technicianPhoto','#technicianFindings'])assert.match(contextual,new RegExp(target.replace(/[.#]/g,'\\$&')));
  assert.match(contextual,/Object\.freeze\(\{registry,resolve,show,next,clear,actions\}\)/);
  assert.match(contextual,/scrollIntoView\(\{behavior:'smooth',block:'center'/);
});

test('a diagnostic code question remains outside contextual UI matching',()=>{
  assert.doesNotMatch('I have a P0340. What should I test next?',/\b(what (?:do|am) i (?:do|supposed to do)|what(?:s| is) next|where do i start|help me|how do i use this|walk me through this|show me|^next$)\b/i);
});
