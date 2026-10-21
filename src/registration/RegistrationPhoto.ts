export type NormalizedPhoto = { bytes: Buffer; mimeType: 'image/jpeg'; width: number; height: number };
export interface PhotoNormalizer { normalize(input: Buffer): Promise<NormalizedPhoto> }
export interface PrivatePhotoStore { putIfAbsent(key: string, bytes: Buffer): Promise<void> }
export type SharpFactory = (input: Buffer, options: Record<string, unknown>) => {
  metadata(): Promise<{ format?: string; width?: number; height?: number; pages?: number }>;
  rotate(): any;
};

/** Inject the approved sharp package at server composition, never a request parameter.
 * Production private storage and native-library/runtime provisioning remain separate.
 */
export class SharpPhotoNormalizer implements PhotoNormalizer {
  #sharp: SharpFactory;
  #active = 0;
  constructor(sharp: SharpFactory) { this.#sharp = sharp; }
  async normalize(input: Buffer): Promise<NormalizedPhoto> {
    if (!Buffer.isBuffer(input) || input.length === 0 || input.length > 5242880) throw new Error('INVALID_PHOTO');
    const jpeg = input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
    const png = input.length >= 8 && input.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const webp = input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP';
    if (!jpeg && !png && !webp) throw new Error('INVALID_PHOTO');
    if (this.#active >= 2) throw new Error('PHOTO_BUSY');
    this.#active++;
    try {
      const options = { limitInputPixels: 16000000, failOn: 'error' };
      const metadata = await this.#sharp(input, options).metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1 ||
          !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || metadata.width * metadata.height > 16000000) throw new Error('INVALID_PHOTO');
      // Decode/re-encode; metadata is stripped by default, orientation is applied first.
      const output = await this.#sharp(input, options).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
      if (!Buffer.isBuffer(output.data) || output.data.length === 0 || output.data.length > 5242880 || output.info.format !== 'jpeg' ||
          !Number.isInteger(output.info.width) || !Number.isInteger(output.info.height) || output.info.width < 1 || output.info.height < 1 ||
          output.info.width > 1280 || output.info.height > 1280) throw new Error('INVALID_PHOTO');
      return { bytes: output.data, mimeType: 'image/jpeg', width: output.info.width, height: output.info.height };
    } finally { this.#active--; }
  }
}
