import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const script = dashboard.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';

test('support dashboard has a dedicated server route and complete local-triage controls', () => {
  assert.match(server, /url\.pathname === '\/dashboard'/);
  assert.match(server, /readFile\(resolve\(root, 'dashboard\.html'\)\)/);
  for (const text of ['Nitros Support Dashboard', 'Version 10.13.87', 'Current server status', 'Total tickets', 'In Progress', 'Fixed / Closed', 'Create TEST TICKET', 'Internal developer notes']) assert.match(dashboard, new RegExp(text));
  for (const route of ['/api/support-tickets', 'method:\'PATCH\'', 'data-view', 'data-advance']) assert.ok(dashboard.includes(route), route);
  assert.doesNotThrow(() => new Function(script), 'dashboard client script must parse');
});

test('support dashboard advances ticket status only through an intentional persisted action', () => {
  assert.match(script,/function nextStatus\(value\)\{return value==='Open'\?'In Progress':value==='In Progress'\?'Fixed':null\}/);
  assert.match(script,/function advanceStatus\(id,button\)/);
  assert.match(script,/method:'PATCH',headers:\{'Content-Type':'application\/json'\},body:JSON\.stringify\(\{status:next\}\)/);
  assert.match(script,/await load\(\)/);
  assert.match(script,/console\.error\('Ticket status update failed; dashboard state was not changed\.'/);
  assert.match(dashboard,/\.badge\.open\{background:#663f10/);
  assert.match(dashboard,/\.badge\.in-progress\{background:#173f68/);
  assert.match(dashboard,/\.badge\.fixed,\.badge\.closed\{background:#1b5447/);
  assert.match(dashboard,/\.status-action\{[^}]*touch-action:manipulation/);
});
