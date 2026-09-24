// Installable app plumbing: service worker lifecycle, install prompt, standalone detection.
import { signal } from '@preact/signals';

/** Chrome/Android/desktop: the deferred install prompt, when the browser offers one. */
export const installPrompt = signal<(() => Promise<boolean>) | null>(null);
/** iOS Safari has no prompt: the app is added from the share sheet. */
export const iosHint = signal(false);
/** A new build is waiting: reload to get it. */
export const updateReady = signal<(() => void) | null>(null);

export const isStandalone = (): boolean => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function setupPwa(): void {
  if (isStandalone()) { try { localStorage.setItem('aurane.installed', '1'); } catch { /* ignore */ } }
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !isStandalone()) iosHint.value = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const ev = e as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
    installPrompt.value = async () => { await ev.prompt(); const { outcome } = await ev.userChoice; if (outcome === 'accepted') installPrompt.value = null; return outcome === 'accepted'; };
  });
  window.addEventListener('appinstalled', () => { installPrompt.value = null; iosHint.value = false; });

  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const track = (sw: ServiceWorker | null): void => {
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) updateReady.value = () => sw.postMessage('skip-waiting');
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) updateReady.value = () => reg.waiting?.postMessage('skip-waiting');
    track(reg.installing);
    reg.addEventListener('updatefound', () => track(reg.installing));
    // Look for a new build when the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update(); });
  }).catch(() => undefined);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
}
