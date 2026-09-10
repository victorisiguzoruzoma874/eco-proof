import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequestsService } from "./requests.service";
import { Public, Roles } from "../auth/auth.module";
import { CurrentRequester, RequesterAuthGuard } from "../requesters/requester-auth.guard";
import type { RequesterJwtPayload } from "../requesters/requesters.service";
import { AssignRequestDto, CreateCollectionRequestDto, FulfillRequestDto } from "../common/dto";

@ApiTags("requests")
@Controller("requests")
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Public()
  @UseGuards(RequesterAuthGuard)
  @Post()
  create(@CurrentRequester() requester: RequesterJwtPayload, @Body() dto: CreateCollectionRequestDto) {
    return this.requests.create(requester.sub, dto);
  }

  @Public()
  @UseGuards(RequesterAuthGuard)
  @Get("mine")
  mine(@CurrentRequester() requester: RequesterJwtPayload) {
    return this.requests.mine(requester.sub);
  }

  /** The operator fulfillment queue: every request, filterable for triage. */
  @Roles("admin", "operator")
  @Get()
  list(@Query("status") status?: string, @Query("hubId") hubId?: string) {
    return this.requests.list({ status, hubId });
  }

  @Roles("admin", "operator")
  @Post(":id/assign")
  assign(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AssignRequestDto) {
    return this.requests.assign(id, dto.collectorId);
  }

  @Roles("admin", "operator")
  @Post(":id/fulfill")
  fulfill(@Param("id", ParseUUIDPipe) id: string, @Body() dto: FulfillRequestDto) {
    return this.requests.fulfill(id, dto.eventId);
  }

  @Roles("admin", "operator")
  @Post(":id/cancel")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.requests.cancel(id);
  }
}
