import { Button, Dialog, Loader } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { downloadFile } from "~/lib/utils";
import { previewKind, type PreviewKind, type PreviewTarget } from "~/lib/attachments";

interface AttachmentPreviewDialogProps {
  target: PreviewTarget | null;
  onClose: () => void;
}

interface LoadedPreview {
  kind: PreviewKind;
  objectUrl: string;
  text?: string;
}

const TEXT_PREVIEW_LIMIT = 256 * 1024;

export default function AttachmentPreviewDialog({ target, onClose }: AttachmentPreviewDialogProps) {
  const [loaded, setLoaded] = useState<LoadedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!target) {
      setLoaded(null);
      setError(null);
      return;
    }

    const kind = previewKind(target.mimetype, target.filename);
    const controller = new AbortController();
    let objectUrl = "";
    setIsLoading(true);
    setError(null);
    setLoaded(null);

    void (async () => {
      try {
        const response = await fetch(`${target.url}?inline=1`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not load attachment");
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        if (kind === "text") {
          const slice = blob.slice(0, TEXT_PREVIEW_LIMIT);
          const text = await slice.text();
          setLoaded({ kind, objectUrl, text });
        } else {
          setLoaded({ kind, objectUrl });
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Preview failed");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target]);

  return (
    <Dialog.Root
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog size="lg">
        <Dialog.Title>{target?.filename}</Dialog.Title>
        <div className="mt-4 min-h-[200px] rounded-lg bg-kumo-tint/30 p-4">
          {isLoading && (
            <div className="flex justify-center py-16">
              <Loader size="lg" />
            </div>
          )}
          {error && <p className="text-sm text-kumo-subtle">{error}</p>}
          {loaded && <AttachmentPreviewBody preview={loaded} filename={target?.filename} />}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (target) downloadFile(target.url, target.filename);
            }}
          >
            Download
          </Button>
          <Dialog.Close>
            <Button variant="primary" size="sm">
              Close
            </Button>
          </Dialog.Close>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}

function AttachmentPreviewBody({
  preview,
  filename,
}: {
  preview: LoadedPreview;
  filename?: string;
}) {
  switch (preview.kind) {
    case "image":
      return (
        <img
          src={preview.objectUrl}
          alt={filename}
          className="mx-auto max-h-[70vh] max-w-full rounded object-contain"
        />
      );
    case "pdf":
      return (
        <iframe
          title={filename}
          src={preview.objectUrl}
          className="h-[70vh] w-full rounded bg-white"
        />
      );
    case "text":
      return (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-all text-sm">
          {preview.text}
        </pre>
      );
    case "audio":
      return (
        <audio controls src={preview.objectUrl} className="w-full">
          Your browser cannot play this audio.
        </audio>
      );
    case "video":
      return (
        <video controls src={preview.objectUrl} className="mx-auto max-h-[70vh] max-w-full rounded">
          Your browser cannot play this video.
        </video>
      );
    case "none":
      return (
        <p className="text-sm text-kumo-subtle">
          No in-app preview for this file type. Download it instead.
        </p>
      );
    default: {
      const _exhaustive: never = preview.kind;
      return _exhaustive;
    }
  }
}
