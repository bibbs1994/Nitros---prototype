import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const contextual=html.match(/<script id="nitros-contextual-screen-assistance">([\s\S]*?)<\/script>/)?.[1]||'';
const guided=html.match(/<script id="nitros-guided-walkthrough-phase1">([\s\S]*?)<\/script>/)?.[1]||'';

test('recommended-entry language receives a separate contextual composition intent',()=>{
  assert.match(contextual,/function isRecommendedEntry\(text\)/);
  for(const pattern of [/what should i \(\?:put\|write\|say\)/i,/give me \(\?:an \)\?\(\?:example\|rough idea\)/i,/help me fill/i,/how should i word/i,/suggest a note/i])assert.match(contextual,pattern);
  assert.match(contextual,/const type=isRecommendedEntry\(text\)\?'contextual_recommended_entry'/);
});

test('authorization notes prefer the actual field and never invent approval',()=>{
  assert.match(contextual,/estimate-authorization-notes/);
  assert.match(guided,/\^\(Approved\|Partially Approved\)\$/i);
  assert.match(guided,/isAuthorizationNotes=step\?\.id==='estimate-authorization-notes'\|\|target==='#authorizationNotes'/);
  assert.match(guided,/Example\/template/);
  assert.doesNotMatch(guided,/authorization-notes\|authorization notes/);
  assert.match(guided,/Customer approved \$\{approvedItems\}/);
  assert.match(guided,/method&&method!==\'Not recorded\'/);
  assert.match(guided,/\$0\\\.00/);
});

test('suggested entries remain field-aware and definition questions remain explanatory',()=>{
  assert.match(guided,/function suggestedEntry\(question,step\)/);
  assert.match(guided,/Tire measurements should be actual observed values/);
  assert.match(guided,/Document the measured result, the test conditions/);
  assert.match(guided,/result\.type==='contextual_definition'/);
  assert.match(guided,/result\.target\?\.why\|\|result\.instruction/);
});

test('toolbar retains only the active screen field for generic recommended-entry questions',()=>{
  assert.match(html,/let lastFieldContext=null/);
  assert.match(html,/fieldScreenId:field\?\.screenId\|\|''/);
  assert.match(html,/lastFieldContext\?\.screenId===screen\?\.id\?lastFieldContext:null/);
  assert.match(contextual,/context\.fieldScreenId===current\?context\.fieldId:''/);
  assert.match(html,/window\.NitrosAskOliverContext=Object\.freeze\(\{get:context\}\)/);
  assert.match(guided,/liveContext=window\.NitrosAskOliverContext\?\.get\?\.\(\)\|\|\{\}/);
});

test('authorization notes cannot fall through to diagnostic note guidance',()=>{
  assert.match(guided,/if\(isAuthorizationNotes\)\{/);
  assert.match(guided,/if\(\/findings\|diagnostic\|notes\/i\.test/);
  assert.match(guided,/I recognize \$\{field\.toLowerCase\(\)\}, but I don’t have field-specific guidance/);
});

test('Pause note has a stable work-order step and field-specific contextual guidance',()=>{
  assert.match(contextual,/id:'workorder-pause-note',screen:'workorder',target:'#pauseNote'/);
  assert.match(contextual,/why:'A pause note preserves workflow continuity/);
  assert.match(guided,/isPauseNote=step\?\.id==='workorder-pause-note'\|\|target==='#pauseNote'/);
  assert.match(guided,/if\(isPauseNote\)\{/);
  assert.match(guided,/Diagnosis paused pending additional testing/);
  assert.match(guided,/Repair paused while waiting for ordered parts/);
  assert.match(guided,/Work paused pending customer authorization/);
  assert.match(guided,/Only document the actual reason this RO is being paused/);
});

test('Pause note purpose and why questions resolve without changing walkthrough navigation',()=>{
  assert.match(contextual,/what is this \(\?:field\|screen\) for/);
  assert.match(contextual,/why do i need \(\?:a \)\?pause note/);
  assert.match(contextual,/current==='workorder'\?'Digital Work Order'/);
  assert.match(contextual,/A pause note preserves workflow continuity/);
});

test('Internal technician notes have stable field-specific guidance and safe examples',()=>{
  assert.match(contextual,/id:'workorder-internal-technician-notes',screen:'workorder',target:'#internalTechnicianNotes'/);
  assert.match(contextual,/Internal technician notes preserve verified shop information/);
  assert.match(guided,/isInternalTechnicianNotes=step\?\.id==='workorder-internal-technician-notes'\|\|target==='#internalTechnicianNotes'/);
  assert.match(guided,/Use this area for internal findings and work notes/);
  assert.match(guided,/Vehicle inspected for customer concern/);
  assert.match(guided,/Record any actual measurements, components inspected, unusual conditions, and work performed/);
  assert.match(contextual,/what should my \(\?:tech \)\?notes say/);
});
