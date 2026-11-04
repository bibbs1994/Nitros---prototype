const KNOWN_DEFERRALS = new Map([
  ['Another tab holds the backup lock', 'Another tab is using the backup lock. Close or finish backup work in the other Nitros tab, then retry.'],
]);

export function manualBackupNotice(result) {
  if (result?.deferred === true) {
    return KNOWN_DEFERRALS.get(result.reason) || 'Backup was deferred because another operation is using the backup lock. Retry when it finishes.';
  }
  if (!result || result.status !== 'SUCCESS' || !result.encrypted) {
    return 'Backup was not confirmed as saved. Check backup history before retrying.';
  }
  return null;
}
