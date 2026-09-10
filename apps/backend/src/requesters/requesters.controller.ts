import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequestersService, type RequesterJwtPayload } from "./requesters.service";
import { CurrentRequester, RequesterAuthGuard } from "./requester-auth.guard";
import { Public } from "../auth/auth.module";
import { RateLimit } from "../common/rate-limit.guard";
import { RegisterRequesterDto, RequesterLoginDto } from "../common/dto";

@ApiTags("requesters")
@Controller("requesters")
export class RequestersController {
  constructor(private readonly requesters: RequestersService) {}

  @Public()
  @Post("register")
  @HttpCode(201)
  register(@Body() dto: RegisterRequesterDto) {
    return this.requesters.register(dto);
  }

  @Public()
  // Same reasoning as POST /auth/login's rate limit: bounds credential-guessing
  // throughput, not just brute force in general.
  @RateLimit(10, 60)
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: RequesterLoginDto) {
    return this.requesters.login(dto.email, dto.password);
  }

  /**
   * Who the presented requester token belongs to, as the database sees them
   * right now — `RequesterAuthGuard` re-reads the row, so a deactivated
   * requester does not get a stale answer from their own token.
   */
  @Public()
  @UseGuards(RequesterAuthGuard)
  @Get("me")
  me(@CurrentRequester() requester: RequesterJwtPayload) {
    return this.requesters.me(requester.sub);
  }
}
