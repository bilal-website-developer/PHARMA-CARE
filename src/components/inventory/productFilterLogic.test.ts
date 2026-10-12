import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearProductFilters,
  getActiveProductFilters,
  removeProductFilter,
  type ProductFilterState,
} from './productFilterLogic';

const activeFilters: ProductFilterState = {
  search: '  amoxicillin ',
  category: 'Antibiotics',
  manufacturer: 'Acme',
  drugClass: 'RX',
  status: 'inactive',
  lowStockOnly: true,
};

test('active filter chips and count use only non-default filters', () => {
  const chips = getActiveProductFilters(activeFilters);
  assert.deepEqual(chips.map(({ key, label }) => [key, label]), [
    ['search', 'Search: amoxicillin'],
    ['category', 'Category: Antibiotics'],
    ['manufacturer', 'Manufacturer: Acme'],
    ['class', 'Class: Rx'],
    ['status', 'Status: Inactive'],
    ['lowStockOnly', 'Low stock only'],
  ]);
  assert.equal(chips.length, 6);
  assert.deepEqual(getActiveProductFilters({
    search: '',
    category: '',
    manufacturer: '',
    drugClass: '',
    status: 'active',
    lowStockOnly: false,
  }), []);
});

test('removing one chip clears only its corresponding filter', () => {
  assert.deepEqual(removeProductFilter(activeFilters, 'category'), {
    ...activeFilters,
    category: '',
  });
  assert.deepEqual(removeProductFilter(activeFilters, 'status'), {
    ...activeFilters,
    status: 'active',
  });
});

test('clear all resets every filter to the default product view', () => {
  assert.deepEqual(clearProductFilters(), {
    search: '',
    category: '',
    manufacturer: '',
    drugClass: '',
    status: 'active',
    lowStockOnly: false,
  });
});
