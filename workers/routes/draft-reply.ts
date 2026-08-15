// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { AGENT_DRAFT_PATHS, fetchAgentDraft } from "../lib/agent-draft";
import type { EmailFull } from "../lib/schemas";
import type { MailboxContext } from "../lib/mailbox";
import { Folders } from "../../shared/folders";

type AppContext = Context<MailboxContext>;

export async function handleDraftReply(c: AppContext) {
  const mailboxId = c.req.param("mailboxId") ?? "";
  const id = c.req.param("id") ?? "";
  const email = (await c.var.mailboxStub.getEmail(id)) as EmailFull | null;
  if (!email) return c.json({ error: "Email not found" }, 404);
  if (email.folder_id === Folders.DRAFT) {
    return c.json({ error: "Cannot draft a reply to a draft" }, 400);
  }

  const response = await fetchAgentDraft(c.env, AGENT_DRAFT_PATHS.manual, {
    mailboxId,
    emailId: email.id,
    sender: email.sender,
    subject: email.subject,
    threadId: email.thread_id || email.id,
  });

  const body: unknown = await response.json().catch(() => ({
    error: "Draft reply failed",
  }));
  return c.json(body, response.ok ? 200 : 500);
}
