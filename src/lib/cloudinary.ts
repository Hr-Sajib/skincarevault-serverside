import { v2 as cloudinary } from 'cloudinary';
import { config } from '@/config';
import { AppError } from '@/utils/AppError';
import { logger } from '@/lib/logger';

if (config.cloudinary.isConfigured) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
}

export interface UploadSignature {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
  uploadUrl: string;
}

/**
 * Mints a short-lived signature so the admin's browser uploads straight to
 * Cloudinary. The file never passes through this server, which keeps a
 * twenty-image product upload off our request path entirely.
 *
 * The signature is scoped to one folder and expires in about a minute, so a
 * leaked one is worth very little.
 */
export function createUploadSignature(subfolder = 'products'): UploadSignature {
  if (!config.cloudinary.isConfigured) {
    throw new AppError(
      503,
      'Image uploads are not configured. Add the Cloudinary credentials to .env.',
      'CLOUDINARY_NOT_CONFIGURED',
    );
  }

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `${config.cloudinary.folder}/${subfolder}`;

  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder },
    config.cloudinary.apiSecret as string,
  );

  return {
    signature,
    timestamp,
    apiKey: config.cloudinary.apiKey as string,
    cloudName: config.cloudinary.cloudName as string,
    folder,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/image/upload`,
  };
}

/** Removes an asset. Resolves even on failure — callers log rather than fail. */
export async function destroyAsset(publicId: string): Promise<boolean> {
  if (!config.cloudinary.isConfigured) return false;

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === 'ok' || result.result === 'not found';
  } catch (err) {
    logger.error({ err, publicId }, 'Cloudinary destroy failed');
    return false;
  }
}

/**
 * Builds a transformed delivery URL from a stored public id.
 *
 * One upload serves every size the storefront needs — `f_auto` picks WebP or
 * AVIF per browser, `q_auto` picks the quality, and the CDN caches each
 * variant. This is why no resize pipeline had to be written.
 */
export function buildImageUrl(
  publicId: string,
  opts: { width?: number; height?: number; crop?: string } = {},
): string {
  if (!config.cloudinary.isConfigured) return '';

  return cloudinary.url(publicId, {
    secure: true,
    fetch_format: 'auto',
    quality: 'auto',
    width: opts.width,
    height: opts.height,
    crop: opts.crop ?? 'fill',
  });
}
