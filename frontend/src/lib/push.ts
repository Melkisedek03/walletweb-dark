// Push notifications (Web Push via FCM VAPID) — opt-in only.
//
// The browser's standard Push API is used directly; no Firebase
// JavaScript SDK is loaded into the wallet. Subscribing posts the
// PushSubscription (endpoint + p256dh/auth keys) together with the
// wallet's two addresses (bech32 + legacy) to the subscription
// service, which the watcher reads to send a notification when coins
// arrive. Nothing is subscribed, and no address leaves the browser,
// until the user turns the toggle on.
//
// The VAPID public key below is a public key, not a secret: it is
// only used as the applicationServerKey at subscribe time. The
// subscription service must be live before anyone can subscribe —
// see backend/push-watcher/README.md for the deploy order (backend
// first, frontend second).

// VAPID public key of the Firebase project used for push (same
// project as the PUNDI wallet). Public by design; safe to ship.
const VAPID_PUBLIC_KEY =
  'BHzvrt5PCzW7Ru6HVcUA7PDpJAeUFAU82H_lud6sBQcQalh7ur3N0frjfJuVIik3H_lP8SX-Ikc94zDq8Jrov1Y';

// Subscription service base URL. Served by the push backend on the
// PUNDI-watcher VPS, exposed through the apitest nginx route
// /api/webpush/ (see backend/push-watcher/README.md). This is the
// wallet's second runtime third-party host after the CoinPaprika rate
// lookup; it carries only public addresses and a push endpoint.
const PUSH_SERVICE_BASE = 'https://apitest.taobot.org/api/webpush';

// The subscribed endpoint, kept so the UI knows the subscribed state
// across reloads and can re-sync after a browser rotation.
const PUSH_ENDPOINT_KEY = 'nux_push_endpoint';

export function isPushSupported(): boolean {
  // Gated to production builds, like the service worker registration
  // itself; in development the section stays hidden.
  return (
    import.meta.env.PROD &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getStoredPushEndpoint(): string | null {
  try {
    return window.localStorage.getItem(PUSH_ENDPOINT_KEY);
  } catch {
    return null;
  }
}

function storePushEndpoint(endpoint: string | null): void {
  try {
    if (endpoint) {
      window.localStorage.setItem(PUSH_ENDPOINT_KEY, endpoint);
    } else {
      window.localStorage.removeItem(PUSH_ENDPOINT_KEY);
    }
  } catch {
    // Private mode or blocked storage: the subscription still works
    // for this session; only the persisted state is lost.
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Std = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64Std);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

async function postSubscription(
  path: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${PUSH_SERVICE_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

function subscriptionPayload(subscription: PushSubscription, addresses: string[]) {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    addresses,
  };
}

export type PushSubscribeResult = { ok: boolean; error?: string };

/** Turn notifications on: request permission, subscribe, register. */
export async function subscribePush(addresses: string[]): Promise<PushSubscribeResult> {
  if (Notification.permission === 'denied') {
    return { ok: false, error: 'denied' };
  }
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, error: 'permission' };
  }
  if (permission !== 'granted') {
    return { ok: false, error: permission === 'denied' ? 'denied' : 'permission' };
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const saved = await postSubscription(
      '/subscribe',
      subscriptionPayload(subscription, addresses),
    );
    if (!saved) {
      // The browser is subscribed but the server does not know it:
      // drop the local subscription so the toggle does not claim a
      // state the server cannot deliver.
      await subscription.unsubscribe().catch(() => undefined);
      return { ok: false, error: 'server' };
    }
    storePushEndpoint(subscription.endpoint);
    return { ok: true };
  } catch {
    return { ok: false, error: 'subscribe' };
  }
}

/** Turn notifications off: unsubscribe locally and delete server-side. */
export async function unsubscribePush(): Promise<void> {
  let endpoint: string | null = null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      endpoint = subscription.endpoint;
      await subscription.unsubscribe().catch(() => undefined);
    }
  } catch {
    // Local unsubscribe is best-effort; the server delete below and
    // the watcher's stale-endpoint cleanup still remove the row.
  }
  const stored = endpoint ?? getStoredPushEndpoint();
  if (stored) {
    await postSubscription('/unsubscribe', { endpoint: stored });
  }
  storePushEndpoint(null);
}

/** Fire-and-forget deletion for logout: never blocks the caller. */
export function deletePushSubscription(): void {
  void unsubscribePush();
}

/**
 * Re-sync after a browser subscription rotation. On Dashboard mount,
 * if the stored flag says subscribed, compare the live subscription
 * with the stored endpoint and re-register when it changed. All
 * failures are swallowed: a missed re-sync only delays notifications
 * until the next open, it never breaks the wallet.
 */
export async function syncPushSubscription(addresses: string[]): Promise<void> {
  const stored = getStoredPushEndpoint();
  if (!stored) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      // The browser dropped the subscription (e.g. site data was
      // cleared): forget the stored flag so the toggle shows off.
      storePushEndpoint(null);
      return;
    }
    if (subscription.endpoint !== stored) {
      const saved = await postSubscription(
        '/subscribe',
        subscriptionPayload(subscription, addresses),
      );
      if (saved) storePushEndpoint(subscription.endpoint);
    }
  } catch {
    // Best-effort only.
  }
}
