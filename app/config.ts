const nodeEnv = process.env.NODE_ENV || 'development'
const isProduction = nodeEnv === 'production'

const listenPort = process.env.IM_PORT || 3000
const listenHost = process.env.IM_HOST || '0.0.0.0'
const serverName = process.env.IM_SERVER_NAME || 'localhost'
const cookieSecret = process.env.IM_COOKIE_SECRET || 'dev-cookie-secret'
const corsOrigins = process.env.IM_CORS_ORIGINS || '*'

if (cookieSecret === 'dev-cookie-secret') {
  if (isProduction) {
    console.error('FATAL: IM_COOKIE_SECRET must be set in production')
    process.exit(1)
  }
  else {
    console.warn('WARNING: Using default IM_COOKIE_SECRET. Set a secure value for production.')
  }
}

// Database
const dbPath = process.env.DB_PATH || 'data/gim.db'

// Upstream OIDC provider
const upstreamIssuer = process.env.IM_OIDC_ISSUER || ''
const upstreamClientId = process.env.IM_OIDC_CLIENT_ID || ''
const upstreamClientSecret = process.env.IM_OIDC_CLIENT_SECRET || ''

// Cache driver: 'memory' (default) or 'redis' (requires REDIS_URL)
const cacheDriver = process.env.IM_CACHE_DRIVER || 'memory'

// Redis (required when cacheDriver === 'redis')
const redisUrl = process.env.REDIS_URL || ''

// Logging: format and level
const logFormat = process.env.IM_LOG_FORMAT || (isProduction ? 'json' : 'cli')
const logLevel = process.env.IM_LOG_LEVEL || (isProduction ? 'info' : 'debug') // error, warn, info, http, verbose, debug, silly

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

// TURN server (optional — for VoIP relay)
const turnUris = process.env.IM_TURN_URIS || '' // comma-separated, e.g. "turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp"
const turnSharedSecret = process.env.IM_TURN_SHARED_SECRET || ''
const turnTtl = Number(process.env.IM_TURN_TTL) || 86400 // seconds

// LiveKit / MatrixRTC (optional — for group calls via SFU)
const livekitServiceUrl = process.env.IM_LIVEKIT_SERVICE_URL || '' // e.g. "https://livekit-jwt.call.matrix.org/livekit/jwt"

// S3/R2 object storage (optional — falls back to local disk if not configured)
const s3AccountId = process.env.S3_ACCOUNT_ID || ''
const s3Bucket = process.env.S3_BUCKET_NAME || ''
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID || ''
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY || ''
const s3Region = process.env.S3_REGION || 'auto'
const s3PublicUrl = process.env.S3_PUBLIC_URL || ''
const e2eeKeyBackupEnabled = ['1', 'true', 'yes', 'on'].includes(
  (process.env.IM_E2EE_KEY_BACKUP_ENABLED || '').trim().toLowerCase(),
)
const requireEncryption
  = (process.env.IM_REQUIRE_ENCRYPTION || 'true').trim().toLowerCase() === 'true'

const metricsSecret = process.env.IM_METRICS_SECRET || ''
const trustedProxyCidrs = (process.env.IM_TRUSTED_PROXY_CIDRS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

// Device auto-expiry (inactive days before cleanup, 0 = disabled)
const deviceInactiveDays = Number(process.env.IM_DEVICE_INACTIVE_DAYS) || 90

// Token cache TTLs
const oauthAccessTokenCacheMaxTtlSec
  = Number(process.env.IM_OAUTH_ACCESS_TOKEN_CACHE_MAX_TTL_SEC || 3600) || 3600
const accountTokenCacheMaxTtlSec
  = Number(process.env.IM_ACCOUNT_TOKEN_CACHE_MAX_TTL_SEC || 7200) || 7200
const accountTokenValiditySec = Number(process.env.IM_ACCOUNT_TOKEN_VALIDITY_SEC || 0) || 0

// Security headers
const hstsMaxAge = Number(process.env.IM_HSTS_MAX_AGE ?? (isProduction ? '31536000' : '0'))

// Rate limiting
const rateLimitLoginMax = Number(process.env.IM_RATE_LIMIT_LOGIN_MAX) || 30
const rateLimitRegisterMax = Number(process.env.IM_RATE_LIMIT_REGISTER_MAX) || 15
const rateLimitOauthMax = Number(process.env.IM_RATE_LIMIT_OAUTH_MAX) || 100

// E2EE strict signature verification flags
const e2eeStrictSignatureVerify = envFlagEnabled(process.env.IM_E2EE_STRICT_SIGNATURE_VERIFY)
const strictDeviceKeySignatureVerify = envFlagEnabled(
  process.env.IM_STRICT_DEVICE_KEY_SIGNATURE_VERIFY,
)

function envFlagEnabled(value?: string): boolean {
  if (!value)
    return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export const version = '0.4.0'

interface BuildInfo {
  commit: string
  commitFull: string
  branch: string
  buildTime: string
}

const defaultBuildInfo: BuildInfo = {
  commit: 'dev',
  commitFull: 'dev',
  branch: 'dev',
  buildTime: new Date().toISOString(),
}

function loadBuildInfo(): BuildInfo {
  if (typeof Bun !== 'undefined') {
    const file = Bun.file('./build.json')
    if (!file.size)
      return defaultBuildInfo
    try {
      // eslint-disable-next-line ts/no-require-imports
      return require('../build.json')
    }
    catch {
      return defaultBuildInfo
    }
  }
  return defaultBuildInfo
}

export const buildInfo = loadBuildInfo()
export const poweredBy = 'gim'

export {
  accountTokenCacheMaxTtlSec,
  accountTokenValiditySec,
  asRegistrationDir,
  cacheDriver,
  cookieSecret,
  corsOrigins,
  dbPath,
  deviceInactiveDays,
  e2eeKeyBackupEnabled,
  e2eeStrictSignatureVerify,
  hstsMaxAge,
  isProduction,
  listenHost,
  listenPort,
  livekitServiceUrl,
  logFormat,
  logLevel,
  maxRoomMembers,
  maxRoomsPerUser,
  mediaQuotaMb,
  mediaUploadsPerHour,
  metricsSecret,
  oauthAccessTokenCacheMaxTtlSec,
  pushGatewayUrl,
  rateLimitLoginMax,
  rateLimitOauthMax,
  rateLimitRegisterMax,
  redisUrl,
  requireEncryption,
  s3AccessKeyId,
  s3AccountId,
  s3Bucket,
  s3PublicUrl,
  s3Region,
  s3SecretAccessKey,
  serverName,
  strictDeviceKeySignatureVerify,
  trustedProxyCidrs,
  turnSharedSecret,
  turnTtl,
  turnUris,
  upstreamClientId,
  upstreamClientSecret,
  upstreamIssuer,
}
