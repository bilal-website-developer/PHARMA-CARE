import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SHOP_LOGO_MAX_BYTES,
  shopLogoFileError,
  shopLogoFileExtension,
  shopLogoObjectPath,
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
  const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const logoUrl = `${projectUrl}/storage/v1/object/public/shop-logos/${shopId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`;
  assert.equal(shopLogoStoragePath(logoUrl, projectUrl, shopId), `${shopId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`);
  assert.equal(shopLogoStoragePath(logoUrl, projectUrl, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), null);
  assert.equal(
    shopLogoObjectPath(
      `${projectUrl}/storage/v1/object/public/shop-logos/dddddddd-dddd-4ddd-8ddd-dddddddddddd/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png`,
      projectUrl,
    ),
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png',
  );
  assert.equal(
    shopLogoStoragePath('https://other.supabase.co/storage/v1/object/public/shop-logos/shop-1/logo.webp', projectUrl, 'shop-1'),
    null,
  );
  assert.equal(
    shopLogoStoragePath(`${projectUrl}/storage/v1/object/public/shop-logos/${shopId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/a.webp`, projectUrl, shopId),
    null,
  );
  assert.equal(
    shopLogoObjectPath(`${projectUrl}/storage/v1/object/public/shop-logos/not-a-uuid/logo.webp`, projectUrl),
    null,
  );
});
