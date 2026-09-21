import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  type CanActivate,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { createHash } from "node:crypto";
import {
  DEVICE_AUTH_HEADERS,
  isDeviceRequestFresh,
  verifyDeviceRequestSignature,
} from "@proofchain/shared";
import type { Request } from "express";
import { CollectorEntity, DeviceEntity } from "../database/entities";

/**
 * Who a device-signed request came from, as established by `DeviceAuthGuard`.
 *
 * `collectorId` is read from the *device row*, never from anything the caller
 * sent. A phone proves it holds a key; the server decides whose key that is.
 * Letting the request name its own collector would make the signature
 * decorative.
 */
export interface DeviceIdentity {
  deviceId: string;
  collectorId: string;
}

export const CurrentDevice = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DeviceIdentity => {
    const request = context.switchToHttp().getRequest<{ device?: DeviceIdentity }>();
    if (!request.device) {
      // Reachable only by using this decorator on a route without the guard.
      throw new UnauthorizedException("no authenticated device on this request");
    }
    return request.device;
  },
);

/**
 * Authenticate a request by its ed25519 device signature instead of a token.
 *
 * This is the read/write counterpart to weigh-in ingest, which authenticates
 * the same way for the same reason: a shared field phone must not carry a
 * standing bearer credential, and a token would expire while the device is
 * offline. The trade is that every protected call costs one signature
 * verification and one device lookup — cheap, and bounded by the same rate
 * limiting the ingest path already has.
 *
 * Deliberately NOT a global guard. It is applied per route, alongside
 * `@Public()` so the JWT guard steps aside, exactly as `RequesterAuthGuard`
 * is used for the requester-facing routes.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(DeviceEntity)
    private readonly devices: Repository<DeviceEntity>,
    @InjectRepository(CollectorEntity)
    private readonly collectors: Repository<CollectorEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { device?: DeviceIdentity }>();

    const deviceId = header(request, DEVICE_AUTH_HEADERS.deviceId);
    const timestamp = header(request, DEVICE_AUTH_HEADERS.timestamp);
    const nonce = header(request, DEVICE_AUTH_HEADERS.nonce);
    const signature = header(request, DEVICE_AUTH_HEADERS.signature);

    if (!deviceId || !timestamp || !nonce || !signature) {
      throw new UnauthorizedException("this endpoint requires a device-signed request");
    }

    // Checked before the database is touched: a flood of stale or replayed
    // signatures should cost a string parse, not a query per request.
    if (!isDeviceRequestFresh(timestamp, new Date())) {
      throw new UnauthorizedException(
        "device request timestamp is outside the accepted window — check the phone's clock",
      );
    }

    const device = await this.devices.findOne({ where: { id: deviceId } });

    // One message for every failure below. A caller probing this endpoint must
    // not be able to tell an unknown device id from a revoked one from a bad
    // signature — that would turn it into an enrolment oracle.
    const reject = () => new UnauthorizedException("device authentication failed");

    if (!device || device.revokedAt) throw reject();

    const collector = await this.collectors.findOne({ where: { id: device.collectorId } });
    if (!collector || !collector.active) throw reject();

    const ok = verifyDeviceRequestSignature(
      {
        method: request.method,
        // `originalUrl` carries the query string; the signature covers the path
        // only, so a job list stays signable without the device having to
        // predict how Express will render its own query parameters.
        path: pathOf(request),
        deviceId,
        timestamp,
        nonce,
        bodyHash: bodyHash(request),
      },
      signature,
      device.publicKeyBase64,
    );

    if (!ok) throw reject();

    request.device = { deviceId: device.id, collectorId: device.collectorId };
    return true;
  }
}

function header(request: Request, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function pathOf(request: Request): string {
  const url = request.originalUrl || request.url || "";
  const queryAt = url.indexOf("?");
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

/**
 * sha256 of the raw body, matching what the device hashed before signing.
 *
 * Re-serialising the parsed body would be wrong: `JSON.stringify` of a parsed
 * object is not guaranteed to reproduce the bytes that arrived, and any
 * difference in key order or number formatting would fail every signature. The
 * raw buffer captured by the body parser is the only safe source, so a
 * body-carrying route must be registered with `rawBody` enabled.
 */
function bodyHash(request: Request & { rawBody?: Buffer }): string {
  const raw = request.rawBody;
  if (!raw || raw.length === 0) return "";
  return createHash("sha256").update(raw).digest("hex");
}
