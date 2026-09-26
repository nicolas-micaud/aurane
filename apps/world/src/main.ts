import { loadConfig } from './config.js';
import { Engine } from './engine.js';
import { createHttpServer } from './http.js';
import { mailerFromEnv } from './mail.js';
import { FileStore, PgStore, type Store } from './store.js';
import { FileBudgetStore, FileJobStore, FileMemoryStore, FilePendingDoctrineStore, PgBudgetStore, PgJobStore, PgMemoryStore, PgPendingDoctrineStore } from './llmstore.js';
import type { GeneralDeps } from './general.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  let store: Store;
  let general: Partial<GeneralDeps>;
  if (cfg.databaseUrl) {
    const pgStore = new PgStore(cfg.databaseUrl);
    await pgStore.migrate();
    await PgJobStore.migrate(pgStore.pgPool);
    await PgBudgetStore.migrate(pgStore.pgPool);
    await PgPendingDoctrineStore.migrate(pgStore.pgPool);
    store = pgStore;
    general = { jobStore: new PgJobStore(pgStore.pgPool), memoryStore: new PgMemoryStore(pgStore.pgPool), budgetStore: new PgBudgetStore(pgStore.pgPool), pendingStore: new PgPendingDoctrineStore(pgStore.pgPool) };
  } else {
    store = new FileStore(cfg.snapshotDir);
    general = { jobStore: new FileJobStore(cfg.snapshotDir), memoryStore: new FileMemoryStore(cfg.snapshotDir), budgetStore: new FileBudgetStore(cfg.snapshotDir), pendingStore: new FilePendingDoctrineStore(cfg.snapshotDir) };
  }
  const engine = new Engine(cfg, store, general);
  await engine.init();
  await engine.general.init();
  engine.start();
  const mailer = mailerFromEnv();
  const server = createHttpServer(engine, { mailer });
  server.listen(cfg.port, cfg.host, () => {
    console.log(JSON.stringify({ msg: 'world up', host: cfg.host, port: cfg.port, seed: cfg.seasonSeed, timeScale: cfg.timeScale, store: cfg.databaseUrl ? 'postgres' : 'file', colonies: Object.keys(engine.world.colonies).length, llm: { voice: engine.general.stack.voice?.name ?? null, narrative: engine.general.stack.narrative?.name ?? null, doctrineConfirm: cfg.doctrineConfirm, budget: engine.general.metrics.spend(), memory: cfg.memoryUrl ? 'postgres+instance' : 'postgres' }, mail: mailer.kind }));
  });
  const shutdown = async (): Promise<void> => {
    console.log(JSON.stringify({ msg: 'shutting down' }));
    server.close();
    await engine.stop();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => { console.error(err); process.exit(1); });
