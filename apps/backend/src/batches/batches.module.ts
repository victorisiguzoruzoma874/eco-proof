import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BatchEntity, CollectionEventEntity } from "../database/entities";
import { BatchesService } from "./batches.service";
import { BatchesController } from "./batches.controller";
import { AuthModule } from "../auth/auth.module";
import { MaterialsModule } from "../materials/materials.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([BatchEntity, CollectionEventEntity]),
    AuthModule,
    // Opening a batch requires a material that is in the catalogue and active.
    MaterialsModule,
  ],
  controllers: [BatchesController],
  providers: [BatchesService],
  exports: [BatchesService],
})
export class BatchesModule {}
