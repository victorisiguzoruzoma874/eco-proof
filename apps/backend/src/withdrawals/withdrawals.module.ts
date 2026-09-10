import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { WalletTransactionEntity, WasteWalletEntity, WithdrawalRequestEntity } from "../database/entities";
import { WithdrawalsService } from "./withdrawals.service";
import { WithdrawalsController } from "./withdrawals.controller";
import { RequestersModule } from "../requesters/requesters.module";
import { WalletModule } from "../wallet/wallet.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([WithdrawalRequestEntity, WalletTransactionEntity, WasteWalletEntity]),
    // Supplies RequesterAuthGuard/CurrentRequester for POST /wallet/withdraw.
    RequestersModule,
    // Supplies WalletService.getBalance — the single source of truth for
    // "how much can this requester spend right now", reused rather than
    // re-summing wallet_transactions here.
    WalletModule,
  ],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
