export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;

export type PreviewKind = "image" | "pdf" | "text" | "audio" | "video" | "none";

const TEXT_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/sql",
  "application/x-yaml",
  "application/yaml",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/html",
  "text/css",
  "text/xml",
]);

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "xml",
  "yml",
  "yaml",
  "log",
  "ics",
  "vcf",
]);

export interface PreviewTarget {
  url: string;
  filename: string;
  mimetype: string;
}

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "";
  return filename.slice(dot + 1).toLowerCase();
}

export function previewKind(mimetype: string, filename: string): PreviewKind {
  const type = mimetype.toLowerCase();
  // SVG can execute script if the browser navigates to it. Skip in-app image preview.
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (type === "application/pdf" || fileExtension(filename) === "pdf") return "pdf";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("text/") || TEXT_TYPES.has(type)) return "text";
  if (TEXT_EXTENSIONS.has(fileExtension(filename))) return "text";
  return "none";
}

export function validateComposeFiles(
  existing: File[],
  incoming: File[],
): { files: File[]; error: string | null } {
  const next = [...existing, ...incoming];
  for (const file of next) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return {
        files: existing,
        error: `${file.name} is larger than 8 MB.`,
      };
    }
  }
  const total = next.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
    return {
      files: existing,
      error: "Total attachment size is larger than 20 MB.",
    };
  }
  return { files: next, error: null };
}

export function canPreviewAttachment(mimetype: string, filename: string): boolean {
  return previewKind(mimetype, filename) !== "none";
}

export async function fileToBase64Payload(file: File): Promise<{
  content: string;
  filename: string;
  type: string;
  disposition: "attachment";
}> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return {
    content: btoa(binary),
    filename: file.name || "untitled",
    type: file.type || "application/octet-stream",
    disposition: "attachment",
  };
}
