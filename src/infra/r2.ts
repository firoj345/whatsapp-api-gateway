import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface UploadOptions {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  folder?: string;
}

export type StorageProviderType = 'aws_s3' | 'cloudflare_r2' | 'local';

export class S3StorageService {
  private s3Client: S3Client | null = null;
  private providerType: StorageProviderType = 'local';
  private bucketName = '';
  private region = 'ap-southeast-2';

  constructor() {
    this.init();
  }

  private init() {
    // 1. Check AWS S3 (Primary)
    if (env.AWS_S3_BUCKET || env.AWS_ACCESS_KEY_ID || process.env.AWS_REGION || process.env.AWS_PROFILE) {
      try {
        this.region = env.AWS_REGION || 'ap-southeast-2';
        this.bucketName = env.AWS_S3_BUCKET || 'klz-api-gateway-s3-storage-384627056855-ap-southeast-2-an';

        const clientConfig: any = {
          region: this.region
        };

        // If explicit AWS keys are provided, use them; otherwise let AWS SDK v3 resolve via credential provider chain
        if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
          clientConfig.credentials = {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            sessionToken: env.AWS_SESSION_TOKEN || undefined
          };
        }

        this.s3Client = new S3Client(clientConfig);
        this.providerType = 'aws_s3';
        logger.info(
          { region: this.region, bucket: this.bucketName },
          '📦 AWS S3 Storage client initialized (ap-southeast-2)'
        );
        return;
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'Failed to initialize AWS S3 client, checking alternatives');
      }
    }

    // 2. Check Cloudflare R2 (Alternative)
    if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
      try {
        this.s3Client = new S3Client({
          region: 'auto',
          endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY
          }
        });
        this.providerType = 'cloudflare_r2';
        this.bucketName = env.R2_BUCKET_NAME || 'whatsapp-media';
        logger.info({ bucket: this.bucketName }, '☁️ Cloudflare R2 Storage client initialized');
        return;
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'Failed to initialize Cloudflare R2 S3 client');
      }
    }

    // 3. Local disk fallback
    logger.info('ℹ️ Remote cloud storage not fully configured, media storage will use local disk fallback (/media)');
    this.providerType = 'local';
    this.s3Client = null;
  }

  /**
   * Check if remote cloud storage (AWS S3 or Cloudflare R2) is configured and active
   */
  hasRemoteStorage(): boolean {
    return this.providerType !== 'local' && this.s3Client !== null;
  }

  /**
   * Backward-compatibility helper
   */
  hasR2(): boolean {
    return this.hasRemoteStorage();
  }

  getProvider(): StorageProviderType {
    return this.providerType;
  }

  /**
   * Upload media buffer to AWS S3 (or Cloudflare R2 / local fallback)
   * Returns a publicly accessible URL for the media.
   */
  async uploadMedia(options: UploadOptions): Promise<string> {
    const { buffer, filename, mimeType = 'application/octet-stream', folder = 'media' } = options;
    const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const randomHex = crypto.randomBytes(4).toString('hex');
    const objectKey = `${folder}/${Date.now()}_${randomHex}_${cleanName}`;

    // 1. Upload to AWS S3 or Cloudflare R2 if client exists
    if (this.hasRemoteStorage() && this.s3Client) {
      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: objectKey,
            Body: buffer,
            ContentType: mimeType,
            CacheControl: 'public, max-age=31536000, immutable'
          })
        );

        logger.info(
          { provider: this.providerType, bucket: this.bucketName, key: objectKey, sizeBytes: buffer.length, mimeType },
          `🚀 Successfully uploaded media to ${this.providerType === 'aws_s3' ? 'AWS S3' : 'Cloudflare R2'}`
        );

        // Determine accessible URL
        if (this.providerType === 'aws_s3') {
          if (env.AWS_S3_USE_PRESIGNED_URLS) {
            // Generate a 7-day presigned GET URL (maximum allowed by SigV4)
            return await getSignedUrl(
              this.s3Client,
              new GetObjectCommand({
                Bucket: this.bucketName,
                Key: objectKey
              }),
              { expiresIn: 7 * 24 * 3600 }
            );
          }

          if (env.AWS_S3_PUBLIC_URL) {
            const basePublic = env.AWS_S3_PUBLIC_URL.replace(/\/+$/, '');
            return `${basePublic}/${objectKey}`;
          }

          // Standard AWS S3 Object URL
          return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${objectKey}`;
        }

        // Cloudflare R2
        if (env.R2_PUBLIC_URL) {
          const basePublic = env.R2_PUBLIC_URL.replace(/\/+$/, '');
          return `${basePublic}/${objectKey}`;
        }
        return `https://${this.bucketName}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${objectKey}`;
      } catch (cloudErr: any) {
        logger.error(
          { err: cloudErr?.message, key: objectKey, provider: this.providerType },
          'Cloud storage upload failed, falling back to local storage'
        );
      }
    }

    // 2. Fallback: Save to local media directory and serve via /media
    return this.saveToLocal(buffer, objectKey);
  }

  /**
   * Fallback: Save to local media disk and return HTTP URL
   */
  private saveToLocal(buffer: Buffer, objectKey: string): string {
    const baseDir = path.resolve(env.MEDIA_STORAGE_PATH || './data/media');
    const targetFile = path.join(baseDir, objectKey);
    const targetFolder = path.dirname(targetFile);

    try {
      if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
      }
      fs.writeFileSync(targetFile, buffer);

      // Return URL relative to API base
      const baseUrl = (env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const localUrl = `${baseUrl}/media/${objectKey}`;
      logger.info({ path: targetFile, localUrl }, '💾 Media stored to local disk');
      return localUrl;
    } catch (err: any) {
      logger.error({ err: err?.message, targetFile }, 'Failed to save media locally');
      if (buffer.length < 500 * 1024) {
        return `data:application/octet-stream;base64,${buffer.toString('base64')}`;
      }
      return '';
    }
  }
}

export const s3Storage = new S3StorageService();
export const r2Storage = s3Storage; // Backward compatibility alias
export const R2StorageService = S3StorageService;
