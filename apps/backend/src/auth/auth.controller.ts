import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ALL_ROLES, AuthService, CurrentUser, Public, Roles, type JwtPayload } from "./auth.module";
import { ChangePasswordDto, LoginDto } from "../common/dto";
import { RateLimit } from "../common/rate-limit.guard";
import { UsersService } from "../users/users.service";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  // Timing-safe comparison in AuthService stops user enumeration, not brute
  // force; this bounds how many password guesses an attacker gets per IP.
  @RateLimit(10, 60)
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /**
   * Who the presented token belongs to, as the database sees them right now —
   * `JwtAuthGuard` re-reads the row, so a demoted or deactivated user does not
   * get a stale answer from their own token.
   */
  @Roles(...ALL_ROLES)
  @Get("me")
  async me(@CurrentUser() user: JwtPayload) {
    const me = { id: user.sub, email: user.email, role: user.role };
    if (user.role !== "collector") return me;
    return { ...me, collector: await this.users.collectorProfile(user.sub) };
  }

  /**
   * Self-service password change. Rate-limited because the endpoint accepts the
   * current password: a stolen or borrowed session must not become an offline
   * -speed oracle for guessing the credential itself.
   */
  @Roles(...ALL_ROLES)
  @RateLimit(5, 300)
  @Post("password")
  @HttpCode(200)
  @ApiOperation({ summary: "Change your own password" })
  changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    return this.users.changeOwnPassword(user.sub, dto.currentPassword, dto.newPassword);
  }
}
