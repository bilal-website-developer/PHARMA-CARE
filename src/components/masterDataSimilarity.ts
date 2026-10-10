export interface NamedRecord {
  id: string;
  name: string;
}

export interface SimilarNamePair<T extends NamedRecord> {
  first: T;
  second: T;
  distance: number;
}

export function normalizeMasterName(value: string) {
  const compact = value.trim().toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]/gu, '');
  return compact.endsWith('s') && compact.length > 1 ? compact.slice(0, -1) : compact;
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function findSimilarNames<T extends NamedRecord>(records: readonly T[]): SimilarNamePair<T>[] {
  const pairs: SimilarNamePair<T>[] = [];
  for (let firstIndex = 0; firstIndex < records.length; firstIndex += 1) {
    const first = records[firstIndex];
    const normalizedFirst = normalizeMasterName(first.name);
    if (!normalizedFirst) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < records.length; secondIndex += 1) {
      const second = records[secondIndex];
      const normalizedSecond = normalizeMasterName(second.name);
      if (!normalizedSecond) continue;
      const distance = normalizedFirst === normalizedSecond
        ? 0
        : editDistance(normalizedFirst, normalizedSecond);
      if (distance <= 2) pairs.push({ first, second, distance });
    }
  }
  return pairs;
}
