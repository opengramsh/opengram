import mime from "mime-types";

export async function downloadMedia(url: string): Promise<{
  buffer: Buffer;
  filename: string;
  contentType: string;
}> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download media from ${url}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const urlPath = new URL(url).pathname;
  const existingName = urlPath.split("/").pop();
  const filename =
    existingName && existingName.length > 0
      ? existingName
      : `file.${mime.extension(contentType) || "bin"}`;

  return { buffer, filename, contentType };
}
