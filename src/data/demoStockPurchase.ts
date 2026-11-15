export interface DemoStockMedicine {
  code: string;
  brand_name: string;
  units: Array<{
    name: string;
    is_default_sale_unit: boolean;
  }>;
  batch: {
    batch_number: string;
    expiry_date: string;
    quantity: number;
    cost_paisa: number;
    mrp_paisa: number;
  };
}

interface DemoStockUnit {
  id: string;
  medicine_id: string;
  name: string;
  is_default_sale_unit: boolean;
}

export function buildDemoStockPurchaseItems(
  medicines: readonly DemoStockMedicine[],
  medicineIds: ReadonlyMap<string, string>,
  units: readonly DemoStockUnit[],
  stockByMedicine: ReadonlyMap<string, number>,
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const medicine of medicines) {
    const medicineId = medicineIds.get(medicine.code);
    if (!medicineId) throw new Error(`The ID for ${medicine.brand_name} is missing.`);
    if ((stockByMedicine.get(medicineId) ?? 0) > 0) continue;

    const defaultDefinition = medicine.units.find((unit) => unit.is_default_sale_unit);
    const defaultUnit = units.find((unit) =>
      unit.medicine_id === medicineId
      && unit.is_default_sale_unit
      && unit.name === defaultDefinition?.name
    );
    if (!defaultUnit) throw new Error(`A default sale unit is missing for ${medicine.brand_name}.`);
    const today = new Date();
    const todayString = today.toISOString().slice(0, 10);
    let expiryDate = medicine.batch.expiry_date;
    if (expiryDate <= todayString) {
      today.setUTCFullYear(today.getUTCFullYear() + 1);
      expiryDate = today.toISOString().slice(0, 10);
    }
    items.push({
      medicine_id: medicineId,
      unit_id: defaultUnit.id,
      batch_number: `${medicine.batch.batch_number}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      expiry_date: expiryDate,
      quantity: medicine.batch.quantity,
      bonus_qty: 0,
      unit_cost_paisa: medicine.batch.cost_paisa,
      mrp_paisa: medicine.batch.mrp_paisa,
    });
  }
  return items;
}
