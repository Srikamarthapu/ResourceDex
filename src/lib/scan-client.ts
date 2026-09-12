import { createClientId } from './client-id';
import { createBrowserSupabaseClient } from './supabase/browser';
import type { DetectionCandidate, Bounds } from './ai/detection';

export interface ScanPreview {
  scanId: string;
  status: string;
  imageUrl: string;
  imageHash: string;
  width: number;
  height: number;
  analysisVersion: number;
  reviewVersion: number;
  candidates: DetectionCandidate[];
  limitReached: boolean;
  error?: string;
}

async function scanRequest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || 'This step could not finish. Please try again.');
  return result as T;
}
export async function uploadPhoto(
  file: File,
  operationKey: string,
  onStage: (stage: string) => void,
) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPEG, PNG, or WebP photo. Convert HEIC images before uploading.');
  if (file.size > 10 * 1024 * 1024)
    throw new Error('This photo is too large. Choose an image smaller than 10 MB.');
  onStage('Uploading photo');
  const result = await scanRequest<{
    scanId: string;
    upload: { bucket: string; path: string; token: string } | null;
  }>('/api/scans', { fileName: file.name, mimeType: file.type, size: file.size, operationKey });
  if (result.upload) {
    const { error } = await createBrowserSupabaseClient()
      .storage.from(result.upload.bucket)
      .uploadToSignedUrl(result.upload.path, result.upload.token, file);
    if (error && !/already exists|duplicate/i.test(error.message))
      throw new Error('The photo upload did not finish. Keep this photo selected and try again.');
  }
  onStage('Preparing private photo');
  return scanRequest<ScanPreview>(`/api/scans/${result.scanId}/prepare`, {});
}
export const getScan = (id: string) => scanRequest<ScanPreview>(`/api/scans/${id}`);
export const saveScanReview = (
  scan: { scanId: string; analysisVersion: number; reviewVersion: number },
  candidates: (DetectionCandidate & { selected: boolean })[],
) =>
  scanRequest<{ reviewVersion: number }>(`/api/scans/${scan.scanId}/review`, {
    analysisVersion: scan.analysisVersion,
    expectedReviewVersion: scan.reviewVersion,
    candidates: candidates.map((candidate) => ({
      candidateId: candidate.candidate_id,
      label: candidate.label,
      category: candidate.category,
      selected: candidate.selected,
    })),
  });
export const analyzeScan = (scan: ScanPreview, operationKey: string) =>
  scanRequest<ScanPreview>(`/api/scans/${scan.scanId}/analyze`, {
    imageHash: scan.imageHash,
    operationKey,
    consent: true,
  });
export const createListingImage = (scanId: string, crop?: Bounds) =>
  scanRequest<{ imagePath: string; imageUrl: string }>(`/api/scans/${scanId}/image`, {
    operationKey: createClientId(),
    ...(crop ? { crop } : {}),
  });
