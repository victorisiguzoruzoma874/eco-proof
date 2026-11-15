import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SignupsService } from "./signups.service";
import { CurrentUser, Public, Roles, type JwtPayload } from "../auth/auth.module";
import { RateLimit } from "../common/rate-limit.guard";
import { CreateSignupDto } from "../common/dto";

/**
 * Sign-up requests. One route is open to anyone (`POST /signups`); the rest
 * are for the staff who decide them. Which requests a given member of staff
 * may see and decide is the service's rule, not this controller's: `@Roles`
 * here only keeps auditors and the signed-out away from the routes at all.
 */
@ApiTags("signups")
@Controller("signups")
export class SignupsController {
  constructor(private readonly signups: SignupsService) {}

  @Public()
  // The dashboard posts this from its server, so everyone signing up through
  // the page shares one address, and refused attempts count as well as
  // accepted ones. The limit therefore has to clear a hub's whole onboarding
  // day arriving at once; it is a brake on a script, not a per-person quota.
  // What bounds a caller with many addresses is the ceiling on pending
  // requests in SignupsService, not this.
  @RateLimit(300, 600)
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Ask to join as a collector or an operator" })
  submit(@Body() dto: CreateSignupDto) {
    return this.signups.submit(dto);
  }

  @Roles("admin", "operator")
  @Get()
  @ApiOperation({ summary: "Sign-ups waiting for a decision" })
  listPending(@CurrentUser() user: JwtPayload) {
    return this.signups.listPending(user);
  }

  @Roles("admin", "operator")
  @Post(":id/approve")
  @HttpCode(200)
  @ApiOperation({ summary: "Approve a sign-up, creating the operator or collector" })
  approve(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.signups.approve(id, user);
  }

  @Roles("admin", "operator")
  @Post(":id/reject")
  @HttpCode(200)
  @ApiOperation({ summary: "Reject a sign-up" })
  reject(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.signups.reject(id, user);
  }
}
