// ============================================================================
// BRAVOMART - UPLOAD & STORAGE SERVICE
// ============================================================================
// Where an uploaded image buffer actually ends up. Today that's the local
// filesystem, served back out by `express.static` in app.ts — fine for a
// single-server deployment or local development. 
//
// The moment you deploy to more than one server instance (or anywhere with an 
// ephemeral filesystem like Render or Railway), local disk storage stops working.
// This function is the ONLY place in the codebase that knows *where* files
// are stored. Swapping to S3/Cloudinary/GCS later means rewriting the body
// of `persistImageBuffer` to `client.upload(buffer).then(r => r.url)`.

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

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
  /** Public, web-servable URL path (e.g. "/uploads/products/<uuid>.jpg"). */
  url: string;
  /** Absolute system path where the file is written locally. */
  absolutePath: string;
}

/**
 * Takes a raw Buffer, saves it inside the configured upload directory, 
 * and returns the public relative URL and absolute system path.
 *
 * @param buffer - File content stored in memory
 * @param mimeType - File MIME type (e.g. 'image/jpeg')
 * @param subfolder - Subdirectory under UPLOAD_DIR (e.g. 'products', 'kyc')
 */
export async function persistImageBuffer(
  buffer: Buffer,
  mimeType: string,
  subfolder: string
): Promise<StoredFile> {
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
    // Check if placeholder image already exists
    await access(placeholderPath);
  } catch {
    // Create a 1x1 transparent/grey placeholder pixel if missing
    const defaultBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    await writeFile(placeholderPath, defaultBuffer);
  }

  return publicUrl;
}