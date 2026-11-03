import { randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import type { Database } from './db.js';
import type { Config } from './config.js';
import { one } from './db.js';
import { hash, now } from './service.js';
import { AppError } from './validation.js';
const scrypt = promisify(scryptCallback);
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const result = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${result.toString('hex')}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, digest] = stored.split(':');
  const computed = await scrypt(password, salt || 'dummy-salt', 64) as Buffer;
  const expected = Buffer.from(digest || '00'.repeat(64), 'hex');
  return expected.length === computed.length && timingSafeEqual(expected, computed);
}
export interface AuthRequest extends Request { userId?: string; csrf?: string; agentId?: string }
export class Auth {
  cookieName = 'av_session';
  constructor(private db: Database, private config: Config) {}
  async createUser(email: string, name: string, password: string, demo = false) {
    const id = randomUUID();
    const digest = await passwordHash(password);
    try { await this.db.query('INSERT INTO agentvault.users(id,email,name,password_hash,is_demo,created_at) VALUES($1,$2,$3,$4,$5,$6)', [id, email.toLowerCase(), name, digest, demo, now()]); }
    catch (error: any) { if (error.code === '23505') throw new AppError(409, 'An account with this email already exists. Sign in instead.'); throw error; }
    return id;
  }
  async session(res: Response, userId: string, oldToken?: string) {
    if (oldToken) await this.db.query('DELETE FROM agentvault.sessions WHERE token_hash=$1', [hash(oldToken)]);
    const token = randomBytes(32).toString('hex'); const csrf = randomBytes(32).toString('hex');
    await this.db.query('INSERT INTO agentvault.sessions VALUES($1,$2,$3,$4)', [hash(token), userId, csrf, new Date(Date.now() + 7 * 86400000).toISOString()]);
    res.cookie(this.cookieName, token, { httpOnly: true, secure: this.config.production, sameSite: 'lax', path: '/', maxAge: 7 * 86400000 });
    return csrf;
  }
  require = async (req: AuthRequest, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[this.cookieName];
    if (!token || typeof token !== 'string') throw new AppError(401, 'Please sign in.');
    const session = await one(this.db, 'SELECT * FROM agentvault.sessions WHERE token_hash=$1 AND expires_at>$2', [hash(token), now()]);
    if (!session) throw new AppError(401, 'Your session expired. Please sign in again.');
    req.userId = session.user_id; req.csrf = session.csrf;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrf) throw new AppError(403, 'Invalid session verification. Refresh the page and try again.');
    next();
  };
  agent = async (req: AuthRequest, _res: Response, next: NextFunction) => {
    const value = req.headers.authorization;
    if (!value?.startsWith('Bearer av_')) throw new AppError(401, 'A scoped agent token is required.');
    const agent = await one(this.db, 'SELECT id,user_id,status FROM agentvault.agents WHERE token_hash=$1', [hash(value.slice(7))]);
    if (!agent || agent.status !== 'active') throw new AppError(403, 'Agent token is invalid, paused, or revoked.');
    req.userId = agent.user_id; req.agentId = agent.id; next();
  };
  // Database-backed limits work across separate Vercel instances.
  limit = (scope: string, max: number, windowMs: number, user = false) => async (req: AuthRequest, _res: Response, next: NextFunction) => {
    const key = hash(`${scope}:${user ? req.userId : req.ip}`); const start = Math.floor(Date.now() / windowMs) * windowMs;
    const result = await one(this.db, `INSERT INTO agentvault.rate_limits(key,window_start,count) VALUES($1,$2,1)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN agentvault.rate_limits.window_start=$2 THEN agentvault.rate_limits.count+1 ELSE 1 END, window_start=$2 RETURNING count`, [key, start]);
    if (result!.count > max) throw new AppError(429, 'Too many requests. Please wait a little and try again.'); next();
  };
}
