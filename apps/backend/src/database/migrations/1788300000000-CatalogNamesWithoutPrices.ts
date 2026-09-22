import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Drop the leading price from catalog item names.
 *
 * The catalogue was seeded with names that carry their own price — "₦1,000
 * Airtime", "₦100 Airtime" — while both screens that render an item already
 * show the cost beside it: the operator table has a Cost column reading
 * "1,000 (₦1,000)", and the requester's rewards card prints the same figure
 * under the heading. So the price in the name was never the only copy of it,
 * only the one that could go stale, because `costCredits` is what redemption
 * actually charges and nothing kept the two in step.
 *
 * Data, not schema. It runs as a migration rather than a script because
 * migrations are applied at boot before the app serves (see
 * `main.ts`), so a deploy fixes existing rows without anyone remembering to
 * run anything, and the `migrations` table stops it running twice.
 *
 * The POSIX class `[[:space:]]` is used in place of `\s` deliberately: this
 * pattern lives in a TypeScript template literal, where `\s` is an
 * unrecognised escape and collapses to a bare `s` before Postgres ever sees
 * it. Writing the class out avoids a backslash-doubling trap that would
 * silently match the wrong thing.
 *
 * Names without a leading ₦ amount — "1GB Data Bundle" — are untouched: the
 * `WHERE` clause only selects rows that actually start with one.
 */
const PRICE_PREFIX = "^[[:space:]]*₦[[:space:]]*[0-9][0-9.,]*[[:space:]]*";

export class CatalogNamesWithoutPrices1788300000000 implements MigrationInterface {
  name = "CatalogNamesWithoutPrices1788300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "catalog_items"
          SET "name" = btrim(regexp_replace("name", $1, ''))
        WHERE "name" ~ $1
          AND btrim(regexp_replace("name", $1, '')) <> ''`,
      [PRICE_PREFIX],
    );
  }

  /**
   * Deliberately a no-op.
   *
   * The price could be rebuilt from `costCredits`, but which items carried one
   * in their name cannot: that fact only existed in the string this migration
   * consumed. Reconstructing it for every row would invent prefixes for items
   * ("1GB Data Bundle") that never had one, which is a worse outcome than
   * leaving the names as they are — and the price itself is not lost, it is in
   * `costCredits` and on both screens.
   *
   * A no-op rather than a throw so that rolling back a *later* migration is
   * not blocked by this one.
   */
  public async down(): Promise<void> {
    // Intentionally empty. See the doc comment above.
  }
}
