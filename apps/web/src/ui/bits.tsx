// Small shared pieces of the game UI.
import type { Resource } from '@aurane/protocol';
import { Icon } from './Icon.js';
import { installPrompt, iosHint, isStandalone, updateReady } from '../pwa.js';
import { t } from '../i18n/index.js';
import { useSig } from './useSig.js';

export const RES: Resource[] = ['metal', 'energy', 'food', 'crystal', 'rium'];
export const zeroStock = (): Record<Resource, number> => ({ metal: 0, energy: 0, food: 0, crystal: 0, rium: 0 });
export const fmt = (n: number): string => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0));
export const hms = (s: number): string => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };

export function Cost({ cost }: { cost: Partial<Record<Resource, number | undefined>> }) {
  return <span class="cost">{RES.filter((r) => cost[r]).map((r) => <span key={r} class={`r-${r}`}><Icon name={r} size={12} />{cost[r]}</span>)}</span>;
}

/** Install on this device: a real prompt where the browser offers one, the share-sheet hint on iOS. */
export function InstallButton({ compact = false }: { compact?: boolean }) {
  const prompt = useSig(installPrompt);
  const ios = useSig(iosHint);
  if (isStandalone()) return null;
  if (prompt) return <button class={compact ? '' : 'primary'} onClick={() => void prompt()}>{t('installApp')}</button>;
  if (ios) return <p class="muted small ios-hint">{t('installIos')}</p>;
  return null;
}

/** A new version is ready: one tap reloads into it. */
export function UpdateBanner() {
  const apply = useSig(updateReady);
  if (!apply) return null;
  return <div class="update"><span>{t('updateReady')}</span><button class="primary" onClick={apply}>{t('reload')}</button></div>;
}
