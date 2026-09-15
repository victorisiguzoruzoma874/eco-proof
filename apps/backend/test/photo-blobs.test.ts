import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/configuration";
import { S3Blobs } from "../src/photos/photo-blobs";
import { PhotoStore } from "../src/photos/photo-store";

/**
 * S3Blobs is driven through the real SDK against a minimal path-style S3
 * endpoint, so these cover what a mocked client could not: the keys and URLs
 * that actually go over the wire, and how provider errors come back.
 */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const SHA = PhotoStore.sha256Of(JPEG);

const objects = new Map<string, Buffer>();
let failWith: number | null = null;
let server: Server;
let endpoint: string;

function blobs(): S3Blobs {
  return S3Blobs.fromConfig({
    bucket: "photos",
    endpoint,
    region: "auto",
    accessKeyId: "test",
    secretAccessKey: "test",
    forcePathStyle: true,
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://s3").pathname);
      if (failWith) {
        res.writeHead(failWith, { "content-type": "application/xml" });
        res.end("<Error><Code>AccessDenied</Code><Message>denied</Message></Error>");
        return;
      }
      if (req.method === "PUT") {
        objects.set(path, Buffer.concat(chunks));
        res.writeHead(200, { etag: '"etag"' });
        res.end();
        return;
      }
      const stored = objects.get(path);
      if (!stored) {
        res.writeHead(404, { "content-type": "application/xml" });
        res.end(req.method === "HEAD" ? undefined : "<Error><Code>NoSuchKey</Code></Error>");
        return;
      }
      res.writeHead(200, { "content-length": stored.byteLength });
      res.end(req.method === "HEAD" ? undefined : stored);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  objects.clear();
  failWith = null;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
});

describe("S3Blobs", () => {
  it("stores the photo under its fanned-out digest, '/'-separated on every OS", async () => {
    const store = new PhotoStore(blobs());

    await store.put(JPEG);

    expect([...objects.keys()]).toEqual([
      `/photos/${SHA.slice(0, 2)}/${SHA.slice(2, 4)}/${SHA}.bin`,
    ]);
  });

  it("reads back exactly the bytes it stored", async () => {
    const store = new PhotoStore(blobs());

    await store.put(JPEG);

    expect(await store.read(SHA)).toEqual(JPEG);
    expect(await store.has(SHA)).toBe(true);
  });

  it("reports a photo that was never stored as absent", async () => {
    const store = new PhotoStore(blobs());

    expect(await store.read("b".repeat(64))).toBeNull();
    expect(await store.has("b".repeat(64))).toBe(false);
  });

  it("throws on a provider failure rather than calling the photo missing", async () => {
    // A missing photo is logged as lost evidence; bad credentials or an outage
    // at the provider must surface as an error, not as that.
    const store = new PhotoStore(blobs());
    failWith = 403;

    await expect(store.read(SHA)).rejects.toThrow();
    await expect(store.has(SHA)).rejects.toThrow();
    await expect(store.put(JPEG)).rejects.toThrow();
  });
});

describe("photo storage config", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    // Required by loadConfig on its own account; never connected to here.
    process.env.DATABASE_URL = "postgres://unused:unused@localhost/unused";
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("uses the directory when no bucket is named", () => {
    delete process.env.PHOTO_S3_BUCKET;

    expect(loadConfig().photoS3).toBeNull();
  });

  it("refuses a bucket without credentials", () => {
    process.env.PHOTO_S3_BUCKET = "photos";
    delete process.env.PHOTO_S3_ACCESS_KEY_ID;
    delete process.env.PHOTO_S3_SECRET_ACCESS_KEY;

    expect(() => loadConfig()).toThrow(/PHOTO_S3_ACCESS_KEY_ID/);
  });

  it("defaults to path-style for a custom endpoint and virtual-hosted for AWS", () => {
    process.env.PHOTO_S3_BUCKET = "photos";
    process.env.PHOTO_S3_ACCESS_KEY_ID = "id";
    process.env.PHOTO_S3_SECRET_ACCESS_KEY = "secret";

    delete process.env.PHOTO_S3_ENDPOINT;
    expect(loadConfig().photoS3?.forcePathStyle).toBe(false);

    process.env.PHOTO_S3_ENDPOINT = "https://account.r2.cloudflarestorage.com";
    expect(loadConfig().photoS3).toMatchObject({ forcePathStyle: true, region: "auto" });

    process.env.PHOTO_S3_FORCE_PATH_STYLE = "false";
    expect(loadConfig().photoS3?.forcePathStyle).toBe(false);
  });
});
