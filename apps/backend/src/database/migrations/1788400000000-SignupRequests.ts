import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Sign-up requests: people asking to join as a collector or an operator, held
 * until a member of staff approves or rejects them. See `SignupRequestEntity`
 * for the model and `SignupsService` for the rules.
 *
 * A new table rather than an "unapproved" flag on `users` and `collectors`:
 * those tables are read by sign-in, device pairing and payouts, and none of
 * those should ever have to know that unapproved people exist.
 *
 * The two partial unique indexes are the database's half of "one pending
 * request per email, and per collector phone". The service checks the same
 * thing first to give a readable message; the indexes are what holds when two
 * submissions arrive at the same instant. They cover pending rows only — a
 * decided request must not stop the same person signing up again — and are
 * declared with the same names and clauses on `SignupRequestEntity`, so a
 * generated migration sees no difference.
 *
 * Additive only: a new table with no rows, so nothing existing changes.
 */
export class SignupRequests1788400000000 implements MigrationInterface {
  name = "SignupRequests1788400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "signup_requests" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"role" character varying NOT NULL, ` +
        `"name" character varying NOT NULL, ` +
        `"phone" character varying NOT NULL, ` +
        `"email" character varying, ` +
        `"passwordHash" text, ` +
        `"hubId" uuid, ` +
        `"status" character varying NOT NULL DEFAULT 'pending', ` +
        `"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"decidedAt" TIMESTAMP WITH TIME ZONE, ` +
        `"decidedByUserId" uuid, ` +
        `"createdUserId" uuid, ` +
        `"createdCollectorId" uuid, ` +
        `CONSTRAINT "PK_signup_requests" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_signup_requests_status" ON "signup_requests" ("status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_signup_requests_pending_email" ON "signup_requests" ("email") ` +
        `WHERE "status" = 'pending' AND "email" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_signup_requests_pending_collector_phone" ON "signup_requests" ("phone") ` +
        `WHERE "status" = 'pending' AND "role" = 'collector'`,
    );
    await queryRunner.query(
      `ALTER TABLE "signup_requests" ADD CONSTRAINT "FK_signup_requests_hub" ` +
        `FOREIGN KEY ("hubId") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "signup_requests" ADD CONSTRAINT "FK_signup_requests_decided_by" ` +
        `FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "signup_requests" ADD CONSTRAINT "FK_signup_requests_created_user" ` +
        `FOREIGN KEY ("createdUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "signup_requests" ADD CONSTRAINT "FK_signup_requests_created_collector" ` +
        `FOREIGN KEY ("createdCollectorId") REFERENCES "collectors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "signup_requests" DROP CONSTRAINT "FK_signup_requests_created_collector"`,
    );
    await queryRunner.query(
      `ALTER TABLE "signup_requests" DROP CONSTRAINT "FK_signup_requests_created_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "signup_requests" DROP CONSTRAINT "FK_signup_requests_decided_by"`,
    );
    await queryRunner.query(`ALTER TABLE "signup_requests" DROP CONSTRAINT "FK_signup_requests_hub"`);
    await queryRunner.query(`DROP INDEX "IDX_signup_requests_pending_collector_phone"`);
    await queryRunner.query(`DROP INDEX "IDX_signup_requests_pending_email"`);
    await queryRunner.query(`DROP INDEX "IDX_signup_requests_status"`);
    await queryRunner.query(`DROP TABLE "signup_requests"`);
  }
}
