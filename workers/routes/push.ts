import type { Context } from "hono";
import { z } from "zod";
import type { MailboxContext } from "../lib/mailbox";

type AppContext = Context<MailboxContext>;

const PushSubscribeBody = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const PushUnsubscribeBody = z.object({
  endpoint: z.string().url(),
});

export async function handlePushSubscribe(c: AppContext) {
  const parsed = PushSubscribeBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "Invalid push subscription" }, 400);
  }

  await c.var.mailboxStub.savePushSubscription({
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    expirationTime: parsed.data.expirationTime ?? null,
  });
  return c.json({ status: "subscribed" }, 201);
}

export async function handlePushUnsubscribe(c: AppContext) {
  const parsed = PushUnsubscribeBody.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "Invalid push subscription" }, 400);
  }

  await c.var.mailboxStub.deletePushSubscription(parsed.data.endpoint);
  return c.body(null, 204);
}
