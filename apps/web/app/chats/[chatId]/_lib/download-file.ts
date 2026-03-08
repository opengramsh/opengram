type DownloadFileOptions = {
  beforeOpen?: () => void;
  forceNewContext?: boolean;
};

function clickDownloadLink(href: string, filename: string, newContext: boolean) {
  const link = document.createElement('a');
  link.href = href;
  link.style.display = 'none';

  if (newContext) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  } else {
    link.download = filename;
  }

  const parent = document.body ?? document.documentElement;
  parent.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
  }, 0);
}

export async function downloadFile(url: string, filename: string, options: DownloadFileOptions = {}): Promise<void> {
  options.beforeOpen?.();

  // Optional escape hatch for explicit direct-open behavior.
  if (options.forceNewContext) {
    clickDownloadLink(url, filename, true);
    return;
  }

  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Failed to download file: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    clickDownloadLink(blobUrl, filename, false);
    window.setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 60_000);
  } catch {
    // Fallback to direct navigation if blob download fails for any reason.
    clickDownloadLink(url, filename, false);
  }
}
