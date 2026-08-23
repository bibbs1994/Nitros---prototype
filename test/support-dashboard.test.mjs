import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const script = dashboard.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';

test('support dashboard has a dedicated server route and complete local-triage controls', () => {
  assert.match(server, /url\.pathname === '\/dashboard'/);
  assert.match(server, /readFile\(resolve\(root, 'dashboard\.html'\)\)/);
  for (const text of ['Nitros Support Dashboard', 'Current server status', 'Total tickets', 'In Progress', 'Fixed / Closed', 'Create TEST TICKET', 'Internal developer notes']) assert.match(dashboard, new RegExp(text));
  for (const route of ['/api/support-tickets', 'method:\'PATCH\'', 'data-view']) assert.ok(dashboard.includes(route), route);
  assert.doesNotThrow(() => new Function(script), 'dashboard client script must parse');
});
