export const LAUNCH_DATE = '2026-09-24';

/** Local calendar date as YYYY-MM-DD. */
export function todayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dailyNumber(key) {
  const toUtc = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(key) - toUtc(LAUNCH_DATE)) / 86400000) + 1;
}

/** Difficulty ramps through the week: Monday is gentle, Sunday is brutal. */
export function dailyConfig(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const level = dow === 0 ? 7 : dow;
  return { listeners: 2 + Math.ceil(level / 2), starCount: 40 + level * 2 };
}

export function msUntilTomorrow(now = new Date()) {
  const t = new Date(now);
  t.setHours(24, 0, 0, 0);
  return t - now;
}
