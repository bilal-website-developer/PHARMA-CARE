import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTrashBinEvents, parseTrashBinEvent, searchTrashBinEvents, TrashBinEvent } from './trashBin';

const events: TrashBinEvent[] = [
  {
    id: '1',
    actor_id: 'admin-id',
    actor_name: 'Admin',
    entity_type: 'medicine',
    entity_id: 'medicine-id',
    entity_role: null,
    action: 'deactivated',
    display_name: 'Panadol',
    reason: null,
    created_at: '2026-10-12T12:00:00Z',
    can_restore: true,
    can_permanently_delete: true,
  },
  {
    id: '2',
    actor_id: null,
    actor_name: 'Unknown user',
    entity_type: 'purchase',
    entity_id: 'purchase-id',
    entity_role: null,
    action: 'voided',
    display_name: 'PR-10001',
    reason: 'Duplicate',
    created_at: '2026-10-12T11:00:00Z',
    can_restore: false,
    can_permanently_delete: false,
  },
];

test('filters Trash Bin events by entity type', () => {
  assert.deepEqual(filterTrashBinEvents(events, 'all'), events);
  assert.deepEqual(filterTrashBinEvents(events, 'medicine'), [events[0]]);
  assert.deepEqual(filterTrashBinEvents(events, 'purchase'), [events[1]]);
});

test('searches Trash Bin activity by item, action, actor, entity, and reason', () => {
  assert.deepEqual(searchTrashBinEvents(events, '  PANADOL '), [events[0]]);
  assert.deepEqual(searchTrashBinEvents(events, 'ADMIN'), [events[0]]);
  assert.deepEqual(searchTrashBinEvents(events, 'Duplicate'), [events[1]]);
  assert.deepEqual(searchTrashBinEvents(events, 'voided'), [events[1]]);
  assert.deepEqual(searchTrashBinEvents(events, 'product'), [events[0]]);
  assert.deepEqual(searchTrashBinEvents(events, '  '), events);
  assert.deepEqual(searchTrashBinEvents(events, 'missing'), []);
});

test('parses events and applies safe display fallbacks', () => {
  assert.equal(parseTrashBinEvent({ ...events[0], actor_name: '  ', display_name: '' }).actor_name, 'Unknown user');
  assert.equal(parseTrashBinEvent({ ...events[0], actor_name: 'Admin', display_name: '' }).display_name, 'Unknown item');
  assert.equal(parseTrashBinEvent(events[0]).can_permanently_delete, true);
  assert.throws(() => parseTrashBinEvent({ ...events[0], action: 'removed' }), /invalid fields/);
  assert.throws(() => parseTrashBinEvent({ ...events[0], can_permanently_delete: undefined }), /invalid fields/);
});
