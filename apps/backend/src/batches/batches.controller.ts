import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { BatchesService } from "./batches.service";
import { Public, Roles } from "../auth/auth.module";
import { AddEventsDto, AdvanceStatusDto, CreateBatchDto } from "../common/dto";
import type { BatchStatus } from "@proofchain/shared";

@ApiTags("batches")
@Controller("batches")
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  @Get()
  list(@Query("status") status?: BatchStatus) {
    return this.batches.list(status);
  }

  @Roles("admin", "operator")
  @Post()
  create(@Body() dto: CreateBatchDto) {
    return this.batches.create(dto.hubId, dto.material);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.batches.findOne(id);
  }

  @Get(":id/events")
  events(@Param("id", ParseUUIDPipe) id: string) {
    return this.batches.eventsOf(id);
  }

  @Roles("admin", "operator")
  @Post(":id/events")
  addEvents(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AddEventsDto) {
    return this.batches.addEvents(id, dto.eventIds);
  }

  @Roles("admin", "operator")
  @Delete(":id/events/:eventId")
  removeEvent(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ) {
    return this.batches.removeEvent(id, eventId);
  }

  @Roles("admin", "operator")
  @Post(":id/seal")
  @ApiOperation({ summary: "Freeze membership and compute the Merkle root" })
  seal(@Param("id", ParseUUIDPipe) id: string) {
    return this.batches.seal(id);
  }

  @Roles("admin", "operator")
  @Post(":id/status")
  advance(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdvanceStatusDto) {
    return this.batches.advanceStatus(id, dto.status);
  }

  /** Open to anyone holding the ids: verification must not require our blessing. */
  @Public()
  @Get(":batchId/verify/:eventId")
  @ApiOperation({ summary: "Merkle proof for one event against the sealed root" })
  verify(
    @Param("batchId", ParseUUIDPipe) batchId: string,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ) {
    return this.batches.verifyEvent(batchId, eventId);
  }
}
