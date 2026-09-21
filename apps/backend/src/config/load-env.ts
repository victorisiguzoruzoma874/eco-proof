import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

/**
 * Where `.env` actually lives, in one place.
 *
 * Every entry point — the app, the migration CLI, the seeder, the admin
 * creator — used to call a bare `loadDotenv()`, which resolves `.env` against
 * `process.cwd()`. That works when you happen to be standing in
 * `apps/backend`, and silently does nothing when you are not. npm workspace
 * scripts run in the workspace directory, so `npm run migrate` from the repo
 * root looked in `apps/backend`, found only `.env.example`, and failed with
 * "missing required environment variable: DATABASE_URL" — a message that says
 * nothing about the real problem, which is that the file it wanted is one
 * directory up and was never read.
 *
 * So the search is anchored to this file's own location rather than to
 * wherever the process was launched from. The path is the same whether this
 * runs from `src/` (ts-node, migrations) or `dist/` (compiled): both sit four
 * levels below the repo root.
 *
 * Deployed environments are unaffected either way — Render, Vercel and the
 * like inject real environment variables, and dotenv never overwrites a
 * variable that is already set.
 */

/** `apps/backend/.env` first, then the repo root's. */
const CANDIDATES = [
  resolve(__dirname, "..", "..", ".env"),
  resolve(__dirname, "..", "..", "..", "..", ".env"),
];

/**
 * Load environment files, nearest first.
 *
 * Order matters because dotenv does not overwrite a variable that already has
 * a value: the first file to define a key wins, so a backend-local `.env`
 * overrides the repo-root one rather than the other way round. That is the
 * behaviour someone would expect from the more specific file.
 *
 * Both files are optional. A machine with neither is not an error — that is
 * exactly what a deployed container looks like.
 */
export function loadEnvironment(): void {
  for (const path of CANDIDATES) {
    if (existsSync(path)) loadDotenv({ path });
  }
}
