export const SHOP_ACCOUNT_KEY = '__nitros_backup_shop_account_v1';
const accountIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export function validateDriveAccountId(value) {
  if (typeof value !== 'string' || !accountIdPattern.test(value)) throw new Error('Google Drive account identity is invalid');
  return value;
}

export function readShopAccountId(storage) {
  const value = storage?.getItem(SHOP_ACCOUNT_KEY) || '';
  return value ? validateDriveAccountId(value) : null;
}

// The caller must obtain an affirmative owner action before creating or changing this binding.
export function bindShopAccount(storage, accountId, { authorized = false } = {}) {
  const next = validateDriveAccountId(accountId);
  if (!authorized) throw new Error('Explicit shop-owner authorization is required to bind this Google account');
  const previous = readShopAccountId(storage);
  storage.setItem(SHOP_ACCOUNT_KEY, next);
  return Object.freeze({ previous, accountId: next, changed: previous !== next });
}

export function assertPackageShopAccount(envelope, expectedAccountId) {
  const expected = validateDriveAccountId(expectedAccountId);
  const actual = envelope?.payload?.source?.shopAccountPermissionId;
  if (typeof actual !== 'string' || !accountIdPattern.test(actual)) {
    throw new Error('Backup has no verified shop Drive-account identity; owner-approved legacy recovery is required');
  }
  if (actual !== expected) throw new Error('Backup belongs to a different shop Drive account; cross-shop restore is blocked');
  return true;
}
