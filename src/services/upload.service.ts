// ============================================================================
// BRAVOMART - UPLOAD & STORAGE SERVICE
// ============================================================================
// Persists uploaded and AI-generated image buffers to Cloudinary in production
// so assets survive Render redeploys/sleep cycles, with an automatic fallback
// to local disk when Cloudinary credentials are not configured.

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { uploadBufferToCloudinary } from '../utils/cloudinary.js';

/** Supported image extensions by MIME type. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

export interface StoredFile {
  /** Public, web-servable URL (Cloudinary HTTPS URL or local "/uploads/..." path). */
  url: string;
  /** Absolute system path where the file is written locally (empty string for Cloudinary). */
  absolutePath: string;
}

const isCloudinaryConfigured = (): boolean =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

/**
 * Takes a raw Buffer, uploads it to Cloudinary (or saves locally if Cloudinary
 * isn't configured), and returns the public URL.
 *
 * @param buffer - File content stored in memory
 * @param mimeType - File MIME type (e.g. 'image/jpeg')
 * @param subfolder - Subdirectory / Cloudinary folder suffix (e.g. 'products', 'kyc')
 */
export async function persistImageBuffer(
  buffer: Buffer,
  mimeType: string,
  subfolder: string
): Promise<StoredFile> {
  if (isCloudinaryConfigured()) {
    const secureUrl = await uploadBufferToCloudinary(buffer, `bravomart/${subfolder}`);
    return {
      url: secureUrl,
      absolutePath: '',
    };
  }

  // Local disk fallback for offline development
  const extension = EXTENSION_BY_MIME[mimeType] ?? 'jpg';
  const filename = `${randomUUID()}.${extension}`;

  const folder = path.join(process.cwd(), env.UPLOAD_DIR, subfolder);
  await mkdir(folder, { recursive: true });

  const absolutePath = path.join(folder, filename);
  await writeFile(absolutePath, buffer);

  return {
    url: `/${env.UPLOAD_DIR}/${subfolder}/${filename}`,
    absolutePath,
  };
}

/**
 * Ensures a default fallback image exists in the uploads folder.
 * Used when AI image generation or uploads are unavailable.
 */
export async function ensurePlaceholderImage(subfolder: string = 'products'): Promise<string> {
  const folder = path.join(process.cwd(), env.UPLOAD_DIR, subfolder);
  await mkdir(folder, { recursive: true });

  const placeholderPath = path.join(folder, 'placeholder.jpg');
  const publicUrl = `/${env.UPLOAD_DIR}/${subfolder}/placeholder.jpg`;

  try {
    await access(placeholderPath);
  } catch {
    const defaultBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    await writeFile(placeholderPath, defaultBuffer);
  }

  return publicUrl;
}