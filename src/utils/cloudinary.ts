import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a local Multer file to Cloudinary, deletes the temp file,
 * and returns the permanent secure HTTPS URL.
 */
export async function uploadFileToCloudinary(
  localFilePath: string,
  folder = 'bravomart/products'
): Promise<string> {
  try {
    const result = await cloudinary.uploader.upload(localFilePath, {
      folder,
      resource_type: 'image',
    });
    return result.secure_url;
  } finally {
    // Clean up local temp file if it exists
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
  }
}

/**
 * Uploads a Buffer (e.g., Multer memoryStorage or Vertex AI Imagen 3 base64 buffer)
 * directly to Cloudinary without touching Render's local disk.
 */
export function uploadBufferToCloudinary(
  buffer: Buffer,
  folder = 'bravomart/products'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) {
          return reject(error || new Error('Cloudinary upload failed'));
        }
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}