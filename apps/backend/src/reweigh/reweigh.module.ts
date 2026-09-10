import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CollectionEventEntity, EventReweighEntity } from "../database/entities";
import { ReweighService } from "./reweigh.service";
import { ReweighController } from "./reweigh.controller";

@Module({
  imports: [TypeOrmModule.forFeature([EventReweighEntity, CollectionEventEntity])],
  controllers: [ReweighController],
  providers: [ReweighService],
  exports: [ReweighService],
})
export class ReweighModule {}
