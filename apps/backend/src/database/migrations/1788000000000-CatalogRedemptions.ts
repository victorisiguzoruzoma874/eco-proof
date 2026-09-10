import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One requester's redemption of a catalog item — see
 * `CatalogRedemptionEntity`'s doc comment for why this debits the wallet
 * immediately rather than at a later "paid" step the way
 * `withdrawal_requests` does. `costCredits` is copied from the item at
 * redemption time, not joined live, so a later price change never rewrites
 * the cost of a redemption already made.
 *
 * `requesterId` and `itemId` are both `ON DELETE RESTRICT`, matching the FK
 * policy used everywhere else in this schema for a row that is itself an
 * audit fact. `fulfilledByUserId` is nullable and `ON DELETE RESTRICT`, same
 * as `payouts.paidByUserId` / `withdrawal_requests.paidByUserId`.
 *
 * Must run after `1787900000000-CatalogItems` (FK to `catalog_items`).
 * Additive only: no existing table is touched.
 */
export class CatalogRedemptions1788000000000 implements MigrationInterface {
  name = "CatalogRedemptions1788000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "catalog_redemptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requesterId" uuid NOT NULL, "itemId" uuid NOT NULL, "costCredits" numeric(12,3) NOT NULL, "status" character varying NOT NULL DEFAULT 'pending_fulfillment', "fulfilledByUserId" uuid, "fulfilledAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_catalog_redemptions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_catalog_redemptions_requester" ON "catalog_redemptions" ("requesterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_catalog_redemptions_item" ON "catalog_redemptions" ("itemId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_redemptions" ADD CONSTRAINT "FK_catalog_redemptions_requester" FOREIGN KEY ("requesterId") REFERENCES "requesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_redemptions" ADD CONSTRAINT "FK_catalog_redemptions_item" FOREIGN KEY ("itemId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_redemptions" ADD CONSTRAINT "FK_catalog_redemptions_fulfilled_by_user" FOREIGN KEY ("fulfilledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog_redemptions" DROP CONSTRAINT "FK_catalog_redemptions_fulfilled_by_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_redemptions" DROP CONSTRAINT "FK_catalog_redemptions_item"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_redemptions" DROP CONSTRAINT "FK_catalog_redemptions_requester"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_catalog_redemptions_item"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_catalog_redemptions_requester"`);
    await queryRunner.query(`DROP TABLE "catalog_redemptions"`);
  }
}
