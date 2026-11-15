import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SHOP_LOGO_MAX_BYTES,
  shopLogoFileError,
  shopLogoFileExtension,
  shopLogoStoragePath,
} from './shopLogo';

test('accepts supported logo formats within the size limit', () => {
  assert.equal(shopLogoFileError({ type: 'image/png', size: SHOP_LOGO_MAX_BYTES }), null);
  assert.equal(shopLogoFileExtension('image/jpeg'), 'jpg');
  assert.equal(shopLogoFileExtension('image/webp'), 'webp');
});

test('rejects unsupported, oversized, and SVG uploads', () => {
  assert.match(shopLogoFileError({ type: 'image/svg+xml', size: 10 }) ?? '', /PNG, JPEG, or WebP/);
  assert.match(shopLogoFileError({ type: 'image/png', size: SHOP_LOGO_MAX_BYTES + 1 }) ?? '', /2 MB/);
});

test('only recognizes stored logos belonging to the matching shop and project', () => {
  const projectUrl = 'https://project.supabase.co';
  const logoUrl = `${projectUrl}/storage/v1/object/public/shop-logos/shop-1/logo.webp`;
  assert.equal(shopLogoStoragePath(logoUrl, projectUrl, 'shop-1'), 'shop-1/logo.webp');
  assert.equal(shopLogoStoragePath(logoUrl, projectUrl, 'shop-2'), null);
  assert.equal(
    shopLogoStoragePath('https://other.supabase.co/storage/v1/object/public/shop-logos/shop-1/logo.webp', projectUrl, 'shop-1'),
    null,
  );
  assert.equal(
    shopLogoStoragePath(`${projectUrl}/storage/v1/object/public/shop-logos/shop-1/a/b.webp`, projectUrl, 'shop-1'),
    null,
  );
});
