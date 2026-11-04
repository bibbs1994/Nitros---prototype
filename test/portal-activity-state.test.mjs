import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectPortalActivity } from '../backup/portal-activity-state.mjs';

const now = 20_000;
const portal = (busy, { presenceAt = now, stateAt = now } = {}) => ({ presenceAt, state: { busy, at: stateAt } });

test('idle portal tabs do not block a backup', () => {
  assert.deepEqual(inspectPortalActivity({ channelsAvailable: true, timerState: false, now, portals: [portal(false)] }), { busy: false, reason: 'idle' });
});

test('an active technician workflow in any live tab blocks the backup', () => {
  assert.deepEqual(inspectPortalActivity({ channelsAvailable: true, timerState: false, now, portals: [portal(false), portal(true)] }), { busy: true, reason: 'technician workflow active in another tab' });
});

test('a live portal tab with stale or missing workflow state fails closed', () => {
  assert.equal(inspectPortalActivity({ channelsAvailable: true, timerState: false, now, portals: [portal(false, { stateAt: now - 7000 })] }).reason, 'portal tab present; workflow state is stale');
  assert.equal(inspectPortalActivity({ channelsAvailable: true, timerState: false, now, portals: [{ presenceAt: now, state: null }] }).reason, 'portal tab present; workflow state not received');
});

test('a portal tab whose presence is stale is ignored after its heartbeat expires', () => {
  assert.deepEqual(inspectPortalActivity({ channelsAvailable: true, timerState: false, now, portals: [portal(true, { presenceAt: now - 7000, stateAt: now - 7000 })] }), { busy: false, reason: 'idle' });
});

test('a persisted running repair timer blocks even with no open portal tab', () => {
  assert.equal(inspectPortalActivity({ channelsAvailable: true, timerState: true, now }).reason, 'active persisted repair-order timer');
});

test('unknown timer state or unavailable cross-tab channels fail closed', () => {
  assert.equal(inspectPortalActivity({ channelsAvailable: true, timerState: null, now }).reason, 'repair-order timer state not verified');
  assert.equal(inspectPortalActivity({ channelsAvailable: false, timerState: false, now }).reason, 'cross-tab activity monitoring unavailable');
});

test('probe replies refresh cross-tab activity state independently of the interval heartbeat', async () => {
  const source = await readFile(new URL('../backup/portal-activity.mjs', import.meta.url), 'utf8');
  assert.match(source, /response\.busy = portalBusyNow\(\); response\.at = clock\(\)/);
  assert.match(source, /typeof event\.data\.busy === 'boolean'\) portalStates\.set\(event\.data\.pageId, \{ busy: event\.data\.busy, at \}\)/);
});
