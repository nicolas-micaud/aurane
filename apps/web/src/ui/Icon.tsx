// Inline SVG glyphs: one per resource and currency, tinted by CSS. Same shapes as on the map.
const PATHS: Record<string, string> = {
  metal: 'M12 2 20.66 7v10L12 22 3.34 17V7z',
  energy: 'M13 2 4 14h7l-1 8 9-12h-7z',
  food: 'M6 20c8 0 12-6 12-16C10 4 6 10 6 20zm0 0c2-5 5-8 9-11',
  crystal: 'M12 2l7 10-7 10-7-10z',
  rium: 'M12 2.5c-3.2 4.4-6 8-6 11.5a6 6 0 0 0 12 0c0-3.5-2.8-7.1-6-11.5z',
  credits: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v10m-3-7h4.5a1.5 1.5 0 0 1 0 3H9m0 0h4.5a1.5 1.5 0 0 1 0 3H9',
  influence: 'M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z',
  draw: 'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 13v.5m0-3.5c0-2 3-2 3-4.5a3 3 0 0 0-6 0',
};
export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  const d = PATHS[name] ?? PATHS.help!;
  const filled = name === 'metal' || name === 'crystal' || name === 'energy' || name === 'influence' || name === 'rium';
  return (
    <svg class={`icon i-${name}`} width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={filled ? 0 : 2} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
