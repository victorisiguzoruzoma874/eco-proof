import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  CollectionEventEntity,
  CollectionRequestEntity,
  CreditRateEntity,
  EventReweighEntity,
  WalletTransactionEntity,
  WasteWalletEntity,
  WithdrawalRequestEntity,
} from "../database/entities";
import { WalletService } from "./wallet.service";
import { WalletController } from "./wallet.controller";
import { RequestersModule } from "../requesters/requesters.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WasteWalletEntity,
      WalletTransactionEntity,
      CollectionRequestEntity,
      CollectionEventEntity,
      EventReweighEntity,
      CreditRateEntity,
      WithdrawalRequestEntity,
    ]),
    // Supplies RequesterAuthGuard/CurrentRequester for GET /wallet and
    // POST /wallet/redeem.
    RequestersModule,
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
