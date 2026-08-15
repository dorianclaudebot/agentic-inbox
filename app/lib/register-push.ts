import api from "~/services/api";

function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new ArrayBuffer(raw.length);
  const view = new Uint8Array(output);
  for (let i = 0; i < raw.length; i++) {
    view[i] = raw.charCodeAt(i);
  }
  return output;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function registerMailboxPush(mailboxId: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!mailboxId) return;

  const sw = await registration();
  if (!sw) return;

  const { vapidPublicKey } = await api.getConfig();
  if (!vapidPublicKey) return;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const subscription = await sw.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;

  await api.subscribePush(mailboxId, {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  });
}
