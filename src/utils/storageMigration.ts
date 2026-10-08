const LEGACY_STORAGE_PREFIX = 'pharmacare.';
const CURRENT_STORAGE_PREFIX = 'pharma-care.';

export function migrateLegacyStorageKeys(): void {
  try {
    const storage = globalThis.localStorage;
    const legacyKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key?.startsWith(LEGACY_STORAGE_PREFIX) ?? false);

    for (const legacyKey of legacyKeys) {
      const currentKey = `${CURRENT_STORAGE_PREFIX}${legacyKey.slice(LEGACY_STORAGE_PREFIX.length)}`;
      if (storage.getItem(currentKey) === null) {
        const value = storage.getItem(legacyKey);
        if (value !== null) storage.setItem(currentKey, value);
      }
      storage.removeItem(legacyKey);
    }
  } catch {
    // Existing legacy values remain available if browser storage is temporarily unavailable.
  }
}
