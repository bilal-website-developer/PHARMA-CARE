import { Batch, BatchAllocation, BatchStatus } from '../types/pharmacy';

export function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function allocateFefo(
  batches: Batch[],
  requiredSmallestUnits: number,
  today = localIsoDate()
): BatchAllocation[] {
  if (!Number.isSafeInteger(requiredSmallestUnits) || requiredSmallestUnits <= 0) {
    throw new RangeError('Sale quantity must be a positive whole number of smallest units.');
  }

  const eligible = batches
    .filter(
      (batch) =>
        Number.isSafeInteger(batch.quantitySmallestUnit) &&
        batch.quantitySmallestUnit > 0 &&
        (batch.status === BatchStatus.ACTIVE || batch.status === BatchStatus.NEAR_EXPIRY) &&
        batch.expiryDate > today
    )
    .sort(
      (a, b) =>
        a.expiryDate.localeCompare(b.expiryDate) ||
        a.receivedDate.localeCompare(b.receivedDate) ||
        a.id.localeCompare(b.id)
    );

  let remaining = requiredSmallestUnits;
  const allocations: BatchAllocation[] = [];

  for (const batch of eligible) {
    const quantitySmallestUnit = Math.min(remaining, batch.quantitySmallestUnit);
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantitySmallestUnit,
    });
    remaining -= quantitySmallestUnit;
    if (remaining === 0) return allocations;
  }

  throw new RangeError(
    `Insufficient eligible stock. ${requiredSmallestUnits - remaining} of ${requiredSmallestUnits} smallest units are available.`
  );
}

export function restoreBatchAllocations(
  batches: Batch[],
  allocations: BatchAllocation[]
): Batch[] {
  const quantitiesByBatch = new Map<string, number>();
  for (const allocation of allocations) {
    if (!Number.isSafeInteger(allocation.quantitySmallestUnit) || allocation.quantitySmallestUnit <= 0) {
      throw new RangeError('Return quantity must be a positive whole number of smallest units.');
    }
    quantitiesByBatch.set(
      allocation.batchId,
      (quantitiesByBatch.get(allocation.batchId) ?? 0) + allocation.quantitySmallestUnit
    );
  }

  for (const batchId of quantitiesByBatch.keys()) {
    if (!batches.some((batch) => batch.id === batchId)) {
      throw new RangeError(`Original batch ${batchId} was not found.`);
    }
  }

  return batches.map((batch) => ({
    ...batch,
    quantitySmallestUnit:
      batch.quantitySmallestUnit + (quantitiesByBatch.get(batch.id) ?? 0),
  }));
}
