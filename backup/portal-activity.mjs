import { inspectPortalActivity } from './portal-activity-state.mjs';
const isBackupPage = location.pathname.startsWith('/backup/');
const backupPresence = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nitros-backup-presence') : null;
const activity = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nitros-portal-activity') : null;
const clock = () => Date.now();
let timerState = null;
const portalPages = new Map();
const portalStates = new Map();

function portalBusyNow() {
  const core = window.NitrosRepairOrderCore;
  const screen = core?.getScreen?.() || document.querySelector('.screen.active')?.id || 'unknown';
  return !['home', 'login', 'dashboard'].includes(screen) || core?.getJobClock?.()?.state === 'running' || !!document.querySelector('#smartEvidenceModal:not(.hidden)');
}

function publishPortalState() {
  activity.postMessage({ type: 'state', pageId: window.NitrosBackupStorage?.pageId, busy: portalBusyNow(), at: clock() });
}

if (backupPresence) backupPresence.onmessage = event => {
  if (event.data?.type === 'probe' && event.data.id) {
    const response = { type: 'present', probe: event.data.id, pageId: window.NitrosBackupStorage?.pageId, role: isBackupPage ? 'backup' : 'portal' };
    if (!isBackupPage) { response.busy = portalBusyNow(); response.at = clock(); }
    backupPresence.postMessage(response);
    return;
  }
  if (!isBackupPage || event.data?.type !== 'present' || event.data.role !== 'portal') return;
  const at = Number(event.data.at) || clock();
  portalPages.set(event.data.pageId, at);
  if (typeof event.data.busy === 'boolean') portalStates.set(event.data.pageId, { busy: event.data.busy, at });
};

if (activity) activity.onmessage = event => {
  if (!isBackupPage || event.data?.type !== 'state' || !event.data.pageId || typeof event.data.busy !== 'boolean') return;
  portalStates.set(event.data.pageId, { busy: event.data.busy, at: Number(event.data.at) || clock() });
};

async function inspectPersistedTimer() {
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('NitrosRepairOrders', 1);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Repair-order database is not present')); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Repair-order database is blocked'));
    });
    try {
      if (db.version !== 1 || !db.objectStoreNames.contains('repairOrders')) throw new Error('Unknown repair-order schema');
      const rows = await new Promise((resolve, reject) => {
        const request = db.transaction('repairOrders', 'readonly').objectStore('repairOrders').getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      timerState = rows.some(row => row.status === 'active' && row.laborTimer?.status === 'running');
    } finally { db.close(); }
  } catch (error) {
    timerState = /not present/.test(String(error?.message)) ? false : null;
  }
}

if (isBackupPage) {
  const probe = () => backupPresence?.postMessage({ type: 'probe', id: crypto.randomUUID() });
  probe(); if (backupPresence) setInterval(probe, 2500);
  void inspectPersistedTimer(); setInterval(() => { void inspectPersistedTimer(); }, 5000);
} else {
  if (activity) {
    for (const event of ['nitros-ro-stage-change', 'visibilitychange', 'pointerdown', 'keydown', 'input', 'touchstart']) window.addEventListener(event, publishPortalState, { passive: true });
    publishPortalState(); setInterval(publishPortalState, 2500);
  }
}

export function portalWorkflowStatus() {
  if (!isBackupPage) { const busy = portalBusyNow(); return { busy, reason: busy ? 'technician workflow active in this tab' : 'idle' }; }
  const now = clock();
  for (const [pageId, seenAt] of portalPages) {
    if (now - seenAt > 6000) { portalPages.delete(pageId); portalStates.delete(pageId); }
  }
  return inspectPortalActivity({
    channelsAvailable: !!backupPresence && !!activity,
    timerState,
    now,
    portals: [...portalPages].map(([pageId, presenceAt]) => ({ presenceAt, state: portalStates.get(pageId) })),
  });
}

export function portalWorkflowBusy() { return portalWorkflowStatus().busy; }
