import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A requester's cash-out request against their wallet — mirrors the
 * `payouts` table's `pending -> paid` pattern exactly (see
 * `WithdrawalRequestEntity`'s doc comment): the debit against
 * `wallet_transactions` is written only at `mark-paid` time, never at
 * request time, so a manual payout that falls through never leaves a wallet
 * showing a debit for cash the requester never received.
 *
 * `requesterId` is `ON DELETE RESTRICT`, same as every other FK to
 * `requesters` in this schema — a requester with an open or historical
 * withdrawal must not vanish out from under it. `paidByUserId` is nullable
 * and `ON DELETE RESTRICT`, same as `payouts.paidByUserId`.
 *
 * Additive only: no existing table is touched.
 */
export class WithdrawalRequests1787800000000 implements MigrationInterface {
  name = "WithdrawalRequests1787800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "withdrawal_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requesterId" uuid NOT NULL, "amountCredits" numeric(12,3) NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "payoutRef" character varying, "paidByUserId" uuid, "paidAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_withdrawal_requests_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_withdrawal_requests_requester" ON "withdrawal_requests" ("requesterId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "FK_withdrawal_requests_requester" FOREIGN KEY ("requesterId") REFERENCES "requesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "FK_withdrawal_requests_paid_by_user" FOREIGN KEY ("paidByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "withdrawal_requests" DROP CONSTRAINT "FK_withdrawal_requests_paid_by_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "withdrawal_requests" DROP CONSTRAINT "FK_withdrawal_requests_requester"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_withdrawal_requests_requester"`);
    await queryRunner.query(`DROP TABLE "withdrawal_requests"`);
  }
}
