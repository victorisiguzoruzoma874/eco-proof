import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PayoutsService } from "./payouts.service";
import { CurrentUser, Roles, type JwtPayload } from "../auth/auth.module";
import { CreatePayoutDto, MarkPayoutPaidDto } from "../common/dto";

@ApiTags("payouts")
@Controller("payouts")
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Roles("admin", "operator", "auditor")
  @Get()
  list(@Query("collectorId") collectorId?: string) {
    return this.payouts.list(collectorId);
  }

  @Roles("admin", "operator", "auditor")
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.payouts.findOne(id);
  }

  @Roles("admin", "operator")
  @Post()
  create(@Body() dto: CreatePayoutDto) {
    return this.payouts.create(dto.collectorId, dto.eventReweighIds, dto.method);
  }

  @Roles("admin", "operator")
  @Post(":id/mark-paid")
  markPaid(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: MarkPayoutPaidDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payouts.markPaid(id, dto.payoutRef, user.sub);
  }
}
