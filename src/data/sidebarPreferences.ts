import { canAccessPage } from '../permissions';
import { UserRole } from '../types/pharmacy';
import { isSidebarPageKey, SIDEBAR_PAGES, type SidebarPageKey } from '../components/sidebarPages';
import { supabase } from '../utils/supabase';

export interface SidebarPreferences {
  favoritePageKeys: SidebarPageKey[];
  tipDismissed: boolean;
  loadFailed: boolean;
}

export function visibleSidebarPageKeys(role: UserRole, permissions: readonly string[]): SidebarPageKey[] {
  return SIDEBAR_PAGES
    .filter((page) => page.sidebar !== false && canAccessPage(role, permissions, page.key))
    .map((page) => page.key);
}

export async function loadSidebarPreferences(
  visiblePageKeys: readonly SidebarPageKey[],
): Promise<SidebarPreferences> {
  const empty: SidebarPreferences = { favoritePageKeys: [], tipDismissed: false, loadFailed: false };
  if (!supabase) {
    return { ...empty, loadFailed: true };
  }

  let loadFailed = false;
  let favoritePageKeys: SidebarPageKey[] = [];
  let tipDismissed = false;

  try {
    const { data: favorites, error: favoritesError } = await supabase
      .from('user_favorites')
      .select('page_key,position,created_at')
      .order('position', { ascending: true })
      .order('created_at', { ascending: false });

    if (favoritesError) {
      console.warn('Could not load sidebar favorites:', favoritesError.message);
      loadFailed = true;
    } else if (Array.isArray(favorites)) {
      const visible = new Set(visiblePageKeys);
      const uniqueKeys = new Set<SidebarPageKey>();
      favoritePageKeys = favorites
        .filter((row): row is { page_key: string; position: number; created_at: string } =>
          typeof row.page_key === 'string'
          && Number.isSafeInteger(row.position)
          && typeof row.created_at === 'string'
        )
        .sort((a, b) => a.position - b.position || b.created_at.localeCompare(a.created_at))
        .flatMap((row) => {
          if (!isSidebarPageKey(row.page_key) || !visible.has(row.page_key) || uniqueKeys.has(row.page_key)) return [];
          uniqueKeys.add(row.page_key);
          return [row.page_key];
        })
        .slice(0, 8);
      if (favoritePageKeys.length !== favorites.length) {
        try {
          await saveSidebarPreferences(favoritePageKeys, false);
        } catch (error) {
          console.warn('Could not remove unavailable sidebar favorites:', error);
          loadFailed = true;
        }
      }
    } else {
      console.warn('The server returned an invalid sidebar favorites response.');
      loadFailed = true;
    }
  } catch (error) {
    console.warn('Could not load sidebar favorites:', error);
    loadFailed = true;
  }

  try {
    const { data: preference, error: preferenceError } = await supabase
      .from('user_sidebar_preferences')
      .select('tip_dismissed')
      .maybeSingle();

    if (preferenceError) {
      console.warn('Could not load sidebar tip preference:', preferenceError.message);
      loadFailed = true;
    } else if (preference) {
      if (typeof preference.tip_dismissed === 'boolean') {
        tipDismissed = preference.tip_dismissed;
      } else {
        console.warn('The server returned an invalid sidebar tip preference.');
        loadFailed = true;
      }
    }
  } catch (error) {
    console.warn('Could not load sidebar tip preference:', error);
    loadFailed = true;
  }

  return { favoritePageKeys, tipDismissed, loadFailed };
}

export async function saveSidebarPreferences(
  pageKeys: readonly string[],
  tipDismissed: boolean,
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (
    pageKeys.length > 8
    || new Set(pageKeys).size !== pageKeys.length
    || pageKeys.some((key) => !isSidebarPageKey(key))
  ) {
    throw new RangeError('The sidebar pin list is invalid.');
  }

  const { error } = await supabase.rpc('save_sidebar_preferences', {
    p_page_keys: [...pageKeys],
    p_tip_dismissed: tipDismissed,
  });
  if (error) throw new Error(`Could not save sidebar preferences: ${error.message}`);
}
