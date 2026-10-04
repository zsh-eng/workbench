import { env, applyD1Migrations } from "cloudflare:test";
await applyD1Migrations(env.DATABASE, env.TEST_MIGRATIONS);
