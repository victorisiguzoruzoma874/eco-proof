import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CollectorEntity,
  EventReweighEntity,
  MaterialRateEntity,
  PayoutEntity,
  PayoutItemEntity,
} from "../database/entities";
import { PayoutsService } from "./payouts.service";
import { PayoutsController } from "./payouts.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PayoutEntity,
      PayoutItemEntity,
      EventReweighEntity,
      MaterialRateEntity,
      CollectorEntity,
    ]),
  ],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
