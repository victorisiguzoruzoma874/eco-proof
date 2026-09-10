import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { WithdrawalsService } from "./withdrawals.service";
import { CurrentUser, Public, Roles, type JwtPayload } from "../auth/auth.module";
import { CurrentRequester, RequesterAuthGuard } from "../requesters/requester-auth.guard";
import type { RequesterJwtPayload } from "../requesters/requesters.service";
import { MarkWithdrawalPaidDto, RequestWithdrawalDto } from "../common/dto";

/**
 * Mounted under `/wallet`, same as `WalletController` — this is the same
 * resource from the requester's point of view (their wallet, cashing out),
 * just split into its own controller/module because withdrawals need their
 * own `pending -> paid/rejected` operator queue, distinct from the
 * catalog-redemption queue in `CatalogModule`.
 */
@ApiTags("wallet")
@Controller("wallet")
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Public()
  @UseGuards(RequesterAuthGuard)
  @Post("withdraw")
  @HttpCode(200)
  request(@CurrentRequester() requester: RequesterJwtPayload, @Body() dto: RequestWithdrawalDto) {
    return this.withdrawals.request(requester.sub, dto.amountCredits);
  }

  /** The operator payout queue: every withdrawal, filterable for triage. */
  @Roles("admin", "operator")
  @Get("withdrawals")
  list(@Query("status") status?: string) {
    return this.withdrawals.list(status);
  }

  @Roles("admin", "operator")
  @Post("withdrawals/:id/mark-paid")
  markPaid(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: MarkWithdrawalPaidDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.withdrawals.markPaid(id, dto.payoutRef, user.sub);
  }

  @Roles("admin", "operator")
  @Post("withdrawals/:id/reject")
  reject(@Param("id", ParseUUIDPipe) id: string) {
    return this.withdrawals.reject(id);
  }
}
