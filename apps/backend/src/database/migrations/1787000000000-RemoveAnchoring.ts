import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Removes the Stellar anchoring schema: `anchor_attempts` and `anchor_records`.
 *
 * The project no longer anchors batch roots on a public ledger — proof of a
 * weigh-in now rests on the signed event, the Merkle root, and (from this
 * point forward) a hub re-weigh and payout trail instead. Both tables are
 * dropped outright rather than left unused: an empty-but-present anchor table
 * would be a standing invitation for new code to read from it.
 *
 * This is a new migration rather than an edit to `InitialSchema.ts` or
 * `AnchorAttempts.ts`, per the project's convention of never rewriting history
 * that may already be applied to a live database.
 *
 * Order matters: `anchor_attempts` is dropped first because nothing else
 * references it, then `anchor_records`, whose FK (`FK_a71d181af4fad657dcd4b367e9d`)
 * and unique index (`IDX_a71d181af4fad657dcd4b367e9`) were established in
 * `InitialSchema.ts`.
 *
 * `down()` recreates both tables verbatim (constraint names included) so a
 * rollback restores the exact shape `InitialSchema.ts` + `AnchorAttempts.ts`
 * produced — but not the data, which is gone once `up()` runs.
 */
export class RemoveAnchoring1787000000000 implements MigrationInterface {
  name = "RemoveAnchoring1787000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "anchor_attempts" DROP CONSTRAINT "FK_anchor_attempts_batch"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_anchor_attempt_batch_time"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_anchor_attempts_batch"`);
    await queryRunner.query(`DROP TABLE "anchor_attempts"`);

    await queryRunner.query(
      `ALTER TABLE "anchor_records" DROP CONSTRAINT "FK_a71d181af4fad657dcd4b367e9d"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_a71d181af4fad657dcd4b367e9"`);
    await queryRunner.query(`DROP TABLE "anchor_records"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "anchor_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "batchId" uuid NOT NULL, "merkleRoot" character varying NOT NULL, "stellarTxHash" character varying NOT NULL, "stellarLedger" bigint NOT NULL, "network" character varying NOT NULL DEFAULT 'testnet', "dataEntryKey" character varying NOT NULL, "anchoredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_7dc14d551b125d295ba22b43582" UNIQUE ("stellarTxHash"), CONSTRAINT "REL_a71d181af4fad657dcd4b367e9" UNIQUE ("batchId"), CONSTRAINT "PK_b27ccac84fb6dd1a2b81c3d94fb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a71d181af4fad657dcd4b367e9" ON "anchor_records" ("batchId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "anchor_records" ADD CONSTRAINT "FK_a71d181af4fad657dcd4b367e9d" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "anchor_attempts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "batchId" uuid NOT NULL, "attemptNumber" integer NOT NULL, "outcome" character varying NOT NULL, "detail" text, "stellarTxHash" character varying, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_anchor_attempts_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_anchor_attempts_batch" ON "anchor_attempts" ("batchId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_anchor_attempt_batch_time" ON "anchor_attempts" ("batchId", "occurredAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "anchor_attempts" ADD CONSTRAINT "FK_anchor_attempts_batch" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
