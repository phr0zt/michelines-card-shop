import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type OutputInfo } from 'sharp';
import type { ImageUrls } from '../../shared/types';
import { badRequest } from '../lib/http';

sharp.cache(false);
sharp.concurrency(2);

type Variant = 'full' | 'md' | 'sm';

const VARIANTS: Record<Variant, { edge: number; quality: number; suffix: string }> = {
  full: { edge: 2400, quality: 90, suffix: '' },
  md: { edge: 1000, quality: 82, suffix: '_md' },
  sm: { edge: 360, quality: 78, suffix: '_sm' },
};

export interface StoredImage {
  key: string;
  width: number;
  height: number;
}

const KEY_RE = /^[a-f0-9]{32}$/;

/**
 * Card photos are stored as three JPEG sizes on disk under DATA_DIR/uploads,
 * named by a random key so URLs can't be guessed:
 *   uploads/ab/abcdef….jpg (full, max 2400px), …_md.jpg (1000px), …_sm.jpg (360px)
 */
export class ImageStore {
  constructor(readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  pathFor(key: string, variant: Variant = 'full'): string {
    if (!KEY_RE.test(key)) throw new Error(`Invalid image key: ${key}`);
    return path.join(this.root, key.slice(0, 2), `${key}${VARIANTS[variant].suffix}.jpg`);
  }

  static urlsFor(key: string): ImageUrls {
    const dir = `/media/${key.slice(0, 2)}/${key}`;
    return { full: `${dir}.jpg`, md: `${dir}_md.jpg`, sm: `${dir}_sm.jpg` };
  }

  async save(input: Buffer, rotateDegrees = 0): Promise<StoredImage> {
    let normalized: { data: Buffer; info: OutputInfo };
    try {
      let pipeline = sharp(input, { failOn: 'error', limitInputPixels: 120_000_000 }).rotate();
      if (rotateDegrees) {
        // Bake EXIF orientation first, then apply the requested extra rotation.
        const oriented = await pipeline.toBuffer();
        pipeline = sharp(oriented).rotate(rotateDegrees);
      }
      normalized = await pipeline
        .resize({ width: VARIANTS.full.edge, height: VARIANTS.full.edge, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: VARIANTS.full.quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw badRequest(
        'Could not read that photo. Please upload a JPEG or PNG. (On iPhone: Settings → Camera → Formats → Most Compatible.)',
      );
    }

    const key = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(path.dirname(this.pathFor(key)), { recursive: true });
    await fs.promises.writeFile(this.pathFor(key, 'full'), normalized.data);
    for (const variant of ['md', 'sm'] as const) {
      const v = VARIANTS[variant];
      await sharp(normalized.data)
        .resize({ width: v.edge, height: v.edge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: v.quality, mozjpeg: true })
        .toFile(this.pathFor(key, variant));
    }
    return { key, width: normalized.info.width, height: normalized.info.height };
  }

  /** Rotating creates a new key so browsers don't keep showing a cached, unrotated photo. */
  async rotate(key: string, degrees: 90 | 180 | 270): Promise<StoredImage> {
    const buffer = await fs.promises.readFile(this.pathFor(key, 'full'));
    const stored = await this.save(buffer, degrees);
    this.remove(key);
    return stored;
  }

  remove(key: string): void {
    for (const variant of Object.keys(VARIANTS) as Variant[]) {
      try {
        fs.unlinkSync(this.pathFor(key, variant));
      } catch {
        // already gone
      }
    }
  }

  /** A JPEG sized for the vision model, as base64. */
  async forAi(key: string, maxEdge = 2000): Promise<string> {
    const data = await sharp(this.pathFor(key, 'full'))
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    return data.toString('base64');
  }
}
