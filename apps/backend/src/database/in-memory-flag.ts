/**
 * Whether the backend should run against `createInMemoryDataSource()` instead
 * of a real Postgres — opt in with `--in-memory` on the CLI, e.g.
 * `npm run start:inmemory -w @proofchain/backend`. A CLI flag rather than an
 * env var: it can never leak into a deployed container's environment the way
 * an env var could, and it's what `main.ts` and `app.module.ts` both check to
 * agree on the same answer without importing from each other.
 *
 * Refuses in production regardless of the flag — this is a development
 * convenience for a machine with no Postgres reachable, never a deployment
 * mode. See `database/in-memory-datasource.ts` for what it actually builds.
 */
export function isInMemoryMode(): boolean {
  const requested = process.argv.includes("--in-memory");
  if (requested && process.env.NODE_ENV === "production") {
    throw new Error("--in-memory is a development convenience; refusing to run it with NODE_ENV=production");
  }
  return requested;
}
