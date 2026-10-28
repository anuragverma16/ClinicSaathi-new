import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

/**
 * Profile photos live on Cloudinary. Without credentials the feature stays
 * off and the API says so, rather than failing halfway through an upload.
 */
export const cloudinaryEnabled = Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
}

/** Uploads an image buffer, cropped to a square face-centred avatar. Overwrites the same publicId. */
export function uploadAvatarImage(buffer, publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({
      folder: 'clinicsaathi/avatars',
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
      transformation: [{ width: 256, height: 256, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'auto' }],
    }, (err, result) => (err ? reject(err) : resolve(result))).end(buffer);
  });
}

/** Best-effort removal; a failed delete must not block the user from clearing their photo. */
export async function deleteAvatarImage(publicId) {
  if (!cloudinaryEnabled || !publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true })
    .catch((e) => console.error('Avatar delete failed:', e.message));
}
