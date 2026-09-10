import "reflect-metadata";
import { config as loadDotenv } from "dotenv";

loadDotenv();

import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { DataSource } from "typeorm";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadConfig } from "./config/configuration";
import { isAllowedOrigin } from "./config/cors";
import { trustProxyWarning } from "./config/trust-proxy";
import { isInMemoryMode } from "./database/in-memory-flag";
import { seedDevelopmentData } from "./database/seed";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger("bootstrap");
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.use(helmet());

  // Must be set before any request is served: `req.ip` is what the login and
  // ingest rate limiters key on, and behind a load balancer it is the balancer's
  // address unless Express is told how many proxies to look past. See
  // config/trust-proxy.ts for why this is opt-in rather than always on.
  app.getHttpAdapter().getInstance().set("trust proxy", config.trustProxy);
  const proxyWarning = trustProxyWarning(config.trustProxy, config.nodeEnv === "production");
  if (proxyWarning) logger.warn(proxyWarning);

  // Production honours the allowlist alone; development additionally accepts
  // loopback and private-network origins so the capture PWA can be exercised
  // from a real phone. See config/cors.ts for why that distinction exists.
  const isProduction = config.nodeEnv === "production";
  app.enableCors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin ?? undefined, config.corsOrigins, isProduction)) {
        callback(null, true);
        return;
      }
      // Logged, because the browser only ever shows the operator "Failed to
      // fetch" — without this line the cause is invisible on both sides.
      logger.warn(`blocked cross-origin request from ${origin}`);
      callback(null, false);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Reject unknown fields outright: a device sending extra keys is either a
      // version mismatch or an attempt to smuggle unsigned data past us.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  if (config.nodeEnv !== "production") {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("ProofChain API")
        .setDescription("Verified waste-to-credit platform — MVP")
        .setVersion("0.1.0")
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup("docs", app, doc);
  }

  app.enableShutdownHooks();

  // `--in-memory`: app.module.ts already swapped the DataSource for a pg-mem
  // one with no data in it (synchronize() builds empty tables). Seed it here,
  // once, against the exact instance the app is serving from — there is no
  // separate `npm run seed` process for an in-memory database, since its data
  // would vanish the moment that process exited.
  if (isInMemoryMode()) {
    const dataSource = app.get(DataSource);
    await seedDevelopmentData(dataSource);
    logger.warn(
      "--in-memory: serving from a pg-mem database with no Postgres involved. " +
        "All data is lost on restart — this is a local dev convenience, never a deployment mode.",
    );
  }

  await app.listen(config.port, "0.0.0.0");
  // The docs are only mounted outside production, so naming them
  // unconditionally sends whoever reads a production boot log to a 404.
  const docsHint = config.nodeEnv === "production" ? "" : " — docs at /docs";
  logger.log(`ProofChain API listening on :${config.port} (${config.nodeEnv})${docsHint}`);
}

void bootstrap();
