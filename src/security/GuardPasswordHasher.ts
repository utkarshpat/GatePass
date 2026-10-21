import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

// Matches the reviewed SQL hash contract. Cost is bounded before any allocation.
const prefix = '$argon2id$v=19$m=19456,t=2,p=1$';
const pattern = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/u;
const base64 = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/u, '');
export class PasswordPolicyError extends Error {}

export function validateNewGuardPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || !password.isWellFormed() ||
      [...password].length < 15 || [...password].length > 128 || Buffer.byteLength(password, 'utf8') > 512) {
    throw new PasswordPolicyError('Use a passphrase of 15–128 characters.');
  }
}

export class GuardPasswordHasher {
  #active = 0;
  #maximum: number;
  constructor(maximumConcurrent = 2) {
    if (!Number.isInteger(maximumConcurrent) || maximumConcurrent < 1 || maximumConcurrent > 8) throw new Error('Invalid hashing concurrency.');
    this.#maximum = maximumConcurrent;
  }
  async #derive(password: string, salt: Buffer): Promise<Buffer> {
    if (this.#active >= this.#maximum) throw new Error('AUTH_BUSY');
    this.#active++;
    const message = Buffer.from(password, 'utf8');
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        argon2('argon2id', { message, nonce: salt, parallelism: 1, tagLength: 32, memory: 19456, passes: 2 },
          (error, result) => error ? reject(error) : resolve(result));
      });
    } finally { message.fill(0); this.#active--; }
  }
  async hash(password: string): Promise<string> {
    validateNewGuardPassword(password);
    const salt = randomBytes(16);
    const tag = await this.#derive(password, salt);
    try { return prefix + base64(salt) + '$' + base64(tag); }
    finally { tag.fill(0); }
  }
  async verify(password: string, encoded: string): Promise<boolean> {
    const match = pattern.exec(encoded);
    if (!match) throw new Error('INVALID_PASSWORD_HASH');
    const salt = Buffer.from(match[1], 'base64');
    const expected = Buffer.from(match[2], 'base64');
    if (base64(salt) !== match[1] || base64(expected) !== match[2]) throw new Error('INVALID_PASSWORD_HASH');
    if (!password.isWellFormed() || [...password].length > 128 || Buffer.byteLength(password, 'utf8') > 512) return false;
    const actual = await this.#derive(password, salt);
    try { return timingSafeEqual(actual, expected); }
    finally { actual.fill(0); expected.fill(0); }
  }
}
