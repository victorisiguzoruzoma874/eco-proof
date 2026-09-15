import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { PhotoS3Config } from "../config/configuration";

/**
 * Where PhotoStore's bytes physically live. Keys arrive already validated and
 * content-addressed (see PhotoStore.relativePathFor), so a backend only moves
 * bytes — it makes no decisions about naming or integrity.
 */
export interface PhotoBlobs {
  write(key: string, bytes: Buffer): Promise<void>;
  /** null only when there is no such object; any other failure throws. */
  read(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
}

/** A local directory: development, tests, and any host with a real volume. */
export class FileBlobs implements PhotoBlobs {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  absolutePathFor(key: string): string {
    return join(this.root, key);
  }

  async write(key: string, bytes: Buffer): Promise<void> {
    const absolute = this.absolutePathFor(key);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.absolutePathFor(key));
    } catch {
      // Absent or unreadable mean the same thing to a caller: there is no
      // photo to serve.
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.absolutePathFor(key))).isFile();
    } catch {
      return false;
    }
  }
}

/**
 * An S3-compatible bucket, for hosts whose own disk does not survive a
 * restart.
 *
 * Unlike FileBlobs, only a 404 reads as "absent". A network or credential
 * failure is thrown instead: PhotosService logs a missing photo as lost
 * evidence, and an outage at the provider must not be reported as that.
 */
export class S3Blobs implements PhotoBlobs {
  constructor(private readonly config: PhotoS3Config) {}

  static fromConfig(config: PhotoS3Config): S3Blobs {
    return new S3Blobs(config);
  }

  async write(key: string, bytes: Buffer): Promise<void> {
    const response = await signedRequest(this.config, "PUT", objectKey(key), bytes);
    if (!response.ok) throw await requestError(response);
  }

  async read(key: string): Promise<Buffer | null> {
    const response = await signedRequest(this.config, "GET", objectKey(key));
    if (response.status === 404) return null;
    if (!response.ok) throw await requestError(response);
    return Buffer.from(await response.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    const response = await signedRequest(this.config, "HEAD", objectKey(key));
    if (response.status === 404) return false;
    if (!response.ok) throw await requestError(response);
    return true;
  }
}

/** Keys are built with path.join; object keys are always "/"-separated. */
function objectKey(key: string): string {
  return key.split(sep).join("/");
}

async function requestError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => "");
  return new Error(`S3 request failed: ${response.status} ${response.statusText} ${body}`.trim());
}

/**
 * A minimal AWS Signature Version 4 client, just enough to PUT/GET/HEAD a
 * single object. R2, Supabase Storage, and every other S3-compatible
 * provider speak this same signing scheme, so no client library is needed
 * for a request shape this small.
 */
async function signedRequest(
  config: PhotoS3Config,
  method: "PUT" | "GET" | "HEAD",
  key: string,
  body?: Buffer,
): Promise<Response> {
  const endpoint = config.endpoint ?? `https://s3.${config.region}.amazonaws.com`;
  const url = new URL(endpoint);
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  if (config.forcePathStyle) {
    url.pathname = `/${config.bucket}/${encodedKey}`;
  } else {
    url.host = `${config.bucket}.${url.host}`;
    url.pathname = `/${encodedKey}`;
  }

  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (method === "PUT") {
    headers["content-type"] = "application/octet-stream";
  }

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key_ = signingKey(config.secretAccessKey, dateStamp, config.region);
  const signature = createHmac("sha256", key_).update(stringToSign, "utf8").digest("hex");

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method,
    headers,
    body: method === "PUT" ? payload : undefined,
  });
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = createHmac("sha256", `AWS4${secret}`).update(dateStamp, "utf8").digest();
  const kRegion = createHmac("sha256", kDate).update(region, "utf8").digest();
  const kService = createHmac("sha256", kRegion).update("s3", "utf8").digest();
  return createHmac("sha256", kService).update("aws4_request", "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
