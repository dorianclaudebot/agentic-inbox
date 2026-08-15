// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { AIChatAgent } from "@cloudflare/ai-chat";
import { streamText, generateText, convertToModelMessages, stepCountIs } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import type { EmailFull, EmailMetadata } from "../lib/schemas";
import { verifyDraft, isPromptInjection } from "../lib/ai";
import { getMailboxStub, stripHtmlToText, textToHtml } from "../lib/email-helpers";
import {
  toolListEmails,
  toolGetEmail,
  toolGetThread,
  toolSearchEmails,
  toolDraftReply,
  toolDraftEmail,
  toolMarkEmailRead,
  toolMoveEmail,
  toolDiscardDraft,
  toolListFolders,
  toolCreateFolder,
  toolListLabels,
  toolCreateLabel,
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
import { AGENT_DRAFT_PATHS, type AgentDraftPath, type AgentDraftPayload } from "../lib/agent-draft";
import {
  agentSystemPromptFromSettings,
  isAutoDraftRepliesEnabled,
  loadMailboxSettings,
} from "../lib/mailbox-settings";

const AGENT_MODEL = "@cf/zai-org/glm-4.7-flash" as const;

// AI SDK tool() overloads are awkward. Define tools as plain objects.
function defineTool(def: {
  description: string;
  parameters: z.ZodType<any>;
  execute: (...args: any[]) => Promise<any>;
}) {
  return {
    description: def.description,
    inputSchema: def.parameters,
    execute: def.execute,
  };
}

/**
 * Default system prompt used when no custom prompt is configured for a mailbox.
 * Users can override this on a per-mailbox basis via the Settings UI.
 */
const DEFAULT_SYSTEM_PROMPT = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.

## Writing Style
Write like a real person. Short, direct, flowing prose. Get to the point. Plain text only - no HTML tags in your replies.

**Formatting rules:**
- Write in natural paragraphs. NO bullet points, NO numbered lists, NO dashes, NO markdown formatting in email drafts.
- NO bold (**), NO italic (*), NO headers (#), NO horizontal rules (---), NO code blocks. Plain text only.
- Links go inline in the text, not on separate lines.
- Don't structure replies like a template or form letter. Just talk normally.

**Agent Behavior Rules (CRITICAL):**
- NEVER output meta-commentary about what you are doing (e.g. do not say "I am drafting a reply to Alex", "I checked the thread", etc).
- When a new email arrives, your ONLY job is to call the \`draft_reply\` tool.
- DO NOT summarize the email. DO NOT explain your actions.
- Output NOTHING except the tool call. If you must output text, it should ONLY be the literal draft text itself if tools fail.
- Before drafting ANY reply, carefully read the full thread history.
- NEVER repeat information that was already shared in a prior message in the thread.
- Your reply should only contain NEW information or directly respond to what the person just said. Move the conversation forward, don't rehash it.

## Who Are You Replying To?
Use the name the person gives in their email body / signature. That's their name - use it. The "from" address is where you send the reply, but the name in the email is how you greet them.

## CRITICAL: Draft Only - Never Send
You can ONLY draft emails. You do NOT have the ability to send emails directly.

- Use draft_reply to draft replies to existing emails
- Use draft_email to draft new outbound emails
- The operator will review and send drafts from the UI - you cannot send them

**CRITICAL: The draft body must contain ONLY the email text.** Never include agent commentary, status messages, meta-notes, markdown formatting, or anything that isn't part of the actual email in the draft body. No "Draft created.", no "---", no "**bold**", no "Here's the draft:", no separators. The body field is the literal email the recipient will read. Everything else goes in your chat message, not in the draft body.

**Don't paste draft contents into the chat.** The drafts are saved via tools - the operator can see them in the Drafts folder. In your chat message, just briefly say what you drafted (e.g. "Drafted a reply to Tim"). Don't duplicate the full email body in the chat.

## Draft Management
Use discard_draft to delete drafts that the operator rejects or that are no longer needed.`;

/**
 * Fetch the custom system prompt for a mailbox from its R2 settings.
 * Falls back to DEFAULT_SYSTEM_PROMPT if none is configured.
 */
async function getSystemPrompt(env: Env, mailboxId: string): Promise<string> {
  const settings = await loadMailboxSettings(env.BUCKET, mailboxId);
  return agentSystemPromptFromSettings(settings, DEFAULT_SYSTEM_PROMPT);
}

type DraftTriggerSource = "auto" | "manual";

function draftSourceFromPath(pathname: AgentDraftPath): DraftTriggerSource {
  switch (pathname) {
    case AGENT_DRAFT_PATHS.auto:
      return "auto";
    case AGENT_DRAFT_PATHS.manual:
      return "manual";
    default: {
      const _exhaustive: never = pathname;
      return _exhaustive;
    }
  }
}

function isAgentDraftPath(pathname: string): pathname is AgentDraftPath {
  return pathname === AGENT_DRAFT_PATHS.auto || pathname === AGENT_DRAFT_PATHS.manual;
}

function draftTriggerLabel(source: DraftTriggerSource): string {
  switch (source) {
    case "auto":
      return "Auto-triggered";
    case "manual":
      return "Requested";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function draftRequestIntro(source: DraftTriggerSource): string {
  switch (source) {
    case "auto":
      return "A new email just arrived. Draft an appropriate response using draft_reply.";
    case "manual":
      return "The operator requested a draft reply to this email. Draft an appropriate response using draft_reply.";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function draftRequestUserSummary(
  source: DraftTriggerSource,
  sender: string,
  subject: string,
): string {
  const label = draftTriggerLabel(source);
  switch (source) {
    case "auto":
      return `[${label}] New email from ${sender}: "${subject}"`;
    case "manual":
      return `[${label}] Draft reply to ${sender}: "${subject}"`;
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function createEmailTools(env: Env, mailboxId: string) {
  return {
    list_emails: defineTool({
      description:
        "List emails in a folder. Returns email metadata (id, subject, sender, recipient, date, read/starred status, thread_id). Use folder='inbox' for received emails, 'sent' for sent emails.",
      parameters: z.object({
        folder: z.string().default(Folders.INBOX).describe(FOLDER_TOOL_DESCRIPTION),
        limit: z.number().default(20).describe("Maximum number of emails to return"),
        page: z.number().default(1).describe("Page number for pagination"),
      }),
      execute: async ({ folder, limit, page }): Promise<unknown> => {
        return toolListEmails(env, mailboxId, { folder, limit, page });
      },
    }),

    get_email: defineTool({
      description:
        "Get a single email with its full body content and attachments. Use this to read the actual content of an email.",
      parameters: z.object({
        emailId: z.string().describe("The email ID to retrieve"),
      }),
      execute: async ({ emailId }): Promise<unknown> => {
        return toolGetEmail(env, mailboxId, emailId);
      },
    }),

    get_thread: defineTool({
      description:
        "Get all emails in a conversation thread. This is essential for understanding the full context of a conversation before drafting a response. Returns all messages sorted chronologically.",
      parameters: z.object({
        threadId: z
          .string()
          .describe(
            "The thread_id to retrieve all messages for. Get this from an email's thread_id field.",
          ),
      }),
      execute: async ({ threadId }): Promise<unknown> => {
        return toolGetThread(env, mailboxId, threadId);
      },
    }),

    search_emails: defineTool({
      description: "Search for emails matching a query across subject and body fields.",
      parameters: z.object({
        query: z.string().describe("Search query to match against subject and body"),
        folder: z.string().optional().describe("Optional folder to restrict search to"),
      }),
      execute: async ({ query, folder }): Promise<unknown> => {
        return toolSearchEmails(env, mailboxId, { query, folder });
      },
    }),

    draft_email: defineTool({
      description:
        "Draft a new email (not a reply) and save it to the Drafts folder. This does NOT send — it saves a draft for the operator to review. Use this for composing new outbound emails. Write the body as plain text — no HTML tags.",
      parameters: z.object({
        to: z.string().email().describe("Recipient email address"),
        subject: z.string().describe("Subject line"),
        body: z
          .string()
          .describe("The plain text body of the email. No HTML — just write normally."),
      }),
      execute: async ({ to, subject, body }): Promise<unknown> => {
        return toolDraftEmail(env, mailboxId, {
          to,
          subject,
          body,
          isPlainText: true,
        });
      },
    }),

    draft_reply: defineTool({
      description:
        "Draft a reply to an existing email and save it to the Drafts folder. This does NOT send — it saves a draft for the operator to review and send from the UI. Write the body as plain text — no HTML tags.",
      parameters: z.object({
        originalEmailId: z.string().describe("The ID of the email being replied to"),
        to: z.string().email().describe("Recipient email address"),
        subject: z.string().describe("Subject line (usually 'Re: ...')"),
        body: z
          .string()
          .describe("The plain text body of the reply. No HTML — just write normally."),
      }),
      execute: async ({ originalEmailId, to, subject, body }): Promise<unknown> => {
        return toolDraftReply(env, mailboxId, {
          originalEmailId,
          to,
          subject,
          body,
          isPlainText: true,
          runVerifyDraft: true,
        });
      },
    }),

    mark_email_read: defineTool({
      description: "Mark an email as read or unread.",
      parameters: z.object({
        emailId: z.string().describe("The email ID"),
        read: z.boolean().describe("true to mark as read, false for unread"),
      }),
      execute: async ({ emailId, read }): Promise<unknown> => {
        return toolMarkEmailRead(env, mailboxId, emailId, read);
      },
    }),

    list_folders: defineTool({
      description: "List folders in this mailbox, including custom folders.",
      parameters: z.object({}),
      execute: async (): Promise<unknown> => toolListFolders(env, mailboxId),
    }),

    create_folder: defineTool({
      description: "Create a custom folder. Prefer this only for a name that will be reused.",
      parameters: z.object({
        name: z.string().describe("Display name for the new folder"),
      }),
      execute: async ({ name }): Promise<unknown> => toolCreateFolder(env, mailboxId, name),
    }),

    list_labels: defineTool({
      description: "List labels in this mailbox.",
      parameters: z.object({}),
      execute: async (): Promise<unknown> => toolListLabels(env, mailboxId),
    }),

    create_label: defineTool({
      description: "Create a label. Color is assigned automatically if omitted.",
      parameters: z.object({
        name: z.string().describe("Display name for the new label"),
        color: z.string().optional().describe("Optional hex color, e.g. #2563eb"),
      }),
      execute: async ({ name, color }): Promise<unknown> =>
        toolCreateLabel(env, mailboxId, name, color),
    }),

    apply_label: defineTool({
      description: "Apply a label to an email. Safe if the label is already applied.",
      parameters: z.object({
        emailId: z.string().describe("The email ID"),
        labelId: z.string().describe("Label id to apply"),
      }),
      execute: async ({ emailId, labelId }): Promise<unknown> =>
        toolApplyLabel(env, mailboxId, emailId, labelId),
    }),

    remove_label: defineTool({
      description: "Remove a label from an email.",
      parameters: z.object({
        emailId: z.string().describe("The email ID"),
        labelId: z.string().describe("Label id to remove"),
      }),
      execute: async ({ emailId, labelId }): Promise<unknown> =>
        toolRemoveLabel(env, mailboxId, emailId, labelId),
    }),

    list_emails_by_label: defineTool({
      description: "List emails that have a given label.",
      parameters: z.object({
        labelId: z.string().describe("Label id to filter by"),
        limit: z.number().default(20).describe("Maximum number of emails to return"),
        page: z.number().default(1).describe("Page number for pagination"),
      }),
      execute: async ({ labelId, limit, page }): Promise<unknown> =>
        toolListEmailsByLabel(env, mailboxId, labelId, { limit, page }),
    }),

    move_email: defineTool({
      description: "Move an email to a different folder. Use list_folders for custom folder ids.",
      parameters: z.object({
        emailId: z.string().describe("The email ID"),
        folderId: z.string().describe(MOVE_FOLDER_TOOL_DESCRIPTION),
      }),
      execute: async ({ emailId, folderId }): Promise<unknown> => {
        return toolMoveEmail(env, mailboxId, emailId, folderId);
      },
    }),

    discard_draft: defineTool({
      description:
        "Delete a draft email. Use this to discard drafts that are no longer needed or were rejected by the operator.",
      parameters: z.object({
        draftId: z.string().describe("The ID of the draft to delete"),
      }),
      execute: async ({ draftId }): Promise<unknown> => {
        return toolDiscardDraft(env, mailboxId, draftId);
      },
    }),
  };
}

// Use `any` for the Env generic to avoid type conflicts between the custom
// SEND_EMAIL binding shape and the AIChatAgent constraint.  The actual env
// is fully typed inside the tools via the closure.
export class EmailAgent extends AIChatAgent<any> {
  async onChatMessage(onFinish: any) {
    const env = this.env as Env;
    const mailboxId = this.name;
    const workersai = createWorkersAI({ binding: env.AI });
    const tools = createEmailTools(env, mailboxId);
    const systemPrompt = await getSystemPrompt(env, mailboxId);

    const result = streamText({
      model: workersai(AGENT_MODEL),
      instructions: systemPrompt,
      allowSystemInMessages: true,
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }

  /**
   * Handle HTTP requests to the agent DO. Intercepts /onNewEmail
   * and /draftReply before passing to the default AIChatAgent handler.
   */
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && isAgentDraftPath(url.pathname)) {
      try {
        const emailData = (await request.json()) as AgentDraftPayload;
        const source = draftSourceFromPath(url.pathname);
        if (source === "auto") {
          const settings = await loadMailboxSettings(this.env.BUCKET, emailData.mailboxId);
          if (!isAutoDraftRepliesEnabled(settings)) {
            return new Response(
              JSON.stringify({ status: "skipped", reason: "auto_draft_disabled" }),
              {
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        }
        const result = await this.handleNewEmail(emailData, source);
        return new Response(JSON.stringify(result ?? { status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        console.error("draft handler failed:", (e as Error).message);
        return new Response(JSON.stringify({ error: (e as Error).message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return super.onRequest(request);
  }

  /**
   * Draft a reply for an email: reads it, loads the thread,
   * and saves a draft via draft_reply (or inline fallback).
   */
  async handleNewEmail(emailData: AgentDraftPayload, source: DraftTriggerSource = "auto") {
    const env = this.env as Env;
    const workersai = createWorkersAI({ binding: env.AI });
    const tools = createEmailTools(env, emailData.mailboxId);
    const systemPrompt = await getSystemPrompt(env, emailData.mailboxId);
    const userSummary = draftRequestUserSummary(source, emailData.sender, emailData.subject);

    // Pre-read the email and thread so the agent has full context
    // without needing to waste tool calls discovering it
    const stub = getMailboxStub(env, emailData.mailboxId);

    let emailBody = "";
    let threadContext = "";
    try {
      const email = (await stub.getEmail(emailData.emailId)) as EmailFull | null;
      if (email?.body) {
        const isInjection = await isPromptInjection(env.AI, email.body);
        if (isInjection) {
          console.warn("Skipping auto-draft due to detected prompt injection:", emailData.emailId);

          // Log to agent chat so the user knows why it skipped
          const newMessages = [
            {
              id: crypto.randomUUID(),
              role: "user" as const,
              content: userSummary,
              createdAt: new Date(),
              parts: [
                {
                  type: "text" as const,
                  text: userSummary,
                },
              ],
            },
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content:
                "⚠️ Blocked auto-draft creation: the email appears to contain prompt injection or malicious instructions.",
              createdAt: new Date(),
              parts: [
                {
                  type: "text" as const,
                  text: "⚠️ Blocked auto-draft creation: the email appears to contain prompt injection or malicious instructions.",
                },
              ],
            },
          ];
          await this.persistMessages([...this.messages, ...newMessages]);

          return { status: "blocked", reason: "prompt_injection" };
        }

        emailBody = stripHtmlToText(email.body);
      }

      // Load thread for conversation context
      const threadEmails = (await stub.getEmails({
        thread_id: emailData.threadId,
      })) as EmailMetadata[];
      if (threadEmails.length > 1) {
        const fullThread = await Promise.all(
          threadEmails.map(async (e) => {
            const full = (await stub.getEmail(e.id)) as EmailFull | null;
            const text = full?.body ? stripHtmlToText(full.body) : "";
            return {
              id: e.id,
              sender: e.sender,
              recipient: e.recipient,
              subject: e.subject,
              date: e.date,
              folder_id: e.folder_id,
              body_text: text,
            };
          }),
        );
        fullThread.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        threadContext = fullThread
          .map(
            (e) =>
              `[${e.date}] ${e.sender} → ${e.recipient} (${e.folder_id}): ${e.body_text.substring(0, 500)}`,
          )
          .join("\n\n");

        // Scan thread context for prompt injection too -- an attacker
        // could plant an injection in an earlier email in the thread
        // that gets included in the agent's prompt.
        if (threadContext) {
          const threadInjection = await isPromptInjection(env.AI, threadContext);
          if (threadInjection) {
            console.warn(
              "Skipping auto-draft due to prompt injection in thread context:",
              emailData.threadId,
            );
            const newMessages = [
              {
                id: crypto.randomUUID(),
                role: "user" as const,
                content: userSummary,
                createdAt: new Date(),
                parts: [
                  {
                    type: "text" as const,
                    text: userSummary,
                  },
                ],
              },
              {
                id: crypto.randomUUID(),
                role: "assistant" as const,
                content:
                  "Blocked auto-draft creation: the thread context appears to contain prompt injection or malicious instructions.",
                createdAt: new Date(),
                parts: [
                  {
                    type: "text" as const,
                    text: "Blocked auto-draft creation: the thread context appears to contain prompt injection or malicious instructions.",
                  },
                ],
              },
            ];
            await this.persistMessages([...this.messages, ...newMessages]);
            return { status: "blocked", reason: "prompt_injection" };
          }
        }
      }
    } catch (e) {
      console.warn("Pre-read failed, agent will use tools:", (e as Error).message);
    }

    let autoPrompt = `${draftRequestIntro(source)}

Email details:
- Mailbox: ${emailData.mailboxId}
- Email ID: ${emailData.emailId}
- From: ${emailData.sender}
- Subject: ${emailData.subject}
- Thread ID: ${emailData.threadId}

Email body:
${emailBody || "(could not pre-read — use get_email to read it)"}`;

    if (threadContext) {
      autoPrompt += `

Full thread history (${emailData.threadId}):
${threadContext}`;
    } else {
      autoPrompt += `

This is the first message in the thread (no prior conversation).`;
    }

    autoPrompt += `

Based on the email content and thread context above, draft a reply using draft_reply. If you need more context, use get_thread with thread ID "${emailData.threadId}".`;

    // Fresh context for auto-draft -- don't include prior chat history
    // to avoid confusing the model with old messages and tool calls
    const messages = [
      {
        role: "user" as const,
        content: autoPrompt,
        parts: [{ type: "text" as const, text: autoPrompt }],
        createdAt: new Date(),
      },
    ];

    try {
      const result = await generateText({
        model: workersai(AGENT_MODEL),
        instructions: systemPrompt,
        messages: await convertToModelMessages(messages),
        tools,
        stopWhen: stepCountIs(5),
      });

      // Check if draft_reply was called (saves to Drafts as side effect).
      // If NOT, save the agent's text response as a draft directly.
      const draftToolCalled = result.steps.some((step) =>
        step.toolCalls.some((tc) => tc.toolName === "draft_reply" || tc.toolName === "draft_email"),
      );

      if (!draftToolCalled && result.text.trim()) {
        // Model generated a draft inline as text -- verify with AI
        const sanitizedText = await verifyDraft(env.AI, result.text.trim());
        if (!sanitizedText) {
          // Inline text was entirely agent commentary, skip
        } else {
          const draftId = crypto.randomUUID();
          const draftStub = getMailboxStub(env, emailData.mailboxId);
          const reSubject = emailData.subject.startsWith("Re:")
            ? emailData.subject
            : `Re: ${emailData.subject}`;
          await draftStub.createEmail(
            Folders.DRAFT,
            {
              id: draftId,
              subject: reSubject,
              sender: emailData.mailboxId.toLowerCase(),
              recipient: emailData.sender.toLowerCase(),
              date: new Date().toISOString(),
              // verifyDraft may return plain text or HTML depending on its
              // code path. Only wrap in textToHtml if it's plain text.
              body: /<[a-z][\s\S]*>/i.test(sanitizedText)
                ? sanitizedText
                : textToHtml(sanitizedText),
              in_reply_to: emailData.emailId,
              email_references: null,
              thread_id: emailData.threadId,
            },
            [],
          );
          // Inline text saved as draft
        }
      }

      // Persist the conversation into the agent's chat history
      // If it called the tool, we just log a simple success message so the chat isn't cluttered
      // with conversational slop.
      const assistantText = draftToolCalled
        ? `Created draft reply to ${emailData.sender}.`
        : result.text;

      const newMessages = [
        {
          id: crypto.randomUUID(),
          role: "user" as const,
          content: userSummary,
          createdAt: new Date(),
          parts: [
            {
              type: "text" as const,
              text: userSummary,
            },
          ],
        },
        {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: assistantText,
          createdAt: new Date(),
          parts: [
            {
              type: "text" as const,
              text: assistantText,
            },
          ],
        },
      ];

      await this.persistMessages([...this.messages, ...newMessages]);

      return { status: "draft_generated", text: result.text };
    } catch (e) {
      console.error("Auto-draft failed:", (e as Error).message);
      return { status: "error", error: (e as Error).message };
    }
  }
}
