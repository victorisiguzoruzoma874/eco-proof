import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager, LessThanOrEqual, QueryFailedError } from "typeorm";
import {
  CollectorEntity,
  HubEntity,
  SignupRequestEntity,
  UserEntity,
  type SignupRole,
} from "../database/entities";
import { AuthService } from "../auth/auth.module";

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
    // password is dropped rather than stored.
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

  /**
   * Retire requests nobody decided within `SIGNUP_EXPIRY_DAYS`.
   *
   * Run at the start of every operation instead of on a timer: there is no
   * scheduler in this service, and what matters is only that a stale request
   * is never counted, listed, approved or allowed to block a new one — all of
   * which pass through here first.
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

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === "23505"
  );
}
