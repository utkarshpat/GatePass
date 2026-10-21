import QRCode from 'qrcode';
import type { QrMatrixEncoder } from './PassCardRenderer.ts';
/** Fixed byte-mode version avoids overlaying a future version's function patterns. */
export class NodeQrMatrixEncoder implements QrMatrixEncoder {
  readonly errorCorrectionLevel = 'H' as const;
  async encode(credential: string): Promise<boolean[][]> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(credential)) throw new Error('INVALID_QR_PAYLOAD');
    const qr = QRCode.create([{ data: Buffer.from(credential, 'ascii'), mode: 'byte' }], { version: 5, errorCorrectionLevel: 'H' });
    if (qr.modules.size !== 37) throw new Error('INVALID_QR_VERSION');
    return Array.from({ length: 37 }, (_, row) => Array.from({ length: 37 }, (_, column) => Boolean(qr.modules.get(row, column))));
  }
}
