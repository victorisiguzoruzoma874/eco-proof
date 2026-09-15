import { createHash } from "node:crypto";
import { join } from "node:path";
import { Injectable, Optional } from "@nestjs/common";
import { loadConfig } from "../config/configuration";
import { FileBlobs, S3Blobs, type PhotoBlobs } from "./photo-blobs";

/**
 * Content-addressed storage for weigh-in photo bytes.
 *
 * The file's name IS its sha256, which is the same digest the collector's
 * device signed into the weigh-in payload. That has three consequences worth
 * stating, because they are the reasons for the design:
 *
 *  1. A stored photo cannot drift from the record that references it. Changing
 *     one byte changes the path, so a tampered image is not a modified photo —
 *     it is a different photo that no event points at.
 *  2. Two collectors photographing the same scene, or one device retrying an
 *     upload, write the same bytes to the same path. Storing it twice is a
 *     no-op rather than a conflict.
 *  3. Nothing about the path is guessable from an event id, so the store does
 *     not leak "which weigh-ins have photos" to anyone who can list a directory.
 */

export interface StoredPhoto {
  sha256: string;
  bytes: number;
  /** Path relative to the storage root — what goes in photoUri. */
  relativePath: string;
}

@Injectable()
export class PhotoStore {
  private readonly blobs: PhotoBlobs;

  /**
   * The override is for tests: a directory path, or any PhotoBlobs. Otherwise
   * the configured bucket wins over the directory — see
   * AppConfig.photoS3. `@Optional()` keeps Nest from trying to inject a value
   * for it at boot.
   */
  constructor(@Optional() override?: string | PhotoBlobs) {
    if (typeof override === "string") {
      this.blobs = new FileBlobs(override);
    } else if (override) {
      this.blobs = override;
    } else {
      const config = loadConfig();
      this.blobs = config.photoS3
        ? S3Blobs.fromConfig(config.photoS3)
        : new FileBlobs(config.photoStorageDir);
    }
  }

  static sha256Of(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  /**
   * Fanned out two levels on the first four hex characters.
   *
   * A single flat directory holding a pilot's worth of photos is slow to list
   * and unpleasant to back up; 256 × 256 buckets keeps any one directory small
   * without needing a migration later. The same path is the object key when
   * the store is a bucket.
   */
  static relativePathFor(sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error(`not a sha256 digest: ${sha256}`);
    }
    return join(sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}.bin`);
  }

  /** Only meaningful for a directory-backed store. */
  absolutePathFor(sha256: string): string {
    if (!(this.blobs instanceof FileBlobs)) {
      throw new Error("photos are not stored on the local filesystem");
    }
    return this.blobs.absolutePathFor(PhotoStore.relativePathFor(sha256));
  }

  /** Writes the bytes under their own digest. Safe to call repeatedly. */
  async put(bytes: Buffer): Promise<StoredPhoto> {
    const sha256 = PhotoStore.sha256Of(bytes);
    const relativePath = PhotoStore.relativePathFor(sha256);

    await this.blobs.write(relativePath, bytes);

    return { sha256, bytes: bytes.byteLength, relativePath };
  }

  async read(sha256: string): Promise<Buffer | null> {
    // A bad digest is reached from a URL parameter; its honest answer is "no
    // such photo", not an error.
    const relativePath = PhotoStore.pathIfValid(sha256);
    return relativePath ? this.blobs.read(relativePath) : null;
  }

  async has(sha256: string): Promise<boolean> {
    const relativePath = PhotoStore.pathIfValid(sha256);
    return relativePath ? this.blobs.exists(relativePath) : false;
  }

  private static pathIfValid(sha256: string): string | null {
    try {
      return PhotoStore.relativePathFor(sha256);
    } catch {
      return null;
    }
  }
}
