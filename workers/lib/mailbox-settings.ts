// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Mailbox settings live in R2 at mailboxes/{id}.json — not on the mailbox DO.
 * Unset autoDraftReplies means true, so existing mailboxes keep auto-draft.
 */

export async function loadMailboxSettings(
  bucket: R2Bucket,
  mailboxId: string,
): Promise<Record<string, unknown> | null> {
  const obj = await bucket.get(`mailboxes/${mailboxId}.json`);
  if (!obj) return null;
  try {
    const data: unknown = await obj.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    // Corrupt JSON: treat as empty so callers keep default behaviour.
  }
  return {};
}

export function isAutoDraftRepliesEnabled(
  settings: Record<string, unknown> | null | undefined,
): boolean {
  return settings?.autoDraftReplies !== false;
}

export function agentSystemPromptFromSettings(
  settings: Record<string, unknown> | null | undefined,
  fallback: string,
): string {
  const prompt = settings?.agentSystemPrompt;
  if (typeof prompt === "string" && prompt.trim()) return prompt;
  return fallback;
}
