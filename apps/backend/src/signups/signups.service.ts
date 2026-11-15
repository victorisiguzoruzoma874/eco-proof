import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, LessThanOrEqual, QueryFailedError } from "typeorm";
import {
  CollectorEntity,
  HubEntity,
  SignupRequestEntity,
  UserEntity,
  type SignupRole,
  type SignupStatus,
} from "../database/entities";
import { AuthService, type Role } from "../auth/auth.module";

/**
 * People asking to join as a collector or an operator.
 *
 * A sign-up is only ever a request. Nothing here lets an applicant sign in,
 * be paired to a device, or appear on the collector roster: those happen when
 * a member of staff approves the request, and not before. Operators and
 * collectors create the records that turn into payouts, which is why the door
 * is open to anyone but the room behind it is not.
 *
 * `POST /signups` is reachable by anyone on the internet, so two things bound
 * what a stranger can make it do:
 *  - a ceiling on how many requests may be pending at once, checked before the
 *    password is hashed, so neither the table nor argon2 can be driven
 *    without limit;
 *  - an expiry, so signing up with somebody else's email or phone cannot keep
 *    that person out for ever.
 */

export const SIGNUP_OPTIONS = "SIGNUP_OPTIONS";

export interface SignupOptions {
  /** How many requests may be pending at once. */
  maxPending?: number;
  /** The clock, injectable so expiry can be tested without waiting. */
  now?: () => Date;
}

export const SIGNUP_EXPIRY_DAYS = 14;
const DEFAULT_MAX_PENDING = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubmitSignupInput {
  role: SignupRole;
  name: string;
  phone: string;
  /** Operators only. */
  email?: string;
  /** Operators only. */
  password?: string;
  /** Collectors only. */
  hubId?: string;
}

/** What an applicant gets back — deliberately nothing they did not send. */
export interface SignupReceipt {
  id: string;
  role: SignupRole;
  name: string;
  status: "pending";
}

/** A request as staff see it — never the password hash. */
export interface SignupView {
  id: string;
  role: SignupRole;
  name: string;
  phone: string;
  email: string | null;
  hubId: string | null;
  hubName: string | null;
  status: SignupStatus;
  createdAt: string;
}

export interface SignupDecision {
  signup: SignupView;
  createdUserId: string | null;
  createdCollectorId: string | null;
}

/** Who is deciding. The role comes from `JwtAuthGuard`, which re-reads the row. */
export interface SignupActor {
  sub: string;
  role: Role;
}

const PENDING_EMAIL = "A sign-up with this email is already waiting for approval.";
const PENDING_PHONE = "A sign-up with this phone number is already waiting for approval.";

@Injectable()
export class SignupsService {
  private readonly maxPending: number;
  private readonly now: () => Date;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() @Inject(SIGNUP_OPTIONS) options?: SignupOptions,
  ) {
    this.maxPending = options?.maxPending ?? DEFAULT_MAX_PENDING;
    this.now = options?.now ?? (() => new Date());
  }

  async submit(input: SubmitSignupInput): Promise<SignupReceipt> {
    const name = input.name.trim();
    const phone = input.phone.trim();
    if (!name) throw new BadRequestException("name must not be empty");

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.expireStale(manager);

        const pending = await manager.count(SignupRequestEntity, { where: { status: "pending" } });
        if (pending >= this.maxPending) {
          throw new ServiceUnavailableException(
            "Sign-ups are paused for the moment. Please try again later.",
          );
        }

        const row =
          input.role === "operator"
            ? await this.operatorRequest(manager, input, name, phone)
            : await this.collectorRequest(manager, input, name, phone);

        const saved = await manager.save(row);
        return { id: saved.id, role: saved.role, name: saved.name, status: "pending" as const };
      });
    } catch (error) {
      // Two submissions at the same instant both pass the checks above; the
      // partial unique indexes are what stops the second, and this turns that
      // into the same message the check would have given.
      if (isUniqueViolation(error)) {
        throw new ConflictException(input.role === "operator" ? PENDING_EMAIL : PENDING_PHONE);
      }
      throw error;
    }
  }

  /** Requests still waiting for a decision that this member of staff may make. */
  async listPending(actor: SignupActor): Promise<SignupView[]> {
    const roles = decidableRoles(actor);

    return this.dataSource.transaction(async (manager) => {
      await this.expireStale(manager);

      const rows = await manager.find(SignupRequestEntity, {
        where: { status: "pending", role: In(roles) },
        order: { createdAt: "ASC" },
      });

      const hubIds = [...new Set(rows.map((r) => r.hubId).filter((id): id is string => !!id))];
      const hubs = hubIds.length ? await manager.find(HubEntity, { where: { id: In(hubIds) } }) : [];
      const hubNames = new Map(hubs.map((h) => [h.id, h.name]));

      return rows.map((row) => toView(row, row.hubId ? (hubNames.get(row.hubId) ?? null) : null));
    });
  }

  /**
   * Let an applicant in: create the real user or collector from the request.
   *
   * One transaction, with the request row locked, so two members of staff
   * pressing Approve together produce one account and one "already approved",
   * and so a request is never marked approved without the record it claims to
   * have created.
   */
  async approve(id: string, actor: SignupActor): Promise<SignupDecision> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const row = await this.lockPending(manager, id, actor);

        if (row.role === "operator") {
          // Both are always set on a pending operator request. The guard is
          // there for the type checker and for a row edited by hand.
          if (!row.email || !row.passwordHash) {
            throw new ConflictException("This sign-up is incomplete and cannot be approved.");
          }
          if (await manager.findOne(UserEntity, { where: { email: row.email } })) {
            throw new ConflictException(
              "An account with this email now exists. Reject this sign-up or ask the applicant to use another email.",
            );
          }
          const user = await manager.save(
            manager.create(UserEntity, {
              email: row.email,
              passwordHash: row.passwordHash,
              role: "operator",
              active: true,
            }),
          );
          row.createdUserId = user.id;
          // The hash now lives on the user; a second copy here is one more
          // place for it to leak from.
          row.passwordHash = null;
        } else {
          if (await manager.findOne(CollectorEntity, { where: { phone: row.phone } })) {
            throw new ConflictException(
              "A collector with this phone number now exists. Reject this sign-up.",
            );
          }
          const collector = await manager.save(
            manager.create(CollectorEntity, {
              name: row.name,
              phone: row.phone,
              cooperativeId: null,
              kycLevel: "none",
              active: true,
            }),
          );
          row.createdCollectorId = collector.id;
        }

        return this.decide(manager, row, "approved", actor);
      });
    } catch (error) {
      // Lost a race the row lock does not cover: the email or phone was taken
      // by another route between the check above and the insert.
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          "This sign-up could not be approved because its email or phone number is now in use.",
        );
      }
      throw error;
    }
  }

  async reject(id: string, actor: SignupActor): Promise<SignupDecision> {
    return this.dataSource.transaction(async (manager) => {
      const row = await this.lockPending(manager, id, actor);
      row.passwordHash = null;
      return this.decide(manager, row, "rejected", actor);
    });
  }

  private async operatorRequest(
    manager: EntityManager,
    input: SubmitSignupInput,
    name: string,
    phone: string,
  ): Promise<SignupRequestEntity> {
    // Lower-cased for the same reason UsersService.create does it: sign-in
    // looks the account up by lower-cased email.
    const email = input.email?.trim().toLowerCase();
    if (!email || !input.password) {
      throw new BadRequestException("an operator sign-up needs an email and a password");
    }

    if (await manager.findOne(UserEntity, { where: { email } })) {
      throw new ConflictException("An account with this email already exists.");
    }
    if (await manager.findOne(SignupRequestEntity, { where: { email, status: "pending" } })) {
      throw new ConflictException(PENDING_EMAIL);
    }

    return manager.create(SignupRequestEntity, {
      role: "operator",
      name,
      phone,
      email,
      passwordHash: await AuthService.hashPassword(input.password),
      hubId: null,
      status: "pending",
      createdAt: this.now(),
    });
  }

  private async collectorRequest(
    manager: EntityManager,
    input: SubmitSignupInput,
    name: string,
    phone: string,
  ): Promise<SignupRequestEntity> {
    if (!input.hubId) throw new BadRequestException("a collector sign-up needs a hub");

    if (!(await manager.findOne(HubEntity, { where: { id: input.hubId } }))) {
      throw new ConflictException("That hub is no longer available. Choose another hub.");
    }
    if (await manager.findOne(CollectorEntity, { where: { phone } })) {
      throw new ConflictException("A collector with this phone number already exists.");
    }
    if (
      await manager.findOne(SignupRequestEntity, {
        where: { phone, role: "collector", status: "pending" },
      })
    ) {
      throw new ConflictException(PENDING_PHONE);
    }

    // Collectors authenticate by device key, so anything sent as an email or
    // password is dropped, never stored.
    return manager.create(SignupRequestEntity, {
      role: "collector",
      name,
      phone,
      email: null,
      passwordHash: null,
      hubId: input.hubId,
      status: "pending",
      createdAt: this.now(),
    });
  }

  private async lockPending(
    manager: EntityManager,
    id: string,
    actor: SignupActor,
  ): Promise<SignupRequestEntity> {
    const roles = decidableRoles(actor);
    await this.expireStale(manager);

    const row = await manager.findOne(SignupRequestEntity, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (!row) throw new NotFoundException(`sign-up ${id} not found`);

    if (!roles.includes(row.role)) {
      throw new ForbiddenException("Only an admin can decide operator sign-ups.");
    }
    if (row.status !== "pending") {
      throw new ConflictException(`This sign-up has already been ${row.status}.`);
    }
    return row;
  }

  private async decide(
    manager: EntityManager,
    row: SignupRequestEntity,
    status: "approved" | "rejected",
    actor: SignupActor,
  ): Promise<SignupDecision> {
    row.status = status;
    row.decidedAt = this.now();
    row.decidedByUserId = actor.sub;
    const saved = await manager.save(row);

    const hub = saved.hubId
      ? await manager.findOne(HubEntity, { where: { id: saved.hubId } })
      : null;

    return {
      signup: toView(saved, hub?.name ?? null),
      createdUserId: saved.createdUserId ?? null,
      createdCollectorId: saved.createdCollectorId ?? null,
    };
  }

  /**
   * Retire requests nobody decided within `SIGNUP_EXPIRY_DAYS`.
   *
   * Run at the start of every operation instead of on a timer: there is no
   * scheduler in this service, and what matters is only that a stale request
   * is never counted, listed, approved or allowed to block a new one. All of
   * those pass through here first.
   */
  private async expireStale(manager: EntityManager): Promise<void> {
    const cutoff = new Date(this.now().getTime() - SIGNUP_EXPIRY_DAYS * DAY_MS);
    await manager.update(
      SignupRequestEntity,
      { status: "pending", createdAt: LessThanOrEqual(cutoff) },
      { status: "expired", passwordHash: null },
    );
  }
}

/**
 * Which kinds of request this member of staff may see and decide.
 *
 * Admins decide everything. Operators decide collector requests only (they
 * can already add a collector by hand, so this grants nothing new) and never
 * operator requests, because minting an operator account is the ability to
 * add weigh-ins to batches. Auditors are read-only everywhere and get nothing.
 */
function decidableRoles(actor: SignupActor): SignupRole[] {
  if (actor.role === "admin") return ["collector", "operator"];
  if (actor.role === "operator") return ["collector"];
  throw new ForbiddenException("Sign-ups are reviewed by admins and operators.");
}

function toView(row: SignupRequestEntity, hubName: string | null): SignupView {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    phone: row.phone,
    email: row.email,
    hubId: row.hubId,
    hubName,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === "23505"
  );
}
