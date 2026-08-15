// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Email, Folder, Label, Mailbox } from "~/types";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super((body.error as string) || `Request failed: ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Combine caller signal (e.g. TanStack Query abort) with our timeout signal
  const signal = fetchOptions.signal
    ? AbortSignal.any([fetchOptions.signal, controller.signal])
    : controller.signal;

  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers as Record<string, string>),
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body as Record<string, unknown>);
    }

    if (res.status === 204) return undefined as T;

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json() as Promise<T>;
    }
    return res.blob() as unknown as T;
  } finally {
    clearTimeout(timeout);
  }
}

function get<T>(
  url: string,
  opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal },
) {
  const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
  return request<T>(`${url}${query}`, {
    method: "GET",
    signal: opts?.signal,
    ...(opts?.responseType === "blob" ? { headers: { Accept: "*/*" } } : {}),
  });
}

function post<T>(url: string, body?: unknown, opts?: { signal?: AbortSignal; timeoutMs?: number }) {
  return request<T>(url, {
    method: "POST",
    signal: opts?.signal,
    timeoutMs: opts?.timeoutMs,
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

function put<T>(url: string, body?: unknown) {
  return request<T>(url, {
    method: "PUT",
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

function del<T>(url: string, body?: unknown) {
  return request<T>(url, {
    method: "DELETE",
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

// ---------- Typed response shapes ----------

interface EmailListResponse {
  emails: Email[];
  totalCount: number;
}

// ---------- API client ----------

const api = {
  // Config
  getConfig: () =>
    get<{ domains: string[]; emailAddresses: string[]; vapidPublicKey: string }>("/api/v1/config"),

  // Mailboxes
  listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
  createMailbox: (email: string, name: string, settings?: unknown) =>
    post<Mailbox>("/api/v1/mailboxes", { email, name, settings }),
  getMailbox: (mailboxId: string) => get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
  updateMailbox: (mailboxId: string, settings: unknown) =>
    put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, { settings }),
  deleteMailbox: (mailboxId: string) => del<void>(`/api/v1/mailboxes/${mailboxId}`),

  // Emails
  listEmails: (
    mailboxId: string,
    params: Record<string, string>,
    opts?: { signal?: AbortSignal },
  ) =>
    get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, {
      params,
      signal: opts?.signal,
    }),
  sendEmail: (mailboxId: string, email: unknown) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email),
  getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
    get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
  updateEmail: (mailboxId: string, id: string, data: unknown) =>
    put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
  deleteEmail: (mailboxId: string, id: string) =>
    del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
  moveEmail: (mailboxId: string, id: string, folderId: string) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/move`, { folderId }),
  getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
    get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
  markThreadRead: (mailboxId: string, threadId: string) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
  moveThread: (mailboxId: string, threadId: string, folderId: string, sourceFolderId?: string) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/move`, {
      folderId,
      sourceFolderId,
    }),
  getAttachment: (mailboxId: string, emailId: string, attachmentId: string) =>
    get<Blob>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`, {
      responseType: "blob",
    }),
  saveDraft: (
    mailboxId: string,
    draft: {
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      body: string;
      in_reply_to?: string;
      thread_id?: string;
      draft_id?: string;
    },
  ) => post<{ draft_id: string }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft),
  replyToEmail: (mailboxId: string, emailId: string, email: unknown) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email),
  draftReply: (mailboxId: string, emailId: string) =>
    post<{ status: string; text?: string; error?: string; reason?: string }>(
      `/api/v1/mailboxes/${mailboxId}/emails/${emailId}/draft-reply`,
      undefined,
      { timeoutMs: 120_000 },
    ),
  forwardEmail: (mailboxId: string, emailId: string, email: unknown) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email),

  // Folders
  listFolders: (mailboxId: string) => get<Folder[]>(`/api/v1/mailboxes/${mailboxId}/folders`),
  createFolder: (mailboxId: string, name: string) =>
    post<Folder>(`/api/v1/mailboxes/${mailboxId}/folders`, { name }),
  updateFolder: (mailboxId: string, id: string, name: string) =>
    put<Folder>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`, { name }),
  deleteFolder: (mailboxId: string, id: string) =>
    del<void>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`),

  // Labels
  listLabels: (mailboxId: string) => get<Label[]>(`/api/v1/mailboxes/${mailboxId}/labels`),
  createLabel: (mailboxId: string, name: string, color?: string) =>
    post<Label>(`/api/v1/mailboxes/${mailboxId}/labels`, { name, color }),
  updateLabel: (mailboxId: string, id: string, data: { name?: string; color?: string }) =>
    put<Label>(`/api/v1/mailboxes/${mailboxId}/labels/${id}`, data),
  deleteLabel: (mailboxId: string, id: string) =>
    del<void>(`/api/v1/mailboxes/${mailboxId}/labels/${id}`),
  applyLabel: (mailboxId: string, emailId: string, labelId: string) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/labels`, { labelId }),
  removeLabel: (mailboxId: string, emailId: string, labelId: string) =>
    del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/labels/${labelId}`),
  listEmailsByLabel: (mailboxId: string, labelId: string, params: Record<string, string> = {}) =>
    get<EmailListResponse>(`/api/v1/mailboxes/${mailboxId}/labels/${labelId}/emails`, { params }),

  // Search
  searchEmails: (mailboxId: string, params: Record<string, string>) =>
    get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/search`, { params }),

  subscribePush: (
    mailboxId: string,
    subscription: {
      endpoint: string;
      expirationTime: number | null;
      keys: { p256dh: string; auth: string };
    },
  ) => post<{ status: string }>(`/api/v1/mailboxes/${mailboxId}/push/subscribe`, subscription),
  unsubscribePush: (mailboxId: string, endpoint: string) =>
    del<void>(`/api/v1/mailboxes/${mailboxId}/push/subscribe`, { endpoint }),
};

export default api;
