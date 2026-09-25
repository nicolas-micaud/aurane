// Per-player quotas so no colony drains the providers: dialogue per hour and per day, doctrine
// compilations per day, briefings per day. Beyond the quota the General answers in character, without
// the model, that it will resume at the next Draw. In memory; resets on UTC hour / day.

export interface QuotaLimits {
  talkPerHour: number;
  talkPerDay: number;
  doctrinePerDay: number;
  briefingPerDay: number;
  counselPerDay: number;
}

export const DEFAULT_LIMITS: QuotaLimits = { talkPerHour: 20, talkPerDay: 60, doctrinePerDay: 12, briefingPerDay: 8, counselPerDay: 30 };

/** LLM_QUOTA_TALK_HOUR / _TALK_DAY / _DOCTRINE_DAY / _BRIEFING_DAY / _COUNSEL_DAY. */
export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): QuotaLimits {
  const n = (v: string | undefined, d: number): number => (v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return { talkPerHour: n(env.LLM_QUOTA_TALK_HOUR, DEFAULT_LIMITS.talkPerHour), talkPerDay: n(env.LLM_QUOTA_TALK_DAY, DEFAULT_LIMITS.talkPerDay), doctrinePerDay: n(env.LLM_QUOTA_DOCTRINE_DAY, DEFAULT_LIMITS.doctrinePerDay), briefingPerDay: n(env.LLM_QUOTA_BRIEFING_DAY, DEFAULT_LIMITS.briefingPerDay), counselPerDay: n(env.LLM_QUOTA_COUNSEL_DAY, DEFAULT_LIMITS.counselPerDay) };
}

export type QuotaKind = 'talk' | 'doctrine' | 'briefing' | 'counsel';

interface Bucket { hour: number; day: number; talkHour: number; talkDay: number; doctrineDay: number; briefingDay: number; counselDay: number }

export class PlayerQuota {
  private buckets = new Map<string, Bucket>();
  constructor(readonly limits: QuotaLimits = DEFAULT_LIMITS, private readonly now: () => number = Date.now) {}

  private bucket(colony: string): Bucket {
    const t = this.now();
    const hour = Math.floor(t / 3600000), day = Math.floor(t / 86400000);
    let b = this.buckets.get(colony);
    if (!b || b.day !== day) { b = { hour, day, talkHour: 0, talkDay: 0, doctrineDay: 0, briefingDay: 0, counselDay: 0 }; this.buckets.set(colony, b); }
    if (b.hour !== hour) { b.hour = hour; b.talkHour = 0; }
    return b;
  }

  /** Consume one call if the quota allows; false means: answer in character, no model. */
  take(colony: string, kind: QuotaKind): boolean {
    const b = this.bucket(colony);
    switch (kind) {
      case 'talk': if (b.talkHour >= this.limits.talkPerHour || b.talkDay >= this.limits.talkPerDay) return false; b.talkHour++; b.talkDay++; return true;
      case 'doctrine': if (b.doctrineDay >= this.limits.doctrinePerDay) return false; b.doctrineDay++; return true;
      case 'briefing': if (b.briefingDay >= this.limits.briefingPerDay) return false; b.briefingDay++; return true;
      case 'counsel': if (b.counselDay >= this.limits.counselPerDay) return false; b.counselDay++; return true;
    }
  }

  remaining(colony: string): { talkHour: number; talkDay: number; doctrineDay: number; briefingDay: number; counselDay: number } {
    const b = this.bucket(colony);
    return { talkHour: this.limits.talkPerHour - b.talkHour, talkDay: this.limits.talkPerDay - b.talkDay, doctrineDay: this.limits.doctrinePerDay - b.doctrineDay, briefingDay: this.limits.briefingPerDay - b.briefingDay, counselDay: this.limits.counselPerDay - b.counselDay };
  }
}
