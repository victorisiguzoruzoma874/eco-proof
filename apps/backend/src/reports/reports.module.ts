import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  BatchEntity,
  CollectionEventEntity,
  CollectorEntity,
  CustodyTransferEntity,
  EventReweighEntity,
  HubEntity,
  PayoutEntity,
  PayoutItemEntity,
} from "../database/entities";
import { ReportsService } from "./reports.service";
import { ReportsController } from "./reports.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BatchEntity,
      CollectionEventEntity,
      CustodyTransferEntity,
      CollectorEntity,
      HubEntity,
      EventReweighEntity,
      PayoutEntity,
      PayoutItemEntity,
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
