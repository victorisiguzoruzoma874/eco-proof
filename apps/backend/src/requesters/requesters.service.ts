import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { RequesterEntity, WasteWalletEntity } from "../database/entities";
import { AuthService } from "../auth/auth.module";
import type { RegisterRequesterDto } from "../common/dto";

/**
 * A requester's verified token claims, as set by `RequesterAuthGuard`
 * (`requesters.module.ts`).
 *
 * `kind: "requester"` is the field that keeps this payload structurally
 * distinct from the operator `JwtPayload` in `auth.module.ts` (which has no
 * `kind` and instead carries `role`). Both are signed with the same
 * `JWT_SECRET`/`JwtService` (see `configuration.ts` — there is deliberately
 * only one secret), so the guards are what keep the two trust boundaries from
 * being interchangeable, not the signing key.
 */
export interface RequesterJwtPayload {
  sub: string;
  email: string;
  kind: "requester";
}

/** A requester's own profile, safe to return — no `passwordHash`. */
export interface SafeRequester {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  active: boolean;
  createdAt: Date;
}

function toSafeRequester(requester: RequesterEntity): SafeRequester {
  return {
    id: requester.id,
    name: requester.name,
    email: requester.email,
    phone: requester.phone,
    active: requester.active,
    createdAt: requester.createdAt,
  };
}

/**
 * argon2id hash of a random string; only ever used to equalise timing between
 * "no such requester" and "wrong password" on login, same technique as
 * `AuthService`'s own dummy hash in `auth.module.ts`. Kept as a separate
 * literal here rather than imported — the two trust boundaries should not
 * share so much as a constant that would make one file's edit silently affect
 * the other.
 */
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$3vC2N0YQ0kCq9K6l6H5t0aVQ0Yl7pWc0FhVv0eE2sLk";

/**
 * Self-service requester accounts — registration, login, profile. A
 * requester is a self-registering consumer asking for a pickup, a different
 * trust boundary from `UserEntity` (admin-provisioned operator/auditor
 * accounts handled by `AuthService`); see `RequesterEntity`'s doc comment in
 * `entities.ts`.
 */
@Injectable()
export class RequestersService {
  constructor(
    @InjectRepository(RequesterEntity)
    private readonly requesters: Repository<RequesterEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Register a requester and create their wallet in the same transaction —
   * the plan is explicit that a wallet always exists once a requester exists,
   * so there is no separate "create my wallet" step and no window where a
   * requester row exists without one.
   */
  async register(dto: RegisterRequesterDto): Promise<{ accessToken: string; requester: SafeRequester }> {
    const email = dto.email.toLowerCase();

    const existing = await this.requesters.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException(`an account with email ${email} already exists`);
    }

    const passwordHash = await AuthService.hashPassword(dto.password);

    const requester = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(RequesterEntity, {
          name: dto.name.trim(),
          email,
          passwordHash,
          phone: dto.phone?.trim() || null,
          active: true,
        }),
      );

      await manager.save(
        manager.create(WasteWalletEntity, {
          requesterId: saved.id,
        }),
      );

      return saved;
    });

    return this.issueToken(requester);
  }

  async login(email: string, password: string): Promise<{ accessToken: string; requester: SafeRequester }> {
    const requester = await this.requesters.findOne({ where: { email: email.toLowerCase() } });

    // Verify against a dummy hash when the requester is absent, same
    // no-enumeration technique as AuthService.validate.
    const hash = requester?.passwordHash ?? DUMMY_ARGON2_HASH;
    const ok = await argon2.verify(hash, password).catch(() => false);

    if (!requester || !ok || !requester.active) {
      throw new UnauthorizedException("invalid credentials");
    }

    return this.issueToken(requester);
  }

  async me(id: string): Promise<SafeRequester> {
    const requester = await this.requesters.findOne({ where: { id } });
    if (!requester) throw new NotFoundException(`requester ${id} not found`);
    return toSafeRequester(requester);
  }

  private async issueToken(
    requester: RequesterEntity,
  ): Promise<{ accessToken: string; requester: SafeRequester }> {
    const payload: RequesterJwtPayload = { sub: requester.id, email: requester.email, kind: "requester" };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, requester: toSafeRequester(requester) };
  }
}
