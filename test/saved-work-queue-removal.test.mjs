import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('normal saved-work removal archives only the selected active RO',()=>{
  assert.match(html,/async function archiveSavedWork\(id\)/);
  assert.match(html,/status:'archived',archivedAt:iso\(\),saveReason:'removed from saved work'/);
  assert.match(html,/async function removeFromSavedWork\(id\)/);
  assert.doesNotMatch(html,/removeFromSavedWork[\s\S]{0,600}await remove\(id\)/);
});

test('saved-work action has customer and vehicle identification with non-destructive confirmation',()=>{
  assert.match(html,/Remove from Saved Work\?/);
  assert.match(html,/Customer and repair history will be retained/);
  assert.match(html,/data-remove-choice="cancel">Cancel/);
  assert.match(html,/data-remove-choice="remove">Remove from Saved Work/);
  assert.match(html,/savedWorkLabel\(record\)/);
  assert.match(html,/active-ro-menu/);
});

test('archived saved work is retained in customer history and excluded from the active queue',()=>{
  assert.match(html,/retainedSavedWork:true,activeRepairRecordId:record\.id/);
  assert.match(html,/return rows\.filter\(row=>row\.status==='active'\)/);
  assert.match(html,/photoStorageReference:record\.photoStorageReference/);
});

test('permanent draft deletion remains a separate, explicitly worded action',()=>{
  assert.match(html,/Permanently Delete Test Draft|Permanently Discard Draft/);
  assert.match(html,/async function abandon\(reason\)/);
});
