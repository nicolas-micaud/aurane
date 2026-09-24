// Accelerated season: hundreds of NPC colonies play weeks in minutes. This is the balancing
// instrument: inflation, blobs, faction dominance and dead starts show up here first.
import { runSeason, summarize, type SeasonOptions } from './season.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const opts: SeasonOptions = {
  seed: arg('seed', 'season-0'),
  days: Number(arg('days', '56')),
  colonies: Number(arg('colonies', '120')),
  radius: Number(arg('radius', '8')),
  decisionMinutes: Number(arg('decision', '30')),
};

const started = Date.now();
const world = runSeason(opts);
const report = summarize(world, opts);
report.wallSeconds = (Date.now() - started) / 1000;
console.log(JSON.stringify(report, null, 2));
if (report.anomalies.length) {
  console.error(`ANOMALIES: ${report.anomalies.join('; ')}`);
  process.exit(1);
}
