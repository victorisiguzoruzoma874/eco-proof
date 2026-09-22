import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { EventsService } from "./events.service";
import { Public } from "../auth/auth.module";
import { ListEventsQueryDto, SubmitWeighInDto } from "../common/dto";
import { RateLimit } from "../common/rate-limit.guard";

@ApiTags("events")
@Controller("events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * Device ingest. Public by design: authentication here IS the ed25519
   * signature over the payload, checked against the enrolled device key. A
   * bearer token on a shared field phone would be the weaker control, and it
   * would break the offline queue (tokens expire while a device is offline).
   */
  @Public()
  // A single honest device sends a handful of weigh-ins an hour; 60/min per
  // IP comfortably covers a hub with many phones sharing one NAT address
  // while still bounding how hard an attacker can hammer the ingest path.
  @RateLimit(60, 60)
  @Post()
  @ApiOperation({ summary: "Submit a signed weigh-in from a collector device" })
  submit(@Body() dto: SubmitWeighInDto) {
    return this.events.ingest(dto.payload, dto.signature, dto.claimCode);
  }

  @Get()
  list(@Query() query: ListEventsQueryDto) {
    return this.events.list(query);
  }

  /**
   * Public, same reasoning as `findOne` below: hub staff on the reweigh
   * screen have only the short code printed on the collector's proof page,
   * not its database id. Declared ahead of `:id` in this file for readability,
   * though route matching does not actually depend on the order — `:id`
   * matches exactly one path segment, and `by-code/:code` is two, so they
   * never compete for the same request.
   */
  @Public()
  @Get("by-code/:code")
  findByLookupCode(@Param("code") code: string) {
    return this.events.findByLookupCode(code);
  }

  /**
   * Public: a collector who submitted a weigh-in from their own device has no
   * dashboard account, but still needs to look up and print their proof
   * (Phase 5's printable lookup-code page) without one.
   */
  @Public()
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.events.findOne(id);
  }
}
