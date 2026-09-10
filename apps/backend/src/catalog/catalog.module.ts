import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CatalogItemEntity, CatalogRedemptionEntity, WalletTransactionEntity, WasteWalletEntity } from "../database/entities";
import { CatalogService } from "./catalog.service";
import { CatalogController } from "./catalog.controller";
import { RequestersModule } from "../requesters/requesters.module";
import { WalletModule } from "../wallet/wallet.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CatalogItemEntity,
      CatalogRedemptionEntity,
      WalletTransactionEntity,
      WasteWalletEntity,
    ]),
    // Supplies RequesterAuthGuard/CurrentRequester for POST
    // /wallet/redeem-catalog-item.
    RequestersModule,
    // Supplies WalletService.getBalance, reused rather than re-summing
    // wallet_transactions here.
    WalletModule,
  ],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
