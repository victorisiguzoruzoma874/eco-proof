import { Logger, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { ALL_ENTITIES } from "./database/entities";
import { isInMemoryMode } from "./database/in-memory-flag";
import { migrateOnBoot } from "./database/migrate-on-boot";
import { loadConfig } from "./config/configuration";
import { AuthModule, JwtAuthGuard } from "./auth/auth.module";
import { AuthController } from "./auth/auth.controller";
import { HealthController } from "./health/health.controller";
import { RootController } from "./health/root.controller";
import { RegistryModule } from "./collectors/registry.module";
import { UsersModule } from "./users/users.module";
import { EventsModule } from "./events/events.module";
import { PhotosModule } from "./photos/photos.module";
import { BatchesModule } from "./batches/batches.module";
import { CustodyModule } from "./custody/custody.module";
import { ReportsModule } from "./reports/reports.module";
import { MaterialsModule } from "./materials/materials.module";
import { ReweighModule } from "./reweigh/reweigh.module";
import { PayoutsModule } from "./payouts/payouts.module";
import { MaterialRatesModule } from "./material-rates/material-rates.module";
import { RequestersModule } from "./requesters/requesters.module";
import { RequestsModule } from "./requests/requests.module";
import { WalletModule } from "./wallet/wallet.module";
import { CreditRatesModule } from "./credit-rates/credit-rates.module";
import { WithdrawalsModule } from "./withdrawals/withdrawals.module";
import { CatalogModule } from "./catalog/catalog.module";
import { RateLimitGuard } from "./common/rate-limit.guard";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadConfig] }),
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const config = loadConfig();
        return {
          type: "postgres" as const,
          url: config.database.url,
          // Managed Postgres (Neon, Supabase, RDS) refuses plaintext
          // connections. See database/postgres-connection.ts for why this is
          // resolved there rather than left to the URL's own sslmode.
          ssl: config.database.ssl,
          entities: ALL_ENTITIES,
          migrations: [`${__dirname}/database/migrations/*.{ts,js}`],
          // Never synchronize: this database is the evidentiary record behind
          // saleable credits, so schema changes go through reviewed migrations.
          synchronize: false,
          // Run explicitly in dataSourceFactory below, so the outcome is logged.
          migrationsRun: false,
          logging: process.env.TYPEORM_LOGGING === "true",
        };
      },
      // `--in-memory` (see database/in-memory-flag.ts) swaps the real Postgres
      // connection for an in-process pg-mem database — nothing else about the
      // options above changes, this only intercepts how the DataSource itself
      // gets built. Every other boot path (including production) falls
      // through to TypeORM's own default construction from `options`.
      dataSourceFactory: async (options) => {
        if (isInMemoryMode()) {
          // Loaded only on this path: pg-mem is a devDependency, so the pruned
          // production image does not have it, and a top-level import would
          // crash every production boot with "Cannot find module 'pg-mem'".
          const { createInMemoryDataSource } =
            require("./database/in-memory-datasource") as typeof import("./database/in-memory-datasource");
          return createInMemoryDataSource();
        }
        if (!options) {
          throw new Error("TypeORM did not provide connection options");
        }
        const dataSource = await new DataSource(options).initialize();
        // Before any module can query: see database/migrate-on-boot.ts.
        const logger = new Logger("migrations");
        await migrateOnBoot(dataSource, (message) => logger.log(message));
        return dataSource;
      },
    }),
    AuthModule,
    UsersModule,
    RegistryModule,
    EventsModule,
    PhotosModule,
    BatchesModule,
    CustodyModule,
    ReportsModule,
    MaterialsModule,
    ReweighModule,
    PayoutsModule,
    MaterialRatesModule,
    RequestersModule,
    RequestsModule,
    WalletModule,
    CreditRatesModule,
    WithdrawalsModule,
    CatalogModule,
  ],
  controllers: [RootController, AuthController, HealthController],
  providers: [
    // Authentication is on by default; routes opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Opt-in per route via @RateLimit(...); a no-op everywhere else.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
