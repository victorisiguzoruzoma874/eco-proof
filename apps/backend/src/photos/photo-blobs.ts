import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  static fromConfig(config: PhotoS3Config): S3Blobs {
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // The SDK's default flexible checksums are not implemented by every
      // S3-compatible provider. Integrity is already enforced above this
      // layer: the key is the sha256 the device signed.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    return new S3Blobs(client, config.bucket);
  }

  async write(key: string, bytes: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey(key),
        Body: bytes,
        // PhotosService re-derives the served type from the bytes, so nothing
        // relies on this; it is only what the provider's console shows.
        ContentType: "application/octet-stream",
      }),
    );
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey(key) }),
      );
      if (!object.Body) return null;
      return Buffer.from(await object.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey(key) }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

/** Keys are built with path.join; object keys are always "/"-separated. */
function objectKey(key: string): string {
  return key.split(sep).join("/");
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, $metadata } = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return name === "NoSuchKey" || name === "NotFound" || $metadata?.httpStatusCode === 404;
}
