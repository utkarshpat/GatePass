import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export interface QrKeySource {
  active(): Promise<{ id: string; key: Buffer }>;
  resolve(id: string): Promise<Buffer>;
}
export type QrEnvelope = { clientPersonKey: string; visitRequestId: string; accessPassId: string;
  credentialHash: string; ciphertext: string; nonce: string; authenticationTag: string; keyVersion: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const validKeyId = (id: string) => /^[A-Za-z0-9_-]{1,80}$/u.test(id);
const aad = (visit: string, pass: string, version: string) => Buffer.from(`GatePass|QR|1|${visit.toLowerCase()}|${pass.toLowerCase()}|${version}`, 'utf8');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest();
const hex = (bytes: Buffer) => bytes.toString('hex').toUpperCase();
const parseHex = (value: string, length: number): Buffer => {
  if (typeof value !== 'string' || value.length !== length * 2 || !/^[0-9a-f]+$/iu.test(value)) throw new Error('INVALID_QR_ENVELOPE');
  return Buffer.from(value, 'hex');
};
function encryptCredential(clientPersonKey: string, visitRequestId: string, keyId: string, key: Buffer): QrEnvelope {
  const accessPassId = randomUUID(); const keyVersion = 'qr.v1.' + keyId; const nonce = randomBytes(12); const plaintext = randomBytes(32);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 }); cipher.setAAD(aad(visitRequestId, accessPassId, keyVersion));
    return { clientPersonKey: clientPersonKey.toLowerCase(), visitRequestId: visitRequestId.toLowerCase(), accessPassId,
      credentialHash: hex(digest(plaintext)), ciphertext: hex(Buffer.concat([cipher.update(plaintext), cipher.final()])), nonce: hex(nonce), authenticationTag: hex(cipher.getAuthTag()), keyVersion };
  } finally { plaintext.fill(0); }
}
/** A replacement is bound to the EXISTING visit; it never creates another visit. */
export async function prepareReplacementQrEnvelope(visitRequestId: string, source: QrKeySource): Promise<QrEnvelope> {
  if (!uuid.test(visitRequestId)) throw new Error('INVALID_QR_VISIT');
  const active = await source.active();
  if (!validKeyId(active.id) || !Buffer.isBuffer(active.key) || active.key.length !== 32) throw new Error('INVALID_QR_KEY');
  const key = Buffer.from(active.key);
  try { return encryptCredential(visitRequestId, visitRequestId, active.id, key); } finally { key.fill(0); }
}

/** Internal issuance material only. Never returns the plaintext QR or encryption key. */
export async function prepareQrEnvelopes(personKeys: string[], source: QrKeySource): Promise<QrEnvelope[]> {
  if (!personKeys.length || personKeys.length > 50 || new Set(personKeys.map(key => key.toLowerCase())).size !== personKeys.length || personKeys.some(key => !uuid.test(key))) throw new Error('INVALID_QR_PEOPLE');
  const active = await source.active();
  if (!validKeyId(active.id) || !Buffer.isBuffer(active.key) || active.key.length !== 32) throw new Error('INVALID_QR_KEY');
  const key = Buffer.from(active.key);
  try {
    return personKeys.map(clientPersonKey => encryptCredential(clientPersonKey, randomUUID(), active.id, key));
  } finally { key.fill(0); }
}

/** For a separately authorized renderer/recovery component, never a public read route.
 * The caller must authorize the visit/pass before it obtains this encrypted record.
 */
export async function recoverQrCredential(envelope: QrEnvelope, source: QrKeySource): Promise<Buffer> {
  if (!uuid.test(envelope.visitRequestId) || !uuid.test(envelope.accessPassId) ||
      typeof envelope.keyVersion !== 'string' || !envelope.keyVersion.startsWith('qr.v1.') || !validKeyId(envelope.keyVersion.slice(6))) throw new Error('INVALID_QR_ENVELOPE');
  const nonce = parseHex(envelope.nonce, 12); const tag = parseHex(envelope.authenticationTag, 16);
  const ciphertext = parseHex(envelope.ciphertext, 32); const expected = parseHex(envelope.credentialHash, 32);
  const resolved = await source.resolve(envelope.keyVersion.slice(6));
  if (!Buffer.isBuffer(resolved) || resolved.length !== 32) throw new Error('INVALID_QR_KEY');
  const key = Buffer.from(resolved); let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(aad(envelope.visitRequestId, envelope.accessPassId, envelope.keyVersion)); decipher.setAuthTag(tag);
    const partial = decipher.update(ciphertext);
    try { plaintext = Buffer.concat([partial, decipher.final()]); }
    finally { partial.fill(0); }
    if (plaintext.length !== 32 || !timingSafeEqual(digest(plaintext), expected)) throw new Error('INVALID_QR_CREDENTIAL');
    return Buffer.from(plaintext);
  } finally { key.fill(0); plaintext?.fill(0); }
}
