import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { WalletService } from "./wallet.service";
import { Public } from "../auth/auth.module";
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
  redeem(@CurrentRequester() requester: RequesterJwtPayload, @Body() dto: RedeemCodeDto) {
    return this.wallet.redeem(requester.sub, dto.redemptionCode);
  }
}
