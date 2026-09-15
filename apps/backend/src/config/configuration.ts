import {
  resolvePostgresConnection,
  type PostgresConnection,
} from "../database/postgres-connection";
import { isInMemoryMode } from "../database/in-memory-flag";
import { parseTrustProxy, type TrustProxySetting } from "./trust-proxy";

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  /** Connection URL plus the resolved TLS settings; see postgres-connection.ts. */
  database: PostgresConnection;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigins: string[];
  /**
   * How many proxies sit in front of this service, if any. Decides whether
   * `req.ip` — and therefore every rate limit — reflects the real client.
   * See config/trust-proxy.ts.
   */
  trustProxy: TrustProxySetting;
  /**
   * Where weigh-in photo bytes are written.
   *
   * The column and this setting have existed since the first migration, but
   * nothing ever wrote to either: photoUri was hardcoded null and only the
   * sha256 was kept. That made the photo_present integrity check purely
   * structural — it proved the hash was well-formed, not that it corresponded
   * to any image an auditor could look at.
   */
  photoStorageDir: string;
  /**
   * An S3-compatible bucket for photo bytes (R2, Supabase Storage, S3, MinIO).
   * When set it replaces photoStorageDir: a host with an ephemeral filesystem
   * — Render's free plan, any container without a volume — would otherwise
   * lose every photo on restart, while the event rows kept claiming them.
   */
  photoS3: PhotoS3Config | null;
  /**
   * Ceiling on a single upload. A modern phone camera produces 2-6 MB; the
   * limit exists so an unauthenticated caller cannot fill the disk one
   * request at a time.
   */
  maxPhotoBytes: number;
  maxClockSkewSeconds: number;
}

export interface PhotoS3Config {
  bucket: string;
  /** Unset for AWS itself; the provider's S3 API URL for everyone else. */
  endpoint: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Supabase and MinIO only answer path-style (`endpoint/bucket/key`) URLs. */
  forcePathStyle: boolean;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

/**
 * Once a bucket is named, its credentials are required rather than optional:
 * a half-configured store would boot fine and then fail every upload.
 */
function loadPhotoS3Config(): PhotoS3Config | null {
  const bucket = process.env.PHOTO_S3_BUCKET?.trim();
  if (!bucket) return null;

  const endpoint = process.env.PHOTO_S3_ENDPOINT?.trim() || undefined;
  const pathStyle = process.env.PHOTO_S3_FORCE_PATH_STYLE?.trim().toLowerCase();
  return {
    bucket,
    endpoint,
    // R2 expects "auto"; AWS and Supabase need the bucket's real region.
    region: process.env.PHOTO_S3_REGION?.trim() || "auto",
    accessKeyId: required("PHOTO_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("PHOTO_S3_SECRET_ACCESS_KEY"),
    // Every non-AWS provider accepts path-style, and not all of them accept
    // virtual-hosted style, so a custom endpoint defaults to it.
    forcePathStyle: pathStyle ? pathStyle === "true" : endpoint !== undefined,
  };
}

/**
 * Fail fast at boot on missing configuration rather than at the first request.
 * The JWT secret is deliberately not defaulted in production — a shipped default
 * signing key is an authentication bypass, not a convenience.
 */
export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? "development") as AppConfig["nodeEnv"];
  const isProduction = nodeEnv === "production";

  const jwtSecret = isProduction
    ? required("JWT_SECRET")
    : (process.env.JWT_SECRET ?? "dev-secret");
  if (isProduction && jwtSecret === "change-me-in-production") {
    throw new Error("JWT_SECRET is still the placeholder value; set a real secret");
  }

  // `--in-memory` never opens a real Postgres connection (app.module.ts's
  // dataSourceFactory routes to pg-mem instead), so DATABASE_URL should not be
  // a required env var on that boot path — a placeholder that satisfies the
  // type is fine precisely because nothing reads it.
  const database: PostgresConnection = isInMemoryMode()
    ? { url: "postgres://unused:unused@in-memory/unused", ssl: false }
    : resolvePostgresConnection();

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 3000),
    database,
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3001")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    photoStorageDir: process.env.PHOTO_STORAGE_DIR ?? "./var/photos",
    photoS3: loadPhotoS3Config(),
    maxPhotoBytes: Number(process.env.MAX_PHOTO_BYTES ?? 8 * 1024 * 1024),
    maxClockSkewSeconds: Number(process.env.MAX_CLOCK_SKEW_SECONDS ?? 900),
  };
}
