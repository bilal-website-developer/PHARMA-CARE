export const SHOP_LOGO_BUCKET = 'shop-logos';
export const SHOP_LOGO_MAX_BYTES = 2 * 1024 * 1024;

const SHOP_LOGO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function shopLogoFileError(file: Pick<File, 'size' | 'type'>): string | null {
  if (!Object.prototype.hasOwnProperty.call(SHOP_LOGO_EXTENSIONS, file.type)) {
    return 'Choose a PNG, JPEG, or WebP image.';
  }
  if (file.size > SHOP_LOGO_MAX_BYTES) {
    return 'Shop logos must be 2 MB or smaller.';
  }
  return null;
}

export function shopLogoFileExtension(mimeType: string): string | null {
  return SHOP_LOGO_EXTENSIONS[mimeType] ?? null;
}

export function shopLogoStoragePath(
  logoUrl: string | null,
  supabaseUrl: string,
  shopId: string,
): string | null {
  if (!logoUrl) return null;

  try {
    const url = new URL(logoUrl);
    if (url.origin !== new URL(supabaseUrl).origin) return null;

    const marker = `/storage/v1/object/public/${SHOP_LOGO_BUCKET}/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const path = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    const [pathShopId, fileName, ...extra] = path.split('/');
    if (pathShopId !== shopId || !fileName || extra.length > 0 || fileName === '.' || fileName === '..') {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}
