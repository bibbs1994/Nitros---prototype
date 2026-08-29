import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Check-In has one persistence-owned navigation path after sign-in',()=>{
  assert.match(html,/<button id="newRepairOrder" class="btn secondary" type="button">/);
  assert.doesNotMatch(html,/<button id="newRepairOrder"[^>]+data-go=/);
  assert.match(html,/CHECK_IN_CLICK/);
  assert.match(html,/CHECK_IN_NAVIGATION_START/);
  assert.match(html,/CHECK_IN_NAVIGATION_SUCCESS/);
  assert.match(html,/CHECK_IN_NAVIGATION_FAILURE/);
  assert.match(html,/startNewRepairOrder\(\)\.then/);
});

test('technician sign-in and session restoration emit navigation diagnostics',()=>{
  assert.match(html,/SIGN_IN_SUCCESS/);
  assert.match(html,/TECH_SESSION_READY/);
  for(const stage of ['[NITROS AUTH] sign-in started','[NITROS AUTH] credentials validated','[NITROS AUTH] session saved','[NITROS AUTH] portal navigation started','[NITROS AUTH] portal mounted'])assert.ok(html.includes(stage));
  assert.match(html,/function portalRoute\(id\)\{const core=window\.NitrosRepairOrderCore/);
  assert.match(html,/Browser environment check timed out — sign-in remains available/);
  assert.match(html,/nitros_portal_v8_profile/);
});
