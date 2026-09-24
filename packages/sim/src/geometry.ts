export interface Point { x: number; y: number }
export interface Circle extends Point { r: number }

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Shortest distance from point p to segment [a, b]. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Length of the part of segment [a, b] that lies inside circle c. */
export function segmentLengthInCircle(a: Point, b: Point, c: Circle): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - c.x, fy = a.y - c.y;
  const A = dx * dx + dy * dy;
  if (A === 0) return 0;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return 0;
  const sq = Math.sqrt(disc);
  const t1 = Math.max(0, (-B - sq) / (2 * A));
  const t2 = Math.min(1, (-B + sq) / (2 * A));
  return t2 > t1 ? (t2 - t1) * Math.sqrt(A) : 0;
}
