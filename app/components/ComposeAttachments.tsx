import { Banner, Button } from "@cloudflare/kumo";
import { PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { formatBytes } from "~/lib/utils";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES } from "~/lib/attachments";

interface ComposeAttachmentsProps {
  files: File[];
  error: string | null;
  disabled?: boolean;
  onAdd: (files: FileList) => void;
  onRemove: (index: number) => void;
}

export default function ComposeAttachments({
  files,
  error,
  disabled,
  onAdd,
  onRemove,
}: ComposeAttachmentsProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-sm text-kumo-link hover:text-kumo-link-hover cursor-pointer">
          <PaperclipIcon size={16} />
          Attach files
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              if (event.target.files) onAdd(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <span className="text-xs text-kumo-subtle">
          Up to {formatBytes(MAX_ATTACHMENT_BYTES)} each, {formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)}{" "}
          total
        </span>
      </div>
      {error && <Banner variant="error" text={error} />}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-2 rounded-md border border-kumo-line px-2 py-1 text-sm"
            >
              <span className="truncate max-w-[160px]">{file.name}</span>
              <span className="text-kumo-subtle">{formatBytes(file.size)}</span>
              <Button
                type="button"
                variant="ghost"
                shape="square"
                size="sm"
                icon={<XIcon size={14} />}
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => onRemove(index)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
