import { useEffect, useState } from 'react';

// In-app install prompt. Chrome no longer shows an automatic
// install banner (removed in Chrome 89), so the app offers the
// install itself when the browser reports the site as installable.
//
// The beforeinstallprompt event is Chromium-only; it never fires
// on iOS Safari, so no banner appears there. That is by design:
// iOS installs stay a manual Add to Home Screen from Safari.

// Minimal shape of the beforeinstallprompt event; it is not part
// of the standard DOM typings.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Dismissal is stored so the banner never nags: once dismissed,
// answered, or installed, it stays hidden.
const DISMISSED_KEY = 'nux_install_dismissed';

function markDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Storage may be unavailable (private mode); the banner still
    // stays hidden for this session.
  }
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      // Storage may be unavailable; fall through and let the
      // banner work for this session.
    }
    if (dismissed) return;

    const onBeforeInstallPrompt = (e: Event) => {
      // Suppress the browser's own handling and keep the event so
      // the banner's Install button can trigger the native prompt
      // on demand. The event only fires when the site is
      // installable and not already installed, so the banner never
      // offers an install that cannot happen.
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => setDeferredPrompt(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  if (!deferredPrompt) return null;

  const handleInstall = async () => {
    const promptEvent = deferredPrompt;
    // The event can only be used once; clear it up front so a
    // second tap cannot re-trigger the native prompt.
    setDeferredPrompt(null);
    try {
      await promptEvent.prompt();
      // Accepted or dismissed, the user has answered: never ask again.
      await promptEvent.userChoice;
      markDismissed();
    } catch {
      // The prompt may fail if the browser revokes installability
      // in the meantime; nothing to show then.
    }
  };

  const handleDismiss = () => {
    setDeferredPrompt(null);
    markDismissed();
  };

  return (
    <div className="rounded-2xl border border-nux-500/40 bg-nux-500/10 px-4 py-3 flex items-center justify-between gap-3 mb-6">
      <p className="text-sm text-ink">
        Install Nusacoin Wallet on this device for quick access.
      </p>
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={handleInstall} className="btn-primary py-2 px-4 text-sm">
          Install
        </button>
        <button onClick={handleDismiss} className="text-dark-400 hover:text-ink text-sm">
          Dismiss
        </button>
      </div>
    </div>
  );
}
