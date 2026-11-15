export interface DemoMasterDataRow {
  id: string;
  name: string;
  is_active: boolean;
}

export interface DemoMasterDataPlan {
  createNames: string[];
  activateRows: DemoMasterDataRow[];
}

export interface DemoDataStatus {
  loaded: boolean;
  count: number;
  supplierActive: boolean;
}

export function summarizeDemoDataStatus(
  activeMedicineCount: number,
  supplierActive: boolean,
): DemoDataStatus {
  return {
    loaded: activeMedicineCount > 0 || supplierActive,
    count: activeMedicineCount,
    supplierActive,
  };
}

export function planDemoMasterDataChanges(
  requiredNames: readonly string[],
  existingRows: readonly DemoMasterDataRow[],
): DemoMasterDataPlan {
  const existingByName = new Map(
    existingRows.map((row) => [row.name.trim().toLowerCase(), row]),
  );
  const seen = new Set<string>();
  const createNames: string[] = [];
  const activateRows: DemoMasterDataRow[] = [];

  for (const rawName of requiredNames) {
    const name = rawName.trim();
    if (!name) throw new Error('Demo category and manufacturer names cannot be empty.');
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const existing = existingByName.get(key);
    if (!existing) createNames.push(name);
    else if (!existing.is_active) activateRows.push(existing);
  }

  return { createNames, activateRows };
}
