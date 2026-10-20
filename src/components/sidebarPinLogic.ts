import type { SidebarPageKey } from './sidebarPages';

export const MAX_FAVORITE_PAGES = 8;

export function toggleSidebarFavorite(
  current: readonly SidebarPageKey[],
  key: SidebarPageKey,
): { pageKeys: SidebarPageKey[]; limitReached: boolean } {
  if (current.includes(key)) {
    return { pageKeys: current.filter((favoriteKey) => favoriteKey !== key), limitReached: false };
  }
  if (current.length >= MAX_FAVORITE_PAGES) {
    return { pageKeys: [...current], limitReached: true };
  }
  return { pageKeys: [...current, key], limitReached: false };
}
