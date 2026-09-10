import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A requester's waste wallet and its transaction ledger.
 *
 * Two tables, added together because `wallet_transactions` cannot exist
 * without `waste_wallets` — matching the `payouts` + `payout_items`
 * precedent. `waste_wallets` is one account row per requester (unique
 * `requesterId`, `ON DELETE RESTRICT` — one wallet per requester, and a
 * requester with a wallet must not vanish out from under it); it
 * deliberately has no balance column. Balance is ALWAYS
 * `SUM(wallet_transactions."amountCredits")` filtered by `type` for a
 * wallet, computed on read — this mirrors the codebase's existing
 * "recompute from source rows" convention (audit totals, the Merkle root),
 * and avoids balance/ledger drift entirely by construction.
 *
 * `wallet_transactions.walletId` is `ON DELETE CASCADE` — a transaction has
 * no meaning without its wallet, and keeping orphans would block a wallet
 * from ever being removed (matches the `payout_items` -> `payouts`
 * precedent). `collectionRequestId` / `eventId` are `ON DELETE RESTRICT` and
 * nullable — a transaction usually cites the request/event it was credited
 * for, but neither is required, keeping this table usable for other credit
 * sources later without a schema change.
 *
 * Additive only: no existing table is touched.
 */
export class WasteWallets1787600000000 implements MigrationInterface {
  name = "WasteWallets1787600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "waste_wallets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requesterId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_waste_wallets_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_waste_wallets_requester" ON "waste_wallets" ("requesterId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "waste_wallets" ADD CONSTRAINT "FK_waste_wallets_requester" FOREIGN KEY ("requesterId") REFERENCES "requesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "wallet_transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "walletId" uuid NOT NULL, "type" character varying NOT NULL, "amountCredits" numeric(12,3) NOT NULL, "collectionRequestId" uuid, "eventId" uuid, "description" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_wallet_transactions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_transactions_wallet" ON "wallet_transactions" ("walletId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_transactions_collection_request" ON "wallet_transactions" ("collectionRequestId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_transactions_event" ON "wallet_transactions" ("eventId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD CONSTRAINT "FK_wallet_transactions_wallet" FOREIGN KEY ("walletId") REFERENCES "waste_wallets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD CONSTRAINT "FK_wallet_transactions_collection_request" FOREIGN KEY ("collectionRequestId") REFERENCES "collection_requests"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD CONSTRAINT "FK_wallet_transactions_event" FOREIGN KEY ("eventId") REFERENCES "collection_events"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP CONSTRAINT "FK_wallet_transactions_event"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP CONSTRAINT "FK_wallet_transactions_collection_request"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP CONSTRAINT "FK_wallet_transactions_wallet"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_wallet_transactions_event"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_wallet_transactions_collection_request"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_wallet_transactions_wallet"`);
    await queryRunner.query(`DROP TABLE "wallet_transactions"`);

    await queryRunner.query(`ALTER TABLE "waste_wallets" DROP CONSTRAINT "FK_waste_wallets_requester"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_waste_wallets_requester"`);
    await queryRunner.query(`DROP TABLE "waste_wallets"`);
  }
}
