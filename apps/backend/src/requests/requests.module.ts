import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CollectionEventEntity,
  CollectionRequestEntity,
  CollectorEntity,
  EventReweighEntity,
  HubEntity,
} from "../database/entities";
import { RequestsService } from "./requests.service";
import { RequestsController } from "./requests.controller";
import { MaterialsModule } from "../materials/materials.module";
import { RequestersModule } from "../requesters/requesters.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollectionRequestEntity,
      HubEntity,
      CollectorEntity,
      CollectionEventEntity,
      EventReweighEntity,
    ]),
    MaterialsModule,
    // Supplies RequesterAuthGuard/CurrentRequester for the requester-facing
    // routes (POST /requests, GET /requests/mine).
    RequestersModule,
  ],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
