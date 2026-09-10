import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { JwtService } from "@nestjs/jwt";
import { Repository } from "typeorm";
import type { Request } from "express";
import { RequesterEntity } from "../database/entities";
import type { RequesterJwtPayload } from "./requesters.service";

/**
 * The requester's verified token claims, as set by `RequesterAuthGuard`.
 *
 * Structurally the same idea as `CurrentUser()` in `auth.module.ts`, kept as
 * a *separate* decorator rather than a shared one on purpose: `CurrentUser()`
 * reads `request.user` (set only by `JwtAuthGuard`), this reads
 * `request.requester` (set only by `RequesterAuthGuard`) — two different
 * request properties for two trust boundaries that must never be confused.
 *
 * Deliberately its own file rather than living in `requesters.module.ts`
 * alongside the `@Module()` decorator: `requesters.module.ts` imports
 * `RequestersController`, and `requesters.controller.ts` needs this guard and
 * decorator — importing them from `requesters.module.ts` would make that a
 * circular require (module -> controller -> module), which under CommonJS
 * hands the controller a not-yet-initialised export and fails at boot with
 * `TypeError: CurrentRequester is not a function`. This file has no
 * dependency on either, so both can import it safely.
 */
export const CurrentRequester = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequesterJwtPayload => {
    const request = context.switchToHttp().getRequest<{ requester?: RequesterJwtPayload }>();
    if (!request.requester) {
      // Reachable only by putting @CurrentRequester() on a route with no
      // RequesterAuthGuard applied — a programming error, not a request one.
      throw new UnauthorizedException("no authenticated requester on this request");
    }
    return request.requester;
  },
);

/**
 * Guards requester-facing routes. Deliberately NOT the operator
 * `JwtAuthGuard` — it verifies with the same `JWT_SECRET`/`JwtService` (there
 * is only one secret, see `configuration.ts`), but only ever accepts a token
 * shaped like `RequesterJwtPayload` (`kind: "requester"`). An operator token
 * has no `kind` field at all and is rejected here; symmetrically, a requester
 * token has no `role` and would fail `JwtAuthGuard`'s own re-read of
 * `UserEntity` by `sub` (a requester id will not match any user row). Every
 * route this guard protects must also carry `@Public()` so the global
 * `JwtAuthGuard` (registered as `APP_GUARD` in `app.module.ts`) lets the
 * request through to this guard instead of rejecting it first for lacking an
 * operator bearer token.
 */
@Injectable()
export class RequesterAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(RequesterEntity) private readonly requesters: Repository<RequesterEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { requester?: RequesterJwtPayload }>();
    const header = request.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("missing bearer token");
    }

    let claims: RequesterJwtPayload;
    try {
      claims = await this.jwt.verifyAsync<RequesterJwtPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException("invalid or expired token");
    }

    if (claims.kind !== "requester") {
      throw new UnauthorizedException("this endpoint requires a requester token");
    }

    // Same "re-read the row, not the token" policy as JwtAuthGuard: a token
    // is a snapshot, so a deactivated requester's still-valid token must stop
    // working on the next request, not at the next login.
    const requester = await this.requesters.findOne({
      where: { id: claims.sub },
      select: { id: true, email: true, active: true },
    });

    if (!requester || !requester.active) {
      throw new UnauthorizedException("account is no longer active");
    }

    request.requester = { sub: requester.id, email: requester.email, kind: "requester" };
    return true;
  }
}
