import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [algorithm, salt, encoded] = String(stored).split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(encoded)) return false;
  const key = await scryptAsync(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(encoded, 'hex'));
}

export const hashToken = token => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');

export function sessionToken(req) {
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)minicursos_admin=([a-f0-9]{64})(?:;|$)/);
  return match?.[1];
}
