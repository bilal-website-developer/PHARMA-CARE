import { getSupabaseErrorMessage } from '../utils/supabaseError';
import {
  shopLogoFileError,
  shopLogoFileExtension,
  shopLogoObjectPath,
  SHOP_LOGO_BUCKET,
} from '../utils/shopLogo';
import { supabase, supabaseUrl } from '../utils/supabase';
import type { ShopProfile } from '../utils/auth';

export type ShopProfileUpdate = Pick<ShopProfile, 'name' | 'phone' | 'address' | 'logoPath'>;

function parseShopProfile(value: unknown): ShopProfile {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The server returned an invalid shop profile.');
  }
  const profile = value as Record<string, unknown>;
  if (typeof profile.name !== 'string'
    || typeof profile.phone !== 'string'
    || typeof profile.address !== 'string'
    || (profile.logo_path !== null && typeof profile.logo_path !== 'string')) {
    throw new Error('The server returned an incomplete shop profile.');
  }
  return {
    name: profile.name,
    phone: profile.phone,
    address: profile.address,
    logoPath: profile.logo_path ?? '',
  };
}

export async function updateCurrentShopProfile(profile: ShopProfileUpdate): Promise<ShopProfile> {
  if (!supabase) throw new Error('Supabase is not configured; shop profile could not be saved.');
  const { data, error } = await supabase.rpc('update_current_shop_profile', {
    p_name: profile.name,
    p_phone: profile.phone,
    p_address: profile.address,
    p_logo_path: profile.logoPath,
  });
  if (error) {
    throw new Error(getSupabaseErrorMessage(error, 'Could not save the shop profile.'));
  }
  return parseShopProfile(data);
}

export async function uploadCurrentShopLogo(file: File): Promise<string> {
  if (!supabase || !supabaseUrl) throw new Error('Supabase is not configured; shop logo could not be uploaded.');
  const fileError = shopLogoFileError(file);
  if (fileError) throw new Error(fileError);
  const extension = shopLogoFileExtension(file.type);
  if (!extension) throw new Error('Choose a PNG, JPEG, or WebP image.');

  const { data: objectPath, error: prepareError } = await supabase.rpc('prepare_current_shop_logo_upload', {
    p_extension: extension,
  });
  if (prepareError) {
    throw new Error(getSupabaseErrorMessage(prepareError, 'Could not prepare the shop logo upload.'));
  }
  if (typeof objectPath !== 'string' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(objectPath)) {
    throw new Error('The server returned an invalid shop logo upload path.');
  }

  const { error: uploadError } = await supabase.storage
    .from(SHOP_LOGO_BUCKET)
    .upload(objectPath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    throw new Error(getSupabaseErrorMessage(uploadError, 'Shop logo upload failed.'));
  }
  return supabase.storage.from(SHOP_LOGO_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

export async function removeCurrentShopLogo(logoUrl: string): Promise<void> {
  if (!supabase || !supabaseUrl) throw new Error('Supabase is not configured; shop logo could not be removed.');
  const objectPath = shopLogoObjectPath(logoUrl, supabaseUrl);
  if (!objectPath) return;

  const { error } = await supabase.storage.from(SHOP_LOGO_BUCKET).remove([objectPath]);
  if (error) {
    throw new Error(getSupabaseErrorMessage(error, 'Could not remove the previous shop logo.'));
  }
}
