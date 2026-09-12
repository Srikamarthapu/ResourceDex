import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { cropPixels } from '@/lib/images/geometry';
import {
  LISTING_BUCKET,
  operationKeySchema,
  ownedScan,
  readJson,
  SCAN_BUCKET,
  ScanError,
  scanErrorResponse,
  scanJson,
  verifiedScanContext,
} from '@/lib/ai/scan-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const coordinate = z.number().int().min(0).max(1000);
const imageSchema = z
  .object({
    operationKey: operationKeySchema,
    crop: z
      .object({
        x_min: coordinate,
        y_min: coordinate,
        x_max: coordinate,
        y_max: coordinate,
      })
      .refine(
        (box) => box.x_min < box.x_max && box.y_min < box.y_max,
        'Choose a crop with a positive area.',
      )
      .optional(),
  })
  .strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await verifiedScanContext(request);
    const scan = await ownedScan((await params).id, context);
    const input = await readJson(request, imageSchema);
    if (!scan.normalized_path || !scan.width || !scan.height)
      throw new ScanError(409, 'Finish preparing the photo first.');
    const operationHash = createHash('sha256')
      .update(
        JSON.stringify({
          imageHash: scan.image_hash,
          crop: input.crop ?? null,
        }),
      )
      .digest('hex');
    const path = `${context.user.id}/${scan.id}/${input.operationKey}-${operationHash}.jpg`;
    const bucket = context.admin.storage.from(LISTING_BUCKET);
    const { data: existing, error: readError } = await context.admin
      .from('image_assets')
      .select('id,width,height,storage_path')
      .eq('owner_id', context.user.id)
      .eq('scan_id', scan.id)
      .like('storage_path', `${context.user.id}/${scan.id}/${input.operationKey}-%`)
      .maybeSingle();
    if (readError) throw new ScanError(503, 'Your listing photo could not be loaded. Try again.');
    let asset = existing;
    if (asset && asset.storage_path !== path)
      throw new ScanError(409, 'This crop changed. Review it again before continuing.');
    if (!asset) {
      const { data: original, error } = await context.admin.storage
        .from(SCAN_BUCKET)
        .download(scan.normalized_path);
      if (error || !original)
        throw new ScanError(503, 'The saved photo could not be opened. Try again.');
      const sourceBytes = Buffer.from(await original.arrayBuffer());
      if (createHash('sha256').update(sourceBytes).digest('hex') !== scan.image_hash)
        throw new ScanError(
          409,
          'The saved photo changed. Upload it again before choosing a listing image.',
        );
      let pipeline = sharp(sourceBytes, {
        limitInputPixels: 40_000_000,
        failOn: 'warning',
      });
      if (input.crop)
        pipeline = pipeline.extract(
          cropPixels(input.crop, { width: scan.width, height: scan.height }),
        );
      const { data: bytes, info } = await pipeline
        .jpeg({ quality: 88 })
        .toBuffer({ resolveWithObject: true });
      const { error: uploadError } = await bucket.upload(path, bytes, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (uploadError && !['409', '400'].includes(String(uploadError.statusCode)))
        throw new ScanError(503, 'The listing photo could not be saved. Try again.');
      if (uploadError) {
        const { data } = await bucket.download(path);
        if (
          !data ||
          createHash('sha256')
            .update(Buffer.from(await data.arrayBuffer()))
            .digest('hex') !== createHash('sha256').update(bytes).digest('hex')
        ) {
          throw new ScanError(503, 'The listing photo could not be verified. Try again.');
        }
      }
      const record = {
        id: randomUUID(),
        owner_id: context.user.id,
        scan_id: scan.id,
        kind: 'listing',
        status: 'ready',
        storage_path: path,
        content_hash: createHash('sha256').update(bytes).digest('hex'),
        mime_type: 'image/jpeg',
        width: info.width,
        height: info.height,
      };
      const { data, error: saveError } = await context.admin
        .from('image_assets')
        .insert(record)
        .select('id,width,height,storage_path')
        .single();
      if (saveError)
        throw new ScanError(503, 'The listing photo could not be registered. Try again.');
      asset = data;
    }
    const { data: preview, error: previewError } = await bucket.createSignedUrl(path, 300);
    if (previewError)
      throw new ScanError(503, 'The listing preview could not be loaded. Try again.');
    return scanJson({
      imageId: asset.id,
      imagePath: path,
      imageUrl: preview.signedUrl,
      width: asset.width,
      height: asset.height,
    });
  } catch (error) {
    return scanErrorResponse(error);
  }
}
