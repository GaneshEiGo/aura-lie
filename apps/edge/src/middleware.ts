import { Context, Next } from 'hono';

/**
 * PRD Section 12.7: Cost Guard & Auth Middleware
 */
export const authMiddleware = async (c: Context, next: Next) => {
  // Health check is public
  if (c.req.path === '/health') {
    return next();
  }

  // Mock Auth Check (Owner-only passkey)
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Mock Kill Switch Check
  const killSwitchActive = false; 
  if (killSwitchActive) {
    return c.json({ error: 'Autonomy paused by owner' }, 503);
  }

  return next();
};