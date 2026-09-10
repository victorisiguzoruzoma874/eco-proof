import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ReweighService } from "./reweigh.service";
import { CurrentUser, Public, Roles, type JwtPayload } from "../auth/auth.module";
import { RecordReweighDto } from "../common/dto";

@ApiTags("reweigh")
@Controller("events/:eventId/reweigh")
export class ReweighController {
  constructor(private readonly reweigh: ReweighService) {}

  @Public()
  @Get()
  list(@Param("eventId", ParseUUIDPipe) eventId: string) {
    return this.reweigh.list(eventId);
  }

  @Roles("admin", "operator")
  @Post()
  create(
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body() dto: RecordReweighDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reweigh.create(eventId, dto, user.sub);
  }
}
