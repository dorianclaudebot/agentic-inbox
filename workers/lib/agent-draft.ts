// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Env } from "../types";

export interface AgentDraftPayload {
  mailboxId: string;
  emailId: string;
  sender: string;
  subject: string;
  threadId: string;
}

export const AGENT_DRAFT_PATHS = {
  auto: "/onNewEmail",
  manual: "/draftReply",
} as const;

export type AgentDraftPath = (typeof AGENT_DRAFT_PATHS)[keyof typeof AGENT_DRAFT_PATHS];

export async function fetchAgentDraft(
  env: Env,
  path: AgentDraftPath,
  payload: AgentDraftPayload,
): Promise<Response> {
  const stub = env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(payload.mailboxId));
  return stub.fetch(
    new Request(`https://agents${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}
