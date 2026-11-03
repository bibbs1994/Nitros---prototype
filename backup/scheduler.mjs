import { defaults, validateSettings, latestDue } from './schedule-core.mjs';
const KEY = 'nitros_backup_schedule_v1';
export function readSettings() {
  const raw = window.NitrosBackupStorage.nativeStorage.getItem(KEY);
  if (!raw) return defaults();
  const value = JSON.parse(raw); return { ...validateSettings(value), enabledAt: value.enabledAt };
}
export function saveSettings(input, now = new Date()) {
  const value = { ...validateSettings(input), enabledAt: now.toISOString() };
  window.NitrosBackupStorage.nativeStorage.setItem(KEY, JSON.stringify(value)); return value;
}
export function createScheduler({ now = () => new Date(), idleMilliseconds = 60000, isBusy = portalBusy, save, history, settings = readSettings } = {}) {
  if (typeof save !== 'function' || typeof history !== 'function') throw new Error('Encrypted scheduler save/history handlers are required');
  let lastActivity = now().getTime(), controller = null, running = false, retryAfter = 0;
  const state = { status: 'IDLE', message: 'Local backups only; closed apps cannot run this schedule.' };
  function activity() { lastActivity = now().getTime(); controller?.abort(); }
  async function tick() {
    if (running) return state;
    if (now().getTime() < retryAfter) return state;
    let due;
    try { due = latestDue(settings(), now()); } catch (error) { state.status = 'ERROR'; state.message = error.message; return state; }
    if (!due) { state.status = 'IDLE'; return state; }
    if (document.visibilityState !== 'visible' || isBusy() || now().getTime() - lastActivity < idleMilliseconds) { state.status = 'DEFERRED'; state.message = 'Due backup waits until the app is open and idle, with no inspection, repair or road test active.'; return state; }
    running = true; controller = new AbortController();
    try {
      if ((await history()).some(x => x.status === 'SUCCESS' && x.id === `scheduled:${due.id}`)) { state.status = 'CURRENT'; state.message = 'This scheduled backup is saved on this device.'; return state; }
      if (controller.signal.aborted || isBusy()) { state.status = 'DEFERRED'; return state; }
      state.status = 'RUNNING';
      const result = await save({ due, signal: controller.signal });
      state.status = result.deferred ? 'DEFERRED' : 'SUCCESS'; state.message = result.deferred ? result.reason : 'Verified local backup saved. Download a separate copy to protect against phone loss.';
    } catch (error) { retryAfter = now().getTime() + 300000; state.status = 'ERROR'; state.message = `Local backup failed: ${error.message}. Previous backups remain intact. Retrying after five minutes while idle.`; }
    finally { running = false; controller = null; window.dispatchEvent(new Event('nitros-backup-status')); }
    return state;
  }
  return { tick, activity, state, stop: () => controller?.abort() };
}
export function portalBusy() {
  if (window.NitrosPortalActivity?.isBusy?.()) return true;
  const core = window.NitrosRepairOrderCore;
  if (!core) return false;
  const screen = core.getScreen?.() || document.querySelector('.screen.active')?.id;
  return !['home', 'login', 'dashboard'].includes(screen) || core.getJobClock?.()?.state === 'running' || !!document.querySelector('#smartEvidenceModal:not(.hidden)');
}
export function startScheduler() {
  const scheduler = createScheduler();
  for (const name of ['pointerdown', 'keydown', 'input', 'touchstart', 'nitros-ro-stage-change', 'visibilitychange']) window.addEventListener(name, scheduler.activity, { passive: true });
  const interval = setInterval(() => scheduler.tick(), 15000);
  window.addEventListener('pagehide', () => { clearInterval(interval); scheduler.stop(); }, { once: true });
  scheduler.tick(); window.NitrosBackupScheduler = scheduler; return scheduler;
}
