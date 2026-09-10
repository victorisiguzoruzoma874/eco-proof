import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CreditRatesService } from "./credit-rates.service";
import { Public, Roles } from "../auth/auth.module";
import { CreateCreditRateDto } from "../common/dto";

@ApiTags("credit-rates")
@Controller("credit-rates")
export class CreditRatesController {
  constructor(private readonly rates: CreditRatesService) {}

  /**
   * Public, same reasoning as `GET /materials` and `GET /catalog-items`: a
   * requester (not an operator — no role at all) needs to see what their
   * material will earn per kg, before and after signing up, to decide
   * whether requesting a pickup is worth it.
   */
  @Public()
  @Get()
  list(@Query("materialCode") materialCode?: string, @Query("hubId") hubId?: string) {
    return this.rates.list({ materialCode, hubId });
  }

  @Roles("admin")
  @Post()
  create(@Body() dto: CreateCreditRateDto) {
    return this.rates.create(dto);
  }
}
