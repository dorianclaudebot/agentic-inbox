// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import {
  ArchiveIcon,
  ArrowBendUpLeftIcon,
  EnvelopeOpenIcon,
  EnvelopeSimpleIcon,
  StarIcon,
  TrashIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { type MouseEvent } from "react";
import { Folders } from "shared/folders";
import { formatListDate } from "shared/dates";
import { useSwipeRow } from "~/hooks/useSwipeRow";
import { getSnippetText } from "~/lib/utils";
import type { Email } from "~/types";

interface EmailListRowProps {
  email: Email;
  folder: string;
  isSelected: boolean;
  isPanelOpen: boolean;
  onOpen: () => void;
  onToggleStar: (event: MouseEvent) => void;
  onToggleRead: (event: MouseEvent) => void;
  onDelete: (event: MouseEvent) => void;
  onSwipeArchive: () => void;
  onSwipeRead: () => void;
}

export function hasUnread(email: Email): boolean {
  if (email.thread_unread_count !== undefined) {
    return email.thread_unread_count > 0;
  }
  return !email.read;
}

function formatParticipants(email: Email): string {
  if (email.participants) {
    const names = email.participants
      .split(",")
      .map((part) => part.trim().split("@")[0])
      .filter((name, idx, arr) => arr.indexOf(name) === idx);
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }
  return email.sender.split("@")[0];
}

function canSwipeArchive(folder: string): boolean {
  return folder !== Folders.DRAFT && folder !== Folders.TRASH;
}

export default function EmailListRow({
  email,
  folder,
  isSelected,
  isPanelOpen,
  onOpen,
  onToggleStar,
  onToggleRead,
  onDelete,
  onSwipeArchive,
  onSwipeRead,
}: EmailListRowProps) {
  const unread = hasUnread(email);
  const archiveEnabled = canSwipeArchive(folder);
  const isArchiveFolder = folder === Folders.ARCHIVE;
  const { offset, isDragging, consumeClick, handlers } = useSwipeRow({
    enabledLeft: archiveEnabled,
    enabledRight: true,
    onSwipeLeft: onSwipeArchive,
    onSwipeRight: onSwipeRead,
  });

  const snippet = getSnippetText(email.snippet);
  const showReadReveal = offset > 0;
  const showArchiveReveal = offset < 0 && archiveEnabled;

  return (
    <div className="relative overflow-hidden border-b border-kumo-line">
      {showReadReveal && (
        <div className="absolute inset-0 flex items-center justify-start bg-kumo-brand px-5 text-kumo-inverse">
          {unread ? (
            <EnvelopeOpenIcon size={20} weight="bold" />
          ) : (
            <EnvelopeSimpleIcon size={20} weight="bold" />
          )}
          <span className="ml-2 text-sm font-medium">{unread ? "Read" : "Unread"}</span>
        </div>
      )}
      {showArchiveReveal && (
        <div className="absolute inset-0 flex items-center justify-end bg-kumo-success px-5 text-kumo-inverse">
          <span className="mr-2 text-sm font-medium">{isArchiveFolder ? "Inbox" : "Archive"}</span>
          {isArchiveFolder ? (
            <TrayIcon size={20} weight="bold" />
          ) : (
            <ArchiveIcon size={20} weight="bold" />
          )}
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        {...handlers}
        onClick={() => {
          if (consumeClick()) return;
          onOpen();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        className={`group relative flex items-center gap-3 w-full text-left cursor-pointer touch-pan-y px-4 py-2.5 md:px-6 md:py-3 ${
          isPanelOpen ? "md:px-4 md:py-2.5" : ""
        } ${isSelected ? "bg-kumo-tint" : "bg-kumo-base hover:bg-kumo-tint"}`}
        style={{
          transform: `translate3d(${offset}px, 0, 0)`,
          transition: isDragging ? "none" : "transform 160ms ease-out",
        }}
      >
        <div className="w-2.5 shrink-0 flex justify-center">
          {unread && <div className="h-2 w-2 rounded-full bg-kumo-brand" />}
        </div>

        <button
          type="button"
          className="shrink-0 p-0.5 bg-transparent border-0 cursor-pointer"
          onClick={(event) => {
            event.stopPropagation();
            onToggleStar(event);
          }}
        >
          <StarIcon
            size={16}
            weight={email.starred ? "fill" : "regular"}
            className={
              email.starred ? "text-kumo-warning" : "text-kumo-subtle hover:text-kumo-warning"
            }
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`truncate text-sm ${unread ? "font-semibold text-kumo-default" : "text-kumo-strong"}`}
            >
              {formatParticipants(email)}
            </span>
            {(email.thread_count ?? 1) > 1 && (
              <span className="shrink-0 text-xs text-kumo-subtle bg-kumo-fill rounded-full px-1.5 py-0.5 font-medium">
                {email.thread_count}
              </span>
            )}
            {email.has_draft && (
              <span className="shrink-0 text-xs text-kumo-destructive font-medium">Draft</span>
            )}
            {email.needs_reply && !email.has_draft && (
              <Tooltip content="Needs reply" asChild>
                <span className="shrink-0 text-kumo-warning">
                  <ArrowBendUpLeftIcon size={14} weight="bold" />
                </span>
              </Tooltip>
            )}
            <span className="text-sm text-kumo-subtle shrink-0 ml-auto">
              {formatListDate(email.date)}
            </span>
          </div>
          <div className="truncate text-sm mt-0.5">
            {(email.labels ?? []).slice(0, 3).map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 mr-1.5 align-middle text-xs text-kumo-subtle"
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </span>
            ))}
            <span className={unread ? "font-medium text-kumo-default" : "text-kumo-subtle"}>
              {email.subject}
            </span>
            {snippet && <span className="text-kumo-subtle font-normal"> &mdash; {snippet}</span>}
          </div>
        </div>

        <div className="hidden group-hover:flex items-center shrink-0">
          <Tooltip content={email.read ? "Mark unread" : "Mark read"} asChild>
            <Button
              variant="ghost"
              shape="square"
              size="sm"
              icon={email.read ? <EnvelopeSimpleIcon size={14} /> : <EnvelopeOpenIcon size={14} />}
              onClick={onToggleRead}
              aria-label={email.read ? "Mark unread" : "Mark read"}
            />
          </Tooltip>
          <Tooltip content="Delete" asChild>
            <Button
              variant="ghost"
              shape="square"
              size="sm"
              icon={<TrashIcon size={14} />}
              onClick={onDelete}
              aria-label="Delete"
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
