import assert from 'node:assert/strict';
import test from 'node:test';
import { findSimilarNames, normalizeMasterName } from './masterDataSimilarity.ts';

test('normalizes case, whitespace, punctuation, accents, and a simple plural s', () => {
  assert.equal(normalizeMasterName('  Tablets & CÁPSULES! '), 'tabletscapsule');
  assert.equal(normalizeMasterName('Capsules'), 'capsule');
  assert.equal(normalizeMasterName('Medi-cines'), normalizeMasterName('medicine'));
});

test('finds normalized matches and names within two edits', () => {
  const records = [
    { id: '1', name: 'Pain Relief' },
    { id: '2', name: 'Pain-Reliefs' },
    { id: '3', name: 'Pain Relif' },
    { id: '4', name: 'ColdCare' },
  ];
  const pairs = findSimilarNames(records);
  assert.deepEqual(pairs.map(({ first, second }) => [first.id, second.id]), [['1', '2'], ['1', '3'], ['2', '3']]);
});

test('does not compare a record with itself or suggest distant names', () => {
  assert.deepEqual(findSimilarNames([
    { id: '1', name: 'Alpha' },
    { id: '2', name: 'Omega' },
  ]), []);
});
