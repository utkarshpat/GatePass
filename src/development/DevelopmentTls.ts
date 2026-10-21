import { readFile } from 'node:fs/promises';
import { createSecureContext } from 'node:tls';
import type { SecureContextOptions } from 'node:tls';

/** Load an existing organization-approved certificate. Never install a CA or disable verification. */
export async function configuredDevelopmentTls(env: Record<string, string | undefined> = process.env): Promise<SecureContextOptions | null> {
  const cert = env.GATEPASS_DEV_TLS_CERT_FILE; const key = env.GATEPASS_DEV_TLS_KEY_FILE;
  const pfx = env.GATEPASS_DEV_TLS_PFX_FILE; const password = env.GATEPASS_DEV_TLS_PASSWORD_FILE;
  if (!cert && !key && !pfx && !password) return null;
  if ((cert || key) && (pfx || password) || (cert && !key || key && !cert) || password && !pfx) throw new Error('INVALID_DEVELOPMENT_TLS_CONFIGURATION');
  try {
    let options: SecureContextOptions;
    if (pfx) {
      options = { pfx: await readFile(pfx), ...(password ? { passphrase: (await readFile(password, 'utf8')).replace(/\r?\n$/u, '') } : {}) };
    } else {
      const [certificate, privateKey] = await Promise.all([readFile(cert!), readFile(key!)]);
      options = { cert: certificate, key: privateKey };
    }
    createSecureContext({ ...options, minVersion: 'TLSv1.2' }); // Validate key/certificate loading before opening a listener.
    return options;
  } catch { throw new Error('DEVELOPMENT_TLS_FILES_UNAVAILABLE_OR_INVALID'); }
}
