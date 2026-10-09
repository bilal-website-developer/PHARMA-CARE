import assert from 'node:assert/strict';
import test from 'node:test';
import { getSupabaseErrorMessage } from './supabaseError';

test('explains missing table errors and preserves the database detail', () => {
  assert.equal(
    getSupabaseErrorMessage(
      { code: 'PGRST205', message: "Could not find the table 'public.categories' in the schema cache" },
      'fallback',
    ),
    "A required database table is missing or unavailable in the API schema. Apply the pending database migrations and refresh the Supabase API schema. Details: Could not find the table 'public.categories' in the schema cache",
  );
});

test('identifies unavailable RPCs and outdated columns', () => {
  assert.match(getSupabaseErrorMessage({ code: 'PGRST202', message: 'Missing RPC' }, 'fallback'), /database function is missing/);
  assert.match(getSupabaseErrorMessage({ code: '42703', message: 'Missing column' }, 'fallback'), /missing a column/);
});

test('identifies permission errors and preserves plain-object messages', () => {
  assert.match(getSupabaseErrorMessage({ code: '42501', message: 'Not allowed' }, 'fallback'), /denied this request/);
  assert.equal(getSupabaseErrorMessage({ message: 'Backend request failed' }, 'fallback'), 'Backend request failed');
});

test('uses the fallback only when the error has no readable message', () => {
  assert.equal(getSupabaseErrorMessage({}, 'Request failed'), 'Request failed');
  assert.equal(getSupabaseErrorMessage(new Error('Network unavailable'), 'Request failed'), 'Network unavailable');
});
