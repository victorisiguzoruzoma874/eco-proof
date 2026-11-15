import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { SignupsController } from "../src/signups/signups.controller";
import { CreateSignupDto } from "../src/common/dto";
import { IS_PUBLIC, ROLES_KEY } from "../src/auth/auth.module";
import { RATE_LIMIT_KEY } from "../src/common/rate-limit.guard";

/**
 * The HTTP edge of sign-up. `POST /signups` is the one route here a stranger
 * can reach, so what these pin is which routes are open, that the open one is
 * rate limited, and that the body is refused before it reaches the service
 * unless it is a complete request for exactly one of the two roles.
 */

/** What Nest's ValidationPipe does to the parsed body. */
function validate(body: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreateSignupDto, body);
  return validateSync(dto as object, { whitelist: true, forbidNonWhitelisted: true }).map(
    (e) => e.property,
  );
}

const HUB_ID = "e8ec812e-8ad6-43ec-a7ef-17dc87c7e710";
const collector = { role: "collector", name: "Amina Bello", phone: "+2348012345678", hubId: HUB_ID };
const operator = {
  role: "operator",
  name: "Tunde Okafor",
  phone: "+2348098765432",
  email: "tunde@example.com",
  password: "correct horse battery",
};

describe("SignupsController routes", () => {
  it("POST /signups is public and rate limited to 20 per 600 seconds", () => {
    const handler = SignupsController.prototype.submit;
    expect(Reflect.getMetadata(IS_PUBLIC, handler)).toBe(true);
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, handler)).toEqual({ limit: 20, windowSeconds: 600 });
  });

  it("the staff routes require admin or operator and are not public", () => {
    for (const handler of [
      SignupsController.prototype.listPending,
      SignupsController.prototype.approve,
      SignupsController.prototype.reject,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(["admin", "operator"]);
      expect(Reflect.getMetadata(IS_PUBLIC, handler)).toBeUndefined();
    }
  });

  it("passes the caller through to the service when deciding", async () => {
    const service = {
      submit: vi.fn(),
      listPending: vi.fn().mockResolvedValue([]),
      approve: vi.fn().mockResolvedValue({ ok: "approved" }),
      reject: vi.fn().mockResolvedValue({ ok: "rejected" }),
    };
    const controller = new SignupsController(service as never);
    const user = { sub: "admin-1", email: "a@x.test", role: "admin" as const };

    await controller.listPending(user);
    await controller.approve(HUB_ID, user);
    await controller.reject(HUB_ID, user);

    expect(service.listPending).toHaveBeenCalledWith(user);
    expect(service.approve).toHaveBeenCalledWith(HUB_ID, user);
    expect(service.reject).toHaveBeenCalledWith(HUB_ID, user);
  });
});

describe("CreateSignupDto", () => {
  it("accepts a complete collector sign-up with no email or password", () => {
    expect(validate(collector)).toEqual([]);
  });

  it("accepts a complete operator sign-up with no hub", () => {
    expect(validate(operator)).toEqual([]);
  });

  it("an operator sign-up without email or password fails validation", () => {
    const { email: _e, password: _p, ...rest } = operator;
    expect(validate(rest).sort()).toEqual(["email", "password"]);
  });

  it("a collector sign-up without hubId fails validation", () => {
    const { hubId: _h, ...rest } = collector;
    expect(validate(rest)).toEqual(["hubId"]);
  });

  it("rejects a role other than collector or operator", () => {
    expect(validate({ ...operator, role: "admin" })).toContain("role");
    expect(validate({ ...operator, role: "auditor" })).toContain("role");
    expect(validate({ ...collector, role: undefined })).toContain("role");
  });

  it("rejects an 11-character password and a malformed phone", () => {
    expect(validate({ ...operator, password: "elevenchars" })).toEqual(["password"]);
    expect(validate({ ...operator, phone: "0801 234 5678" })).toEqual(["phone"]);
    expect(validate({ ...collector, phone: "call me" })).toEqual(["phone"]);
  });

  it("rejects a blank name, an over-long name and a hub id that is not a uuid", () => {
    expect(validate({ ...collector, name: "" })).toEqual(["name"]);
    expect(validate({ ...collector, name: "x".repeat(201) })).toEqual(["name"]);
    expect(validate({ ...collector, hubId: "yaba" })).toEqual(["hubId"]);
  });

  it("rejects fields the form never sends", () => {
    expect(validate({ ...collector, status: "approved" })).toEqual(["status"]);
  });
});
