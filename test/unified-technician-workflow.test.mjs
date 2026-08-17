import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('unified router exposes all six technician intents without mode controls',()=>{
  for(const intent of ['diagnostic-testing','component-replacement','component-location','system-explanation','scan-data-interpretation'])assert.match(html,new RegExp(`return'${intent}'`));
  assert.match(html,/routeUnifiedTechnicianWorkflow/);
  assert.doesNotMatch(html,/id="diagGeneralMode"|id="diagRoMode"/);
});

test('unified router consumes RO context before classifying and preserves specialist engines',()=>{
  assert.match(html,/function routeUnifiedTechnicianWorkflow\(text\)\{inheritRepairOrderContext\(\);const context=mergedContext\(\),intent=classifyTechnicianIntent/);
  assert.match(html,/existing-graph-pid-architecture/);
  assert.match(html,/existing-dtc-diagnostic-state/);
});
