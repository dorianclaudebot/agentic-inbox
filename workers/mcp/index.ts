// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  toolListMailboxes,
  toolListEmails,
  toolGetEmail,
  toolGetThread,
  toolSearchEmails,
  toolDraftReply,
  toolDraftEmail,
  toolUpdateDraft,
  toolDeleteEmail,
  toolSendReply,
  toolSendEmail,
  toolMarkEmailRead,
  toolMoveEmail,
  toolListFolders,
  toolCreateFolder,
  toolRenameFolder,
  toolDeleteFolder,
  toolListLabels,
  toolCreateLabel,
  toolUpdateLabel,
  toolDeleteLabel,
  toolApplyLabel,
  toolRemoveLabel,
  toolListEmailsByLabel,
} from "../lib/tools";
import {
  Folders,
  FOLDER_TOOL_DESCRIPTION,
  MOVE_FOLDER_TOOL_DESCRIPTION,
} from "../../shared/folders";
import type { Env } from "../types";

/** Wrap a plain result object into MCP content format. */
function mcpText(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

/** Wrap an error string into MCP error format. */
function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

/**
 * Wrap a result that may contain an `error` field into MCP format,
 * automatically setting isError when appropriate.
 */
function mcpResult(result: unknown) {
  if (typeof result === "object" && result !== null && "error" in result) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: true as const,
    };
  }
  return mcpText(result);
}

/**
 * EmailMCP — exposes email tools over the Model Context Protocol.
 *
 * Clients (ProtoAgent, Claude Code, Cursor, etc.) connect to the
 * `/mcp` endpoint and can list mailboxes, read/search emails,
 * draft replies, send messages, and manage folders and labels.
 * Prefers the 2026-07-28 stateless MCP handshake; sessionful clients still work.
 */
export class EmailMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "agentic-inbox",
    version: "1.1.0",
  });

  async init() {
    const env = this.env;

    /**
     * Verify a mailbox exists in R2 before operating on it.
     * Returns an MCP error response if the mailbox is not found, or null if valid.
     */
    const verifyMailbox = async (mailboxId: string) => {
      const obj = await env.BUCKET.head(`mailboxes/${mailboxId}.json`);
      if (!obj) {
        return mcpError(
          `Mailbox "${mailboxId}" not found. Use list_mailboxes to see available mailboxes.`,
        );
      }
      return null;
    };

    // ── list_mailboxes ─────────────────────────────────────────
    this.server.tool("list_mailboxes", "List all available mailboxes", {}, async () => {
      const result = await toolListMailboxes(env);
      return mcpText(result);
    });

    // ── list_emails ────────────────────────────────────────────
    this.server.tool(
      "list_emails",
      "List emails in a mailbox folder. Returns email metadata (id, subject, sender, recipient, date, read/starred status, thread_id).",
      {
        mailboxId: z.string().describe("The mailbox email address (e.g. user@example.com)"),
        folder: z.string().default(Folders.INBOX).describe(FOLDER_TOOL_DESCRIPTION),
        limit: z.number().default(20).describe("Maximum number of emails to return"),
        page: z.number().default(1).describe("Page number for pagination"),
      },
      async ({ mailboxId, folder, limit, page }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolListEmails(env, mailboxId, { folder, limit, page });
        return mcpText(result);
      },
    );

    // ── get_email ──────────────────────────────────────────────
    this.server.tool(
      "get_email",
      "Get a single email with its full body content. Use this to read the actual content of an email.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        emailId: z.string().describe("The email ID to retrieve"),
      },
      async ({ mailboxId, emailId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolGetEmail(env, mailboxId, emailId);
        if ("error" in result) {
          return {
            content: [{ type: "text" as const, text: "Email not found" }],
            isError: true,
          };
        }
        return mcpText(result);
      },
    );

    // ── get_thread ─────────────────────────────────────────────
    this.server.tool(
      "get_thread",
      "Get all emails in a conversation thread. Returns all messages sorted chronologically.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        threadId: z.string().describe("The thread_id to retrieve all messages for"),
      },
      async ({ mailboxId, threadId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolGetThread(env, mailboxId, threadId);
        return mcpText(result);
      },
    );

    // ── search_emails ──────────────────────────────────────────
    this.server.tool(
      "search_emails",
      "Search for emails matching a query across subject and body fields.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        query: z.string().describe("Search query to match against subject and body"),
        folder: z.string().optional().describe("Optional folder to restrict search to"),
      },
      async ({ mailboxId, query, folder }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolSearchEmails(env, mailboxId, { query, folder });
        return mcpText(result);
      },
    );

    // ── draft_reply ────────────────────────────────────────────
    this.server.tool(
      "draft_reply",
      "Draft a reply to an email and save it to the Drafts folder. Does NOT send — saves a draft for review.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        originalEmailId: z.string().describe("The ID of the email being replied to"),
        to: z.string().email().describe("Recipient email address"),
        subject: z.string().describe("Subject line (usually 'Re: ...')"),
        bodyHtml: z.string().describe("The HTML body of the reply"),
      },
      async ({ mailboxId, originalEmailId, to, subject, bodyHtml }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolDraftReply(env, mailboxId, {
          originalEmailId,
          to,
          subject,
          body: bodyHtml,
          isPlainText: false,
          runVerifyDraft: true,
        });
        return mcpResult(result);
      },
    );

    // ── create_draft ───────────────────────────────────────────
    this.server.tool(
      "create_draft",
      "Create a new draft email. Can be a new email or a reply draft.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        to: z.string().optional().describe("Recipient email address (optional for early drafts)"),
        subject: z.string().describe("Subject line"),
        bodyHtml: z.string().describe("The HTML body of the draft"),
        in_reply_to: z
          .string()
          .optional()
          .describe("The ID of the email this draft is replying to (optional)"),
        thread_id: z.string().optional().describe("Thread ID to attach this draft to (optional)"),
      },
      async ({ mailboxId, to, subject, bodyHtml, in_reply_to, thread_id }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolDraftEmail(env, mailboxId, {
          to: to || "",
          subject,
          body: bodyHtml,
          isPlainText: false,
          runVerifyDraft: true,
          in_reply_to,
          thread_id,
        });
        if ("error" in result) {
          return mcpResult(result);
        }
        // Map the response to match the original create_draft output shape
        return mcpText({
          status: "draft_created",
          draftId: result.draftId,
          threadId: result.threadId,
          message: "Draft created in Drafts folder.",
        });
      },
    );

    // ── update_draft ───────────────────────────────────────────
    this.server.tool(
      "update_draft",
      "Update an existing draft email's content.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        draftId: z.string().describe("The ID of the draft to update"),
        to: z.string().optional().describe("Updated recipient email address"),
        subject: z.string().optional().describe("Updated subject line"),
        bodyHtml: z.string().optional().describe("Updated HTML body"),
      },
      async ({ mailboxId, draftId, to, subject, bodyHtml }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolUpdateDraft(env, mailboxId, {
          draftId,
          to,
          subject,
          bodyHtml,
        });
        if ("error" in result) {
          if (result.error === "Draft not found") {
            return {
              content: [{ type: "text" as const, text: "Draft not found" }],
              isError: true,
            };
          }
          return mcpResult(result);
        }
        return mcpText(result);
      },
    );

    // ── delete_email ───────────────────────────────────────────
    this.server.tool(
      "delete_email",
      "Permanently delete an email by ID.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        emailId: z.string().describe("The email ID to delete"),
      },
      async ({ mailboxId, emailId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolDeleteEmail(env, mailboxId, emailId);
        return mcpResult(result);
      },
    );

    // ── send_reply ─────────────────────────────────────────────
    this.server.tool(
      "send_reply",
      "Send a reply to an email. Only call after drafting and getting confirmation.",
      {
        mailboxId: z.string().describe("The mailbox email address to send from"),
        originalEmailId: z.string().describe("The ID of the email being replied to"),
        to: z.string().email().describe("Recipient email address"),
        subject: z.string().describe("Subject line"),
        bodyHtml: z.string().describe("The HTML body of the reply"),
      },
      async ({ mailboxId, originalEmailId, to, subject, bodyHtml }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolSendReply(env, mailboxId, {
          originalEmailId,
          to,
          subject,
          bodyHtml,
        });
        if ("error" in result) {
          // Preserve the original MCP error format for send failures
          if (typeof result.error === "string" && result.error.startsWith("Failed to send")) {
            return {
              content: [{ type: "text" as const, text: result.error }],
              isError: true,
            };
          }
          if (result.error === "Original email not found") {
            return {
              content: [{ type: "text" as const, text: "Original email not found" }],
              isError: true,
            };
          }
          return mcpResult(result);
        }
        return mcpText(result);
      },
    );

    // ── send_email ─────────────────────────────────────────────
    this.server.tool(
      "send_email",
      "Send a new email (not a reply). Only call after getting confirmation.",
      {
        mailboxId: z.string().describe("The mailbox email address to send from"),
        to: z.string().email().describe("Recipient email address"),
        subject: z.string().describe("Subject line"),
        bodyHtml: z.string().describe("The HTML body of the email"),
      },
      async ({ mailboxId, to, subject, bodyHtml }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolSendEmail(env, mailboxId, {
          to,
          subject,
          bodyHtml,
        });
        if ("error" in result) {
          if (typeof result.error === "string" && result.error.startsWith("Failed to send")) {
            return {
              content: [{ type: "text" as const, text: result.error }],
              isError: true,
            };
          }
          return mcpResult(result);
        }
        return mcpText(result);
      },
    );

    // ── mark_email_read ────────────────────────────────────────
    this.server.tool(
      "mark_email_read",
      "Mark an email as read or unread.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        emailId: z.string().describe("The email ID"),
        read: z.boolean().describe("true to mark as read, false for unread"),
      },
      async ({ mailboxId, emailId, read }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolMarkEmailRead(env, mailboxId, emailId, read);
        return mcpText(result);
      },
    );

    // ── move_email ─────────────────────────────────────────────
    this.server.tool(
      "list_folders",
      "List folders in a mailbox, including system folders and custom folders.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
      },
      async ({ mailboxId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpText(await toolListFolders(env, mailboxId));
      },
    );

    this.server.tool(
      "create_folder",
      "Create a custom folder in a mailbox.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        name: z.string().describe("Display name for the new folder"),
      },
      async ({ mailboxId, name }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpResult(await toolCreateFolder(env, mailboxId, name));
      },
    );

    this.server.tool(
      "rename_folder",
      "Rename a custom folder. System folders cannot be renamed.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        folderId: z.string().describe("Folder id to rename"),
        name: z.string().describe("New display name"),
      },
      async ({ mailboxId, folderId, name }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpResult(await toolRenameFolder(env, mailboxId, folderId, name));
      },
    );

    this.server.tool(
      "delete_folder",
      "Delete a custom folder. System folders cannot be deleted.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        folderId: z.string().describe("Folder id to delete"),
      },
      async ({ mailboxId, folderId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpResult(await toolDeleteFolder(env, mailboxId, folderId));
      },
    );

    this.server.tool(
      "list_labels",
      "List labels in a mailbox.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
      },
      async ({ mailboxId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpText(await toolListLabels(env, mailboxId));
      },
    );

    this.server.tool(
      "create_label",
      "Create a label in a mailbox. Color is assigned automatically if omitted.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        name: z.string().describe("Display name for the new label"),
        color: z.string().optional().describe("Optional hex color, e.g. #2563eb"),
      },
      async ({ mailboxId, name, color }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpResult(await toolCreateLabel(env, mailboxId, name, color));
      },
    );

    this.server.tool(
      "update_label",
      "Rename a label or change its color.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        labelId: z.string().describe("Label id to update"),
        name: z.string().optional().describe("Updated display name"),
        color: z.string().optional().describe("Updated hex color"),
      },
      async ({ mailboxId, labelId, name, color }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpResult(
          (await toolUpdateLabel(env, mailboxId, labelId, { name, color })) as Record<
            string,
            unknown
          >,
        );
      },
    );

    this.server.tool(
      "delete_label",
      "Delete a label from a mailbox. Emails keep their folders.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        labelId: z.string().describe("Label id to delete"),
      },
      async ({ mailboxId, labelId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpResult(await toolDeleteLabel(env, mailboxId, labelId));
      },
    );

    this.server.tool(
      "apply_label",
      "Apply a label to an email. Safe to call if the label is already applied.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        emailId: z.string().describe("The email ID"),
        labelId: z.string().describe("Label id to apply"),
      },
      async ({ mailboxId, emailId, labelId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpResult(await toolApplyLabel(env, mailboxId, emailId, labelId));
      },
    );

    this.server.tool(
      "remove_label",
      "Remove a label from an email.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        emailId: z.string().describe("The email ID"),
        labelId: z.string().describe("Label id to remove"),
      },
      async ({ mailboxId, emailId, labelId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpResult(await toolRemoveLabel(env, mailboxId, emailId, labelId));
      },
    );

    this.server.tool(
      "list_emails_by_label",
      "List emails that have a given label.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        labelId: z.string().describe("Label id to filter by"),
        limit: z.number().default(20).describe("Maximum number of emails to return"),
        page: z.number().default(1).describe("Page number for pagination"),
      },
      async ({ mailboxId, labelId, limit, page }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        return mcpResult(await toolListEmailsByLabel(env, mailboxId, labelId, { limit, page }));
      },
    );

    this.server.tool(
      "move_email",
      "Move an email to a different folder. Use list_folders to see valid folder ids.",
      {
        mailboxId: z.string().describe("The mailbox email address"),
        emailId: z.string().describe("The email ID"),
        folderId: z.string().describe(MOVE_FOLDER_TOOL_DESCRIPTION),
      },
      async ({ mailboxId, emailId, folderId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolMoveEmail(env, mailboxId, emailId, folderId);
        if ("error" in result) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "Failed to move email" }),
              },
            ],
            isError: true,
          };
        }
        return mcpText(result);
      },
    );
  }
}
