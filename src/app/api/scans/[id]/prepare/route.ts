import { createHash } from 'node:crypto';
import { normalizeImage, ImageValidationError, MAX_UPLOAD_BYTES } from '@/lib/images/normalize';
import {
  ownedScan,
  SCAN_BUCKET,
  ScanError,
  safeScanResponse,
  scanErrorResponse,
  scanJson,
  verifiedScanContext,
} from '@/lib/ai/scan-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await verifiedScanContext(request);
    const scan = await ownedScan((await params).id, context);
    if (scan.normalized_path) return scanJson(await safeScanResponse(scan, context.admin));
    if (scan.status !== 'uploading')
      throw new ScanError(409, 'Choose another photo to retry this upload.');
    const storage = context.admin.storage.from(SCAN_BUCKET);
    const { data: file, error: downloadError } = await storage.download(scan.original_path);
    if (downloadError || !file)
      throw new ScanError(409, 'Finish uploading the photo, then try again.', 'upload_incomplete');
    let image;
    try {
      if (file.size > MAX_UPLOAD_BYTES) throw new ImageValidationError();
      image = await normalizeImage(Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof ImageValidationError) {
        await storage.remove([scan.original_path]);
        await context.admin
          .from('scans')
          .update({ status: 'failed', analysis_error: error.message })
          .eq('id', scan.id)
          .eq('status', 'uploading');
      }
      throw error;
    }
    const path = `${context.user.id}/${scan.id}/${image.hash}.jpg`;
    const { error: uploadError } = await storage.upload(path, image.bytes, {
      contentType: image.mimeType,
      upsert: false,
    });
    if (uploadError && !['409', '400'].includes(String(uploadError.statusCode)))
      throw new ScanError(503, 'The processed photo could not be saved. Try again.');
    // An interrupted retry can encounter the immutable working image already stored.
    if (uploadError) {
      const { data } = await storage.download(path);
      if (
        !data ||
        createHash('sha256')
          .update(Buffer.from(await data.arrayBuffer()))
          .digest('hex') !== image.hash
      ) {
        throw new ScanError(
          503,
          'The processed photo could not be verified. Choose another photo and try again.',
        );
      }
    }
    const { error: saveError } = await context.admin
      .from('scans')
      .update({
        status: 'ready',
        normalized_path: path,
        image_hash: image.hash,
        width: image.width,
        height: image.height,
        analysis_error: null,
      })
      .eq('id', scan.id)
      .eq('owner_id', context.user.id)
      .eq('status', 'uploading');
    if (saveError)
      throw new ScanError(503, 'The photo was processed but could not be saved. Try again.');
    // Keep only the normalized, metadata-free image; previews never expose the raw upload.
    await storage.remove([scan.original_path]);
    return scanJson(await safeScanResponse(await ownedScan(scan.id, context), context.admin));
  } catch (error) {
    return scanErrorResponse(error);
  }
}
