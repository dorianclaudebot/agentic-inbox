export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
}

export function upsertPushSubscription(
  sql: SqlStorage,
  subscription: StoredPushSubscription,
): void {
  sql.exec(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, expiration_time, created_at)
		 VALUES (?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(endpoint) DO UPDATE SET
			p256dh = excluded.p256dh,
			auth = excluded.auth,
			expiration_time = excluded.expiration_time`,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    subscription.expirationTime,
  );
}

export function deletePushSubscription(sql: SqlStorage, endpoint: string): void {
  sql.exec(`DELETE FROM push_subscriptions WHERE endpoint = ?`, endpoint);
}

export function listPushSubscriptions(sql: SqlStorage): StoredPushSubscription[] {
  const subscriptions: StoredPushSubscription[] = [];
  for (const row of sql.exec(
    `SELECT endpoint, p256dh, auth, expiration_time FROM push_subscriptions`,
  )) {
    const endpoint = row.endpoint;
    const p256dh = row.p256dh;
    const auth = row.auth;
    const expirationTime = row.expiration_time;
    if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
      continue;
    }
    subscriptions.push({
      endpoint,
      p256dh,
      auth,
      expirationTime: typeof expirationTime === "number" ? expirationTime : null,
    });
  }
  return subscriptions;
}
