export const TEXT_PREVIEW_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export function isPreviewable(contentType: string, byteSize: number): boolean {
  const ct = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (ct === 'application/pdf') return true; // PDFs always previewable (no size limit)
  if (byteSize > TEXT_PREVIEW_MAX_BYTES) return false;
  if (ct === 'application/json') return true;
  if (ct.startsWith('text/')) return true;
  return false;
}

export type PreviewKind = 'pdf' | 'markdown' | 'text';

export function getPreviewKind(contentType: string, filename: string): PreviewKind {
  const ct = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (ct === 'application/pdf') return 'pdf';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ct === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown';
  return 'text';
}
