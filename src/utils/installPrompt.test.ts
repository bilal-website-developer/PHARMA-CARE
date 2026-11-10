import assert from 'node:assert/strict';
import test from 'node:test';
import { isInstallPromptDismissed, rememberInstallPromptDismissed } from './installPrompt';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test('remembers install prompt dismissal across reads', () => {
  const storage = createStorage();
  assert.equal(isInstallPromptDismissed(storage), false);
  assert.equal(rememberInstallPromptDismissed(storage), true);
  assert.equal(isInstallPromptDismissed(storage), true);
});

test('reports unavailable storage when saving install prompt dismissal', () => {
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('Storage unavailable'); },
  };
  assert.equal(rememberInstallPromptDismissed(storage), false);
  assert.equal(isInstallPromptDismissed(storage), false);
});
