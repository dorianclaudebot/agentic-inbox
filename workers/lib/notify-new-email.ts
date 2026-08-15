import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { MailboxDO } from "../durableObject";
import type { Env } from "../types";
import type { StoredPushSubscription } from "./push-store";

const GONE_STATUS = new Set([404, 410]);

export interface NewEmailPush {
  mailboxId: string;
  sender: string;
  subject: string;
}

interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

function vapidConfig(env: Env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {
    subject: env.VAPID_SUBJECT || "mailto:inbox@example.com",
    publicKey,
    privateKey,
  };
}

function publicOrigin(env: Env): string {
  const fromEnv = env.PUBLIC_ORIGIN?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return "https://inbox.example.com";
}

function inboxUrl(env: Env, mailboxId: string): string {
  return `${publicOrigin(env)}/mailbox/${encodeURIComponent(mailboxId)}/emails/inbox`;
}

async function sendOne(
  subscription: StoredPushSubscription,
  payloadJson: string,
  vapid: VapidConfig,
): Promise<number> {
  const payload = await buildPushPayload(
    {
      data: payloadJson,
      options: { ttl: 86_400, urgency: "high" },
    },
    {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    vapid,
  );
  const body = new ArrayBuffer(payload.body.byteLength);
  new Uint8Array(body).set(payload.body);
  const response = await fetch(subscription.endpoint, {
    method: payload.method,
    headers: payload.headers,
    body,
  });
  return response.status;
}

export async function notifyNewEmail(
  env: Env,
  stub: DurableObjectStub<MailboxDO>,
  event: NewEmailPush,
): Promise<void> {
  const vapid = vapidConfig(env);
  if (!vapid) return;

  const subscriptions = await stub.listPushSubscriptions();
  if (subscriptions.length === 0) return;

  const payloadJson = JSON.stringify({
    title: event.sender ? `New mail from ${event.sender}` : "New email",
    body: event.subject || "(no subject)",
    url: inboxUrl(env, event.mailboxId),
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      const status = await sendOne(subscription, payloadJson, vapid);
      if (GONE_STATUS.has(status)) {
        await stub.deletePushSubscription(subscription.endpoint);
      }
    }),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Web Push delivery failed:", result.reason);
    }
  }
}
