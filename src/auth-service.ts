// Auth Service - API Key authentication and rate limiting
import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';

// Types
interface ApiKey {
  key: string;
  userId: string;
  name: string;
  createdAt: string;
  enabled: boolean;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// Initialize Redis (optional - falls back to in-memory if not configured)
let redis: Redis | null = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('✓ Redis connected for rate limiting');
} else {
  console.log('⚠ Redis not configured - using in-memory rate limiting (resets on deploy)');
}

// In-memory fallback for rate limiting
const memoryRateLimits = new Map<string, { count: number; resetAt: number }>();

// In-memory API key storage (for demo - in production use database)
// Format: API_KEYS=key1:userId1:name1,key2:userId2:name2
const apiKeys = new Map<string, ApiKey>();

// Load API keys from environment
function loadApiKeys() {
  const keysEnv = process.env.API_KEYS || '';
  if (keysEnv) {
    keysEnv.split(',').forEach(entry => {
      const [key, userId, name] = entry.split(':');
      if (key && userId) {
        apiKeys.set(key, {
          key,
          userId,
          name: name || 'Unnamed',
          createdAt: new Date().toISOString(),
          enabled: true,
        });
      }
    });
    console.log(`✓ Loaded ${apiKeys.size} API keys`);
  }
  
  // Always add a demo key for testing
  if (!apiKeys.has('demo_key_for_testing')) {
    apiKeys.set('demo_key_for_testing', {
      key: 'demo_key_for_testing',
      userId: 'demo_user',
      name: 'Demo Key',
      createdAt: new Date().toISOString(),
      enabled: true,
    });
  }
}

loadApiKeys();

// Generate a new API key
export function generateApiKey(userId: string, name: string): ApiKey {
  const key = `mcp_${uuidv4().replace(/-/g, '')}`;
  const apiKey: ApiKey = {
    key,
    userId,
    name,
    createdAt: new Date().toISOString(),
    enabled: true,
  };
  apiKeys.set(key, apiKey);
  return apiKey;
}

// Validate API key and return user info
export function validateApiKey(key: string): ApiKey | null {
  // Allow requests without API key in demo mode
  if (!key && process.env.REQUIRE_API_KEY !== 'true') {
    return {
      key: 'anonymous',
      userId: 'anonymous',
      name: 'Anonymous User',
      createdAt: new Date().toISOString(),
      enabled: true,
    };
  }
  
  const apiKey = apiKeys.get(key);
  if (!apiKey || !apiKey.enabled) {
    return null;
  }
  return apiKey;
}

// Rate limiting configuration
const RATE_LIMITS = {
  generate: { limit: 5, windowSeconds: 86400 },      // 5 per day
  release: { limit: 10, windowSeconds: 86400 },     // 10 per day  
  artist: { limit: 10, windowSeconds: 86400 },      // 10 per day
  chat: { limit: 100, windowSeconds: 3600 },        // 100 per hour
  default: { limit: 1000, windowSeconds: 3600 },    // 1000 per hour
};

type RateLimitType = keyof typeof RATE_LIMITS;

// Check rate limit using Redis or in-memory
export async function checkRateLimit(
  userId: string, 
  type: RateLimitType = 'default'
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[type] || RATE_LIMITS.default;
  const key = `ratelimit:${type}:${userId}`;
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const resetAt = now + windowMs;
  
  if (redis) {
    // Use Redis for persistent rate limiting
    try {
      const current = await redis.incr(key);
      
      // Set expiry on first request
      if (current === 1) {
        await redis.expire(key, config.windowSeconds);
      }
      
      const ttl = await redis.ttl(key);
      const actualResetAt = now + (ttl * 1000);
      
      return {
        allowed: current <= config.limit,
        remaining: Math.max(0, config.limit - current),
        resetAt: actualResetAt,
      };
    } catch (error) {
      console.error('Redis rate limit error, falling back to in-memory:', error);
      // Fall through to in-memory
    }
  }
  
  // In-memory fallback
  const existing = memoryRateLimits.get(key);
  
  if (!existing || existing.resetAt < now) {
    // New window
    memoryRateLimits.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: config.limit - 1,
      resetAt,
    };
  }
  
  existing.count++;
  return {
    allowed: existing.count <= config.limit,
    remaining: Math.max(0, config.limit - existing.count),
    resetAt: existing.resetAt,
  };
}

// Express middleware for API key auth
export function apiKeyAuth(required: boolean = false) {
  return (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'] as string;
    const user = validateApiKey(apiKey);
    
    if (!user && required) {
      return res.status(401).json({ 
        error: 'Invalid or missing API key',
        hint: 'Include X-API-Key header with a valid key',
      });
    }
    
    // Attach user to request
    req.user = user;
    req.userId = user?.userId || req.ip || 'anonymous';
    next();
  };
}

// Express middleware for rate limiting
export function rateLimitMiddleware(type: RateLimitType = 'default') {
  return async (req: any, res: any, next: any) => {
    const userId = req.userId || req.user?.userId || req.ip || 'anonymous';
    const result = await checkRateLimit(userId, type);
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', RATE_LIMITS[type]?.limit || 1000);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt / 1000));
    
    if (!result.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        remaining: 0,
        resetAt: new Date(result.resetAt).toISOString(),
      });
    }
    
    next();
  };
}

// ============================================
// Release Ownership Tracking
// ============================================

// In-memory fallback for release ownership
const memoryReleaseOwnership = new Map<string, string>(); // releaseId -> userId

// Record that a user owns a release
export async function setReleaseOwner(releaseId: string, userId: string): Promise<void> {
  const key = `release:owner:${releaseId}`;
  const userReleasesKey = `user:releases:${userId}`;
  
  if (redis) {
    try {
      await redis.set(key, userId);
      await redis.sadd(userReleasesKey, releaseId);
      return;
    } catch (error) {
      console.error('Redis setReleaseOwner error:', error);
    }
  }
  
  // In-memory fallback
  memoryReleaseOwnership.set(releaseId, userId);
}

// Get the owner of a release
export async function getReleaseOwner(releaseId: string): Promise<string | null> {
  const key = `release:owner:${releaseId}`;
  
  if (redis) {
    try {
      return await redis.get<string>(key);
    } catch (error) {
      console.error('Redis getReleaseOwner error:', error);
    }
  }
  
  return memoryReleaseOwnership.get(releaseId) || null;
}

// Get all release IDs owned by a user
export async function getUserReleaseIds(userId: string): Promise<string[]> {
  const key = `user:releases:${userId}`;
  
  if (redis) {
    try {
      const ids = await redis.smembers(key);
      return ids || [];
    } catch (error) {
      console.error('Redis getUserReleaseIds error:', error);
    }
  }
  
  // In-memory fallback
  const ids: string[] = [];
  memoryReleaseOwnership.forEach((owner, releaseId) => {
    if (owner === userId) ids.push(releaseId);
  });
  return ids;
}

// Check if a user owns a release
export async function userOwnsRelease(releaseId: string, userId: string): Promise<boolean> {
  const owner = await getReleaseOwner(releaseId);
  return owner === userId;
}

// Get user's usage stats
export async function getUserStats(userId: string): Promise<Record<string, any>> {
  const stats: Record<string, any> = {};
  
  for (const [type, config] of Object.entries(RATE_LIMITS)) {
    const key = `ratelimit:${type}:${userId}`;
    
    if (redis) {
      try {
        const count = await redis.get<number>(key) || 0;
        const ttl = await redis.ttl(key);
        stats[type] = {
          used: count,
          limit: config.limit,
          remaining: Math.max(0, config.limit - count),
          resetsIn: ttl > 0 ? `${Math.floor(ttl / 60)} minutes` : 'now',
        };
      } catch {
        stats[type] = { error: 'Could not fetch' };
      }
    } else {
      const existing = memoryRateLimits.get(key);
      stats[type] = {
        used: existing?.count || 0,
        limit: config.limit,
        remaining: Math.max(0, config.limit - (existing?.count || 0)),
        resetsIn: existing ? `${Math.floor((existing.resetAt - Date.now()) / 60000)} minutes` : 'now',
      };
    }
  }
  
  return stats;
}
