import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequestsService } from "./requests.service";
import { Public, Roles } from "../auth/auth.module";
import { CurrentRequester, RequesterAuthGuard } from "../requesters/requester-auth.guard";
import type { RequesterJwtPayload } from "../requesters/requesters.service";
import { CurrentDevice, DeviceAuthGuard, type DeviceIdentity } from "../common/device-auth.guard";
import { RateLimit } from "../common/rate-limit.guard";
import {
  AssignRequestDto,
  CollectRequestDto,
  CreateCollectionRequestDto,
  FulfillRequestDto,
} from "../common/dto";

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

  /**
   * The collector's job list, read by a field phone.
   *
   * `@Public()` only means "no JWT" — `DeviceAuthGuard` still requires a valid
   * ed25519 signature over this exact request line, and the collector whose
   * jobs are returned comes from the enrolled device row, never from anything
   * the caller sent.
   *
   * Declared above `@Get()` for readability; route matching does not depend on
   * the order, since "assigned" is a literal segment and the operator list
   * takes none.
   */
  @Public()
  @UseGuards(DeviceAuthGuard)
  // A phone polls this every 45 seconds. 60/min per IP leaves ample room for a
  // depot of phones behind one NAT address while bounding a signature-probing
  // attacker to the same ceiling ingest already imposes.
  @RateLimit(60, 60)
  @Get("assigned")
  assigned(@CurrentDevice() device: DeviceIdentity) {
    return this.requests.assignedTo(device.collectorId);
  }

  /**
   * Doorstep collection: the signed weigh-in plus the code, in one round trip.
   *
   * Device-signed like ingest, and for the same reason — this is a field phone
   * with no operator logged in. The signature in the headers covers the request
   * line *and* a hash of this body, so a captured signature cannot be replayed
   * onto a different weight.
   */
  @Public()
  @UseGuards(DeviceAuthGuard)
  @RateLimit(60, 60)
  @Post(":id/collect")
  collect(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentDevice() device: DeviceIdentity,
    @Body() dto: CollectRequestDto,
  ) {
    return this.requests.collect(id, device, dto.payload, dto.signature);
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
