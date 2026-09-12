import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ALLOWED_IMAGE_MIMES, MAX_UPLOAD_BYTES } from '@/lib/images/normalize';
import {
  operationKeySchema,
  readJson,
  SCAN_BUCKET,
  ScanError,
  scanErrorResponse,
  scanJson,
  verifiedScanContext,
} from '@/lib/ai/scan-server';

export const runtime = 'nodejs';

const uploadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.enum(ALLOWED_IMAGE_MIMES),
    size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    operationKey: operationKeySchema,
  })
  .strict();

export async function POST(request: Request) {
  try {
    const { user, admin } = await verifiedScanContext(request);
    const input = await readJson(request, uploadSchema);
    const metadata = {
      fileName: input.fileName,
      mimeType: input.mimeType,
      size: input.size,
    };
    const { data: previous, error: readError } = await admin
      .from('scans')
      .select('id,original_path,status,upload_metadata')
      .eq('owner_id', user.id)
      .eq('upload_operation_key', input.operationKey)
      .maybeSingle();
    if (readError) throw new ScanError(503, 'Photo storage could not be reached. Try again.');
    let scan = previous;
    if (scan) {
      // Postgres JSONB may reorder keys; compare values rather than object order.
      const saved = scan.upload_metadata;
      if (
        saved.fileName !== metadata.fileName ||
        saved.mimeType !== metadata.mimeType ||
        saved.size !== metadata.size
      ) {
        throw new ScanError(409, 'This upload key was already used for a different image.');
      }
    }
    if (!scan) {
      const id = randomUUID();
      const extension = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      }[input.mimeType];
      const { data, error } = await admin
        .from('scans')
        .insert({
          id,
          owner_id: user.id,
          status: 'uploading',
          original_path: `${user.id}/${id}/original.${extension}`,
          upload_operation_key: input.operationKey,
          upload_metadata: metadata,
        })
        .select('id,original_path,status,upload_metadata')
        .single();
      if (error)
        throw new ScanError(
          error.code === '23505' ? 409 : 503,
          'The upload could not start. Retry with the same photo.',
        );
      scan = data;
    }
    if (scan.status !== 'uploading')
      return scanJson({ scanId: scan.id, status: scan.status, upload: null });
    const { data, error } = await admin.storage
      .from(SCAN_BUCKET)
      .createSignedUploadUrl(scan.original_path, { upsert: false });
    if (error) throw new ScanError(503, 'The upload destination could not be prepared. Try again.');
    return scanJson({
      scanId: scan.id,
      status: scan.status,
      upload: {
        bucket: SCAN_BUCKET,
        path: data.path,
        token: data.token,
        signedUrl: data.signedUrl,
      },
    });
  } catch (error) {
    return scanErrorResponse(error);
  }
}
