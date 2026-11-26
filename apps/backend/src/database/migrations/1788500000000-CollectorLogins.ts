import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Collector logins.
 *
 * Approving a collector sign-up now also creates a `users` row with role
 * `collector`, so the collector can sign in at `/auth/login` with the email
 * and password they signed up with. `collectorId` links that login to the
 * collector it speaks for: unique, because one collector has one login, and
 * nullable, because staff accounts have none.
 *
 * `users.role` is a plain varchar, so the new role needs no schema change; what
 * keeps a collector out of staff routes is `JwtAuthGuard`, not the column.
 *
 * Additive only: one nullable column, an index and a foreign key.
 */
export class CollectorLogins1788500000000 implements MigrationInterface {
  name = "CollectorLogins1788500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "collectorId" uuid`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_collector" ON "users" ("collectorId")`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_collector" ` +
        `FOREIGN KEY ("collectorId") REFERENCES "collectors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_collector"`);
    await queryRunner.query(`DROP INDEX "IDX_users_collector"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "collectorId"`);
  }
}
