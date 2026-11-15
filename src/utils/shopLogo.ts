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
  const path = shopLogoObjectPath(logoUrl, supabaseUrl);
  if (!path || path.split('/')[0] !== shopId) return null;
  return path;
}

export function shopLogoObjectPath(
  logoUrl: string | null,
  supabaseUrl: string,
): string | null {
  if (!logoUrl) return null;

  try {
    const url = new URL(logoUrl);
    if (url.origin !== new URL(supabaseUrl).origin) return null;

    const marker = `/storage/v1/object/public/${SHOP_LOGO_BUCKET}/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const path = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    const [folder, fileName, ...extra] = path.split('/');
    if (!folder || !fileName || extra.length > 0 || !/^[0-9a-f-]{36}$/i.test(folder)
      || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(fileName)) return null;
    return path;
  } catch {
    return null;
  }
}
