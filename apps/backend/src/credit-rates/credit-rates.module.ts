import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CreditRateEntity, HubEntity } from "../database/entities";
import { CreditRatesService } from "./credit-rates.service";
import { CreditRatesController } from "./credit-rates.controller";
import { MaterialsModule } from "../materials/materials.module";

@Module({
  imports: [TypeOrmModule.forFeature([CreditRateEntity, HubEntity]), MaterialsModule],
  controllers: [CreditRatesController],
  providers: [CreditRatesService],
  exports: [CreditRatesService],
})
export class CreditRatesModule {}
