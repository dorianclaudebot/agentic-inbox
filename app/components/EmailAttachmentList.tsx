// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { PaperclipIcon, FileIcon, ImageIcon } from "@phosphor-icons/react";
import { canPreviewAttachment, type PreviewTarget } from "~/lib/attachments";
import { formatBytes, getAttachmentUrl, getNonInlineAttachments } from "~/lib/utils";
import type { Attachment } from "~/types";

interface EmailAttachmentListProps {
  mailboxId?: string;
  emailId: string;
  attachments?: Attachment[];
  onPreview?: (target: PreviewTarget) => void;
  className?: string;
  showHeading?: boolean;
}

export default function EmailAttachmentList({
  mailboxId,
  emailId,
  attachments,
  onPreview,
  className,
  showHeading = false,
}: EmailAttachmentListProps) {
  if (!mailboxId) return null;

  const files = getNonInlineAttachments(attachments);
  if (files.length === 0) return null;

  return (
    <div className={className}>
      {showHeading && (
        <div className="flex items-center gap-2 mb-2">
          <PaperclipIcon size={14} className="text-kumo-subtle" />
          <span className="text-sm font-medium text-kumo-default">
            {files.length} attachment{files.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {files.map((attachment) => {
          const url = getAttachmentUrl(mailboxId, emailId, attachment.id);
          const previewable = canPreviewAttachment(attachment.mimetype, attachment.filename);

          if (previewable && onPreview) {
            return (
              <button
                key={attachment.id}
                type="button"
                onClick={() =>
                  onPreview({
                    url,
                    filename: attachment.filename,
                    mimetype: attachment.mimetype,
                  })
                }
                className="flex items-center gap-2 rounded-md border border-kumo-line px-3 py-2 transition-colors hover:bg-kumo-tint text-sm text-left"
              >
                <ImageIcon size={16} className="text-kumo-subtle shrink-0" />
                <span className="text-kumo-default font-medium truncate max-w-[140px]">
                  {attachment.filename}
                </span>
                <span className="text-kumo-subtle">{formatBytes(attachment.size)}</span>
              </button>
            );
          }

          return (
            <a
              key={attachment.id}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md border border-kumo-line px-3 py-2 no-underline transition-colors hover:bg-kumo-tint text-sm"
            >
              <FileIcon size={16} className="text-kumo-subtle shrink-0" />
              <span className="text-kumo-default font-medium truncate max-w-[140px]">
                {attachment.filename}
              </span>
              <span className="text-kumo-subtle">{formatBytes(attachment.size)}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
