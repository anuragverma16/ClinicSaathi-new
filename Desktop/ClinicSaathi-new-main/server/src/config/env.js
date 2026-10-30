import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config();

const required = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}. Copy .env.example to .env.`);
    process.exit(1);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5003),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  // Public base URL of this API, used in links handed to outside services (calendar feeds).
  publicApiUrl: process.env.PUBLIC_API_URL,
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD ?? 'root',
    database: process.env.MYSQL_DATABASE || 'clinicsaathi',
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
  },
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  },
  // Signs short-lived file download links. Falls back to the access secret so
  // existing installs keep working, but a separate value is recommended.
  fileUrlSecret: process.env.FILE_URL_SECRET || process.env.JWT_ACCESS_SECRET,
  storageDir: path.resolve(process.env.STORAGE_DIR || 'storage/private'),
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    token: process.env.WHATSAPP_TOKEN,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    // Dev-only: route inbound messages from an unmapped number to this clinic.
    devClinicSlug: process.env.WHATSAPP_DEV_CLINIC_SLUG,
    enabled: Boolean(process.env.WHATSAPP_TOKEN),
  },
  openaiKey: process.env.OPENAI_API_KEY,
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    enabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  },
  email: {
    from: process.env.EMAIL_FROM,
    resendKey: process.env.RESEND_API_KEY,
    enabled: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  },
  // Predefined platform login — the only way in, since there is no sign-up.
  superAdmin: {
    email: (process.env.SUPER_ADMIN_EMAIL || 'admin@clinicsaathi.com').trim().toLowerCase(),
    password: process.env.SUPER_ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'Admin@12345'),
    name: process.env.SUPER_ADMIN_NAME || 'Super Admin',
  },
  // Relaxed limits for the automated test suite only.
  rateLimitMultiplier: process.env.NODE_ENV === 'test' ? 1000 : 1,
};
