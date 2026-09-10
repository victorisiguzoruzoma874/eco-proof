import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HubEntity, MaterialRateEntity } from "../database/entities";
import { MaterialRatesService } from "./material-rates.service";
import { MaterialRatesController } from "./material-rates.controller";
import { MaterialsModule } from "../materials/materials.module";

@Module({
  imports: [TypeOrmModule.forFeature([MaterialRateEntity, HubEntity]), MaterialsModule],
  controllers: [MaterialRatesController],
  providers: [MaterialRatesService],
  exports: [MaterialRatesService],
})
export class MaterialRatesModule {}
