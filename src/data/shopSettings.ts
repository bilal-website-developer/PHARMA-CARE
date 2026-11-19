import { supabase } from '../utils/supabase';
import { parseShopOperationalSettings, ShopOperationalSettings, toShopSettingsRpcPayload } from '../utils/shopSettings';

export type { ShopOperationalSettings } from '../utils/shopSettings';

export async function loadCurrentShopSettings(): Promise<ShopOperationalSettings> {
  if (!supabase) throw new Error('Supabase is not configured; shop settings could not be loaded.');
  const { data, error } = await supabase.rpc('current_shop_settings');
  if (error) throw new Error(`Could not load shop settings: ${error.message}`);
  return parseShopOperationalSettings(data);
}

export async function updateCurrentShopSettings(
  settings: ShopOperationalSettings,
): Promise<ShopOperationalSettings> {
  if (!supabase) throw new Error('Supabase is not configured; shop settings could not be saved.');
  const { data, error } = await supabase.rpc('update_current_shop_settings_v2', {
    p_settings: toShopSettingsRpcPayload(settings),
  });
  if (error) throw new Error(`Could not save shop settings: ${error.message}`);
  return parseShopOperationalSettings(data);
}
