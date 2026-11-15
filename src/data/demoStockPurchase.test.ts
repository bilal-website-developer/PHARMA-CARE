import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDemoStockPurchaseItems, DemoStockMedicine } from './demoStockPurchase';

const medicines: DemoStockMedicine[] = [
  {
    code: 'DEMO-MED-001',
    brand_name: 'Medicine One',
    units: [{ name: 'Strip', is_default_sale_unit: true }],
    batch: {
      batch_number: 'MED-001',
      expiry_date: '2027-12-31',
      quantity: 12,
      cost_paisa: 2500,
      mrp_paisa: 3000,
    },
  },
  {
    code: 'DEMO-MED-002',
    brand_name: 'Medicine Two',
    units: [{ name: 'Bottle', is_default_sale_unit: true }],
    batch: {
      batch_number: 'MED-002',
      expiry_date: '2027-12-31',
      quantity: 10,
      cost_paisa: 1800,
      mrp_paisa: 2400,
    },
  },
];

test('builds stock purchase lines only for demo medicines with no current stock', () => {
  const medicineIds = new Map(medicines.map((medicine, index) => [medicine.code, `medicine-${index}`]));
  const units = medicines.map((medicine, index) => ({
    id: `unit-${index}`,
    medicine_id: `medicine-${index}`,
    name: medicine.units[0].name,
    is_default_sale_unit: true,
  }));
  const stockByMedicine = new Map([['medicine-1', 10]]);

  const items = buildDemoStockPurchaseItems(medicines, medicineIds, units, stockByMedicine);

  assert.equal(items.length, 1);
  assert.equal(items[0].medicine_id, 'medicine-0');
  assert.equal(items[0].unit_id, 'unit-0');
  assert.equal(items[0].quantity, medicines[0].batch.quantity);
  assert.equal(items[0].unit_cost_paisa, medicines[0].batch.cost_paisa);
  assert.match(String(items[0].batch_number), /^MED-001-[0-9A-F]{8}$/);
});

test('refuses to seed demo stock when a medicine or its default sale unit is missing', () => {
  const medicineIds = new Map(medicines.map((medicine, index) => [medicine.code, `medicine-${index}`]));
  assert.throws(
    () => buildDemoStockPurchaseItems(medicines, new Map(), [], new Map()),
    /ID for Medicine One is missing/,
  );
  assert.throws(
    () => buildDemoStockPurchaseItems(medicines, medicineIds, [], new Map()),
    /default sale unit is missing for Medicine One/,
  );
});
