export const PORTAL_ACTIVITY_STALE_MS = 6000;

export function inspectPortalActivity({ channelsAvailable, timerState, portals = [], now = Date.now(), staleAfter = PORTAL_ACTIVITY_STALE_MS } = {}) {
  if (!channelsAvailable) return { busy: true, reason: 'cross-tab activity monitoring unavailable' };
  if (timerState === null || timerState === undefined) return { busy: true, reason: 'repair-order timer state not verified' };
  if (timerState === true) return { busy: true, reason: 'active persisted repair-order timer' };

  for (const portal of portals) {
    if (!Number.isFinite(portal.presenceAt) || now - portal.presenceAt > staleAfter || portal.presenceAt > now + 1000) continue;
    if (!portal.state) return { busy: true, reason: 'portal tab present; workflow state not received' };
    if (!Number.isFinite(portal.state.at) || now - portal.state.at > staleAfter || portal.state.at > now + 1000) {
      return { busy: true, reason: 'portal tab present; workflow state is stale' };
    }
    if (portal.state.busy) return { busy: true, reason: 'technician workflow active in another tab' };
  }
  return { busy: false, reason: 'idle' };
}
