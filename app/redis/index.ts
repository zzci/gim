const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

let redis: import('bun').RedisClient | null = null
let redisSub: import('bun').RedisClient | null = null

export async function getRedis() {
  if (!redis) {
    try {
      const { RedisClient } = await import('bun')
      redis = new RedisClient(redisUrl)
      logger.info('Redis connected')
    }
    catch (e) {
      logger.warn('Redis not available, running without Redis')
      return null
    }
  }
  return redis
}

export async function getRedisSub() {
  if (!redisSub) {
    try {
      const { RedisClient } = await import('bun')
      redisSub = new RedisClient(redisUrl)
    }
    catch {
      return null
    }
  }
  return redisSub
}

export async function closeRedis() {
  if (redis) {
    redis.close?.()
    redis = null
  }
  if (redisSub) {
    redisSub.close?.()
    redisSub = null
  }
}
