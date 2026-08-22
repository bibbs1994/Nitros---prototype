import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('floating evidence button is controlled only by active evidence workflow state',()=>{
  assert.match(html,/evidenceWorkflowActive=false/);
  assert.match(html,/function updateButton\(\)\{btn\?\.classList\.toggle\("visible",evidenceWorkflowActive\)\}/);
  assert.doesNotMatch(html,/allowedScreens\.has\(currentScreen\(\)\)/);
});

test('evidence workflow shows on open and hides on close, save, or RO navigation',()=>{
  assert.match(html,/function openModal\(\)\{evidenceWorkflowActive=true;updateButton\(\);modal\.classList\.remove\("hidden"\)/);
  assert.match(html,/function closeModal\(\)\{evidenceWorkflowActive=false;updateButton\(\);modal\.classList\.add\("hidden"\)\}/);
  assert.match(html,/window\.addEventListener\("nitros-ro-stage-change",closeModal\)/);
  assert.match(html,/Evidence saved and added to the repair-order timeline\.";evidenceWorkflowActive=false;updateButton\(\)/);
});

test('permanent bottom Evidence control remains and opens the existing workflow',()=>{
  assert.match(html,/id="quickEvidence"[\s\S]*>📷<br>Evidence<\/button>/);
  assert.match(html,/getElementById\('quickEvidence'\)\?\.addEventListener\('click',\(\)=>window\.dispatchEvent\(new CustomEvent\('nitros-open-evidence-workflow'\)\)\)/);
  assert.match(html,/window\.addEventListener\("nitros-open-evidence-workflow",openModal\)/);
});
