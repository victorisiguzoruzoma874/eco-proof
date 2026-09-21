import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CollectionEventEntity, EventReweighEntity } from "../database/entities";
import { ReweighService } from "./reweigh.service";
import { ReweighController } from "./reweigh.controller";
import { WalletModule } from "../wallet/wallet.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([EventReweighEntity, CollectionEventEntity]),
    // A re-weigh settles any doorstep credit already paid against this event.
    WalletModule,
  ],
  controllers: [ReweighController],
  providers: [ReweighService],
  exports: [ReweighService],
})
export class ReweighModule {}
