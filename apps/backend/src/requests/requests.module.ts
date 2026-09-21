import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CollectionEventEntity,
  CollectionRequestEntity,
  CollectorEntity,
  DeviceEntity,
  EventReweighEntity,
  HubEntity,
} from "../database/entities";
import { RequestsService } from "./requests.service";
import { RequestsController } from "./requests.controller";
import { MaterialsModule } from "../materials/materials.module";
import { RequestersModule } from "../requesters/requesters.module";
import { EventsModule } from "../events/events.module";
import { DeviceAuthGuard } from "../common/device-auth.guard";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollectionRequestEntity,
      HubEntity,
      CollectorEntity,
      CollectionEventEntity,
      EventReweighEntity,
      // DeviceAuthGuard resolves the calling phone and its collector.
      DeviceEntity,
    ]),
    MaterialsModule,
    // Supplies RequesterAuthGuard/CurrentRequester for the requester-facing
    // routes (POST /requests, GET /requests/mine).
    RequestersModule,
    // Doorstep collection ingests the weigh-in through the same pipeline the
    // B2B path uses, rather than keeping a second copy of the integrity checks.
    EventsModule,
  ],
  controllers: [RequestsController],
  providers: [RequestsService, DeviceAuthGuard],
  exports: [RequestsService],
})
export class RequestsModule {}
