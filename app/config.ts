const listenPort = process.env.IM_PORT || 3000
const listenHost = process.env.IM_HOST || '0.0.0.0'
const serverName = process.env.IM_SERVER_NAME || 'localhost'
const cookieSecret = process.env.IM_COOKIE_SECRET || 'dev-cookie-secret'
const corsOrigins = process.env.IM_CORS_ORIGINS || '*'

if (cookieSecret === 'dev-cookie-secret') {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: IM_COOKIE_SECRET must be set in production')
    process.exit(1)
  }
  else {
    console.warn('WARNING: Using default IM_COOKIE_SECRET. Set a secure value for production.')
  }
}

// Upstream OIDC provider (e.g. Logto at login.gid.io)
const upstreamIssuer = process.env.IM_OIDC_ISSUER || 'https://login.gid.io/oidc'
const upstreamClientId = process.env.IM_OIDC_CLIENT_ID || ''
const upstreamClientSecret = process.env.IM_OIDC_CLIENT_SECRET || ''

// Cache driver: 'memory' (default) or 'redis' (requires REDIS_URL)
const cacheDriver = process.env.IM_CACHE_DRIVER || 'memory'

// Logging format: 'json' for production, 'cli' for dev
const logFormat = process.env.IM_LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'cli')

// Room membership limits (0 = unlimited)
const maxRoomMembers = Number(process.env.IM_MAX_ROOM_MEMBERS) || 0
const maxRoomsPerUser = Number(process.env.IM_MAX_ROOMS_PER_USER) || 0

// Media upload limits (0 = unlimited)
const mediaQuotaMb = Number(process.env.IM_MEDIA_QUOTA_MB) || 0
const mediaUploadsPerHour = Number(process.env.IM_MEDIA_UPLOADS_PER_HOUR) || 0

// Push gateway: server-level default so clients only need to provide pushkey
const pushGatewayUrl = process.env.IM_PUSH_GATEWAY_URL || ''

// Application Service registration directory
const asRegistrationDir = process.env.IM_AS_REGISTRATION_DIR || 'data/appservices'

// S3/R2 object storage (optional — falls back to local disk if not configured)
const s3AccountId = process.env.S3_ACCOUNT_ID || ''
const s3Bucket = process.env.S3_BUCKET_NAME || ''
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID || ''
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY || ''
const s3Region = process.env.S3_REGION || 'auto'
const s3PublicUrl = process.env.S3_PUBLIC_URL || ''

export const version = '0.1.0-beta.1'
export const poweredBy = 'gim'

export { asRegistrationDir, cacheDriver, cookieSecret, corsOrigins, listenHost, listenPort, logFormat, maxRoomMembers, maxRoomsPerUser, mediaQuotaMb, mediaUploadsPerHour, pushGatewayUrl, s3AccessKeyId, s3AccountId, s3Bucket, s3PublicUrl, s3Region, s3SecretAccessKey, serverName, upstreamClientId, upstreamClientSecret, upstreamIssuer }
