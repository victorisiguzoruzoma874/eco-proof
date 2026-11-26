import "reflect-metadata";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import { SignupsService } from "../src/signups/signups.service";
import { AuthService, JwtAuthGuard, Roles, type Role } from "../src/auth/auth.module";
import { AuthController } from "../src/auth/auth.controller";
import { UsersService } from "../src/users/users.service";
import { CollectorEntity, UserEntity } from "../src/database/entities";
import { createTestDatabase, type TestDatabase } from "./support/database";
import { seedHub, type SeededHub } from "./support/fixtures";

/**
 * A collector approved through sign-up signs in with the same email and
 * password at `/auth/login`. That puts a stranger's account in the same
 * `users` table as staff, so what matters most here is that it reaches
 * nothing a staff member can: every route is closed to a collector unless it
 * names `collector` in `@Roles`.
 */

const PASSWORD = "correct horse battery";
const EMAIL = "amina@example.com";

let db: TestDatabase;
let seeded: SeededHub;
let jwt: JwtService;

beforeEach(async () => {
  db ??= await createTestDatabase();
  await db.reset();
  seeded = await seedHub(db.dataSource);
  jwt = new JwtService({ secret: "t" });
});

afterAll(async () => {
  await db?.close();
});

const users = () => db.dataSource.getRepository(UserEntity);
const collectors = () => db.dataSource.getRepository(CollectorEntity);
const auth = () => new AuthService(users(), jwt);

let adminSeq = 0;
async function admin(): Promise<{ sub: string; role: Role; email: string }> {
  adminSeq += 1;
  const email = `admin${adminSeq}@staff.example.com`;
  const user = await users().save({
    email,
    passwordHash: "x",
    role: "admin",
    active: true,
  } as UserEntity);
  return { sub: user.id, role: "admin", email };
}

/** Sign up and get approved, the way a real collector does. */
async function approvedCollector(): Promise<{
  token: string;
  userId: string;
  collectorId: string;
}> {
  const signups = new SignupsService(db.dataSource);
  const receipt = await signups.submit({
    role: "collector",
    name: "Amina Bello",
    phone: "+2348012345678",
    email: EMAIL,
    password: PASSWORD,
    hubId: seeded.hub.id,
  });
  const decision = await signups.approve(receipt.id, await admin());
  const { accessToken } = await auth().login(EMAIL, PASSWORD);
  return {
    token: accessToken,
    userId: decision.createdUserId!,
    collectorId: decision.createdCollectorId!,
  };
}

// Stand-in route handlers: the guard reads only their `@Roles` metadata.
class Routes {
  noRoles() {}
  @Roles("admin", "operator", "auditor")
  staffOnly() {}
  @Roles("admin", "operator", "auditor", "collector")
  everyone() {}
}

function contextFor(handler: () => void, token: string): ExecutionContext {
  const request = { headers: { authorization: `Bearer ${token}` } };
  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guard() {
  return new JwtAuthGuard(jwt, new Reflector(), users());
}

describe("collector login", () => {
  it("signs in with the email and password from the sign-up form", async () => {
    await approvedCollector();
    await expect(auth().login("Amina@Example.com", PASSWORD)).resolves.toMatchObject({
      role: "collector",
    });
  });

  it("cannot sign in before approval", async () => {
    await new SignupsService(db.dataSource).submit({
      role: "collector",
      name: "Amina Bello",
      phone: "+2348012345678",
      email: EMAIL,
      password: PASSWORD,
      hubId: seeded.hub.id,
    });
    await expect(auth().login(EMAIL, PASSWORD)).rejects.toThrow(UnauthorizedException);
  });

  it("is refused on a route with no @Roles, which any staff member may use", async () => {
    const { token } = await approvedCollector();
    await expect(guard().canActivate(contextFor(Routes.prototype.noRoles, token))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("is refused on a staff-only route", async () => {
    const { token } = await approvedCollector();
    await expect(
      guard().canActivate(contextFor(Routes.prototype.staffOnly, token)),
    ).rejects.toThrow(ForbiddenException);
  });

  it("is let through on a route that names collector", async () => {
    const { token } = await approvedCollector();
    await expect(guard().canActivate(contextFor(Routes.prototype.everyone, token))).resolves.toBe(
      true,
    );
  });

  it("stops working once its collector is deactivated", async () => {
    const { token, collectorId } = await approvedCollector();
    await collectors().update({ id: collectorId }, { active: false });
    await expect(guard().canActivate(contextFor(Routes.prototype.everyone, token))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("still lets staff through on a route with no @Roles", async () => {
    const { sub, email } = await admin();
    const token = await jwt.signAsync({ sub, email, role: "admin" });
    await expect(guard().canActivate(contextFor(Routes.prototype.noRoles, token))).resolves.toBe(
      true,
    );
  });

  it("GET /auth/me and POST /auth/password are open to collectors", () => {
    for (const handler of [AuthController.prototype.me, AuthController.prototype.changePassword]) {
      expect(Reflect.getMetadata("roles", handler)).toContain("collector");
    }
  });

  it("GET /auth/me shows the collector the login belongs to", async () => {
    const { userId, collectorId } = await approvedCollector();
    const controller = new AuthController(auth(), new UsersService(users(), db.dataSource));
    await expect(controller.me({ sub: userId, email: EMAIL, role: "collector" })).resolves.toEqual({
      id: userId,
      email: EMAIL,
      role: "collector",
      collector: { id: collectorId, name: "Amina Bello", phone: "+2348012345678" },
    });
  });

  it("an admin cannot turn a collector login into a staff account", async () => {
    const { userId } = await approvedCollector();
    const actor = await admin();
    const service = new UsersService(users(), db.dataSource);
    await expect(service.update(userId, { role: "operator" }, actor)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.update(userId, { active: false }, actor)).resolves.toMatchObject({
      active: false,
    });
  });
});
