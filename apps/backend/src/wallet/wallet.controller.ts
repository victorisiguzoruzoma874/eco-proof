import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { WalletService } from "./wallet.service";
import { Public } from "../auth/auth.module";
import { RateLimit } from "../common/rate-limit.guard";
import { CurrentRequester, RequesterAuthGuard } from "../requesters/requester-auth.guard";
import type { RequesterJwtPayload } from "../requesters/requesters.service";
import { RedeemCodeDto } from "../common/dto";

@ApiTags("wallet")
@Controller("wallet")
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Public()
  @UseGuards(RequesterAuthGuard)
  @Get()
  getWallet(@CurrentRequester() requester: RequesterJwtPayload) {
    return this.wallet.getWallet(requester.sub);
  }

  @Public()
  @UseGuards(RequesterAuthGuard)
  @Post("redeem")
  @HttpCode(200)
  // A walk-in claim code is a bearer token (see claim-code.ts). At 50 bits it
  // is not guessable anyway; this keeps it that way by bounding how fast anyone
  // can try, while leaving room for someone scanning a run of sacks.
  @RateLimit(30, 60)
  redeem(@CurrentRequester() requester: RequesterJwtPayload, @Body() dto: RedeemCodeDto) {
    return this.wallet.redeem(requester.sub, dto.redemptionCode);
  }
}
