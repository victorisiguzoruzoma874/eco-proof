import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CatalogService } from "./catalog.service";
import { CurrentUser, Public, Roles, type JwtPayload } from "../auth/auth.module";
import { CurrentRequester, RequesterAuthGuard } from "../requesters/requester-auth.guard";
import type { RequesterJwtPayload } from "../requesters/requesters.service";
import { CreateCatalogItemDto, RedeemCatalogItemDto } from "../common/dto";

/**
 * No route prefix on the controller: `catalog-items` and
 * `catalog-redemptions` are their own top-level resources, and
 * `wallet/redeem-catalog-item` deliberately sits under `/wallet` — same
 * resource, from the requester's point of view, as `POST /wallet/redeem`
 * and `POST /wallet/withdraw`.
 */
@ApiTags("catalog")
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /**
   * Public, same reasoning as `GET /materials`: a requester needs to browse
   * the catalogue before deciding whether to redeem, and there is nothing
   * secret about a list of prices.
   */
  @Public()
  @Get("catalog-items")
  list() {
    return this.catalog.list();
  }

  @Roles("admin")
  @Post("catalog-items")
  create(@Body() dto: CreateCatalogItemDto) {
    return this.catalog.create(dto);
  }

  @Public()
  @UseGuards(RequesterAuthGuard)
  @Post("wallet/redeem-catalog-item")
  @HttpCode(200)
  redeem(@CurrentRequester() requester: RequesterJwtPayload, @Body() dto: RedeemCatalogItemDto) {
    return this.catalog.redeem(requester.sub, dto.itemId);
  }

  @Roles("admin", "operator")
  @Post("catalog-redemptions/:id/fulfill")
  fulfill(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.catalog.fulfill(id, user.sub);
  }

  /** The operator fulfillment queue: every redemption, filterable for triage. */
  @Roles("admin", "operator")
  @Get("catalog-redemptions")
  listRedemptions(@Query("status") status?: string) {
    return this.catalog.listRedemptions(status);
  }
}
