import { Body, Controller, Module, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth.module';
import { CurrentRequester, RequesterAuthGuard } from '../requesters/requester-auth.guard';
import { RequestersModule } from '../requesters/requesters.module';
import type { RequesterJwtPayload } from '../requesters/requesters.service';
import { WalletModule } from '../wallet/wallet.module';
import { validateMessages, UserLimiter, ToolInputError } from './contracts';
import { AssistantTools, TOOLS } from './tools';
import { runChat } from './chat-loop';
import { SYSTEM } from './policy';
import { RequestsModule } from '../requests/requests.module';
import { CatalogModule } from '../catalog/catalog.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';

import { BatchesModule } from '../batches/batches.module';
import { EventsModule } from '../events/events.module';
import { ReportsModule } from '../reports/reports.module';
import { CustodyModule } from '../custody/custody.module';
import { ReweighModule } from '../reweigh/reweigh.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { RegistryModule } from '../collectors/registry.module';
import { MaterialsModule } from '../materials/materials.module';
import { MaterialRatesModule } from '../material-rates/material-rates.module';
import { CreditRatesModule } from '../credit-rates/credit-rates.module';
import { UsersModule } from '../users/users.module';
import { StaffAssistantController } from './staff.controller';
import { StaffAssistantTools } from './staff-tools';
import { PendingAdminOps } from './pending';
@Controller('api/v1/assistant')
export class AssistantController {
  private limiter = new UserLimiter();
  constructor(private readonly tools: AssistantTools) {}
  @Public()
  @UseGuards(RequesterAuthGuard)
  @Post()
  async chat(@Body() body: unknown, @CurrentRequester() user: RequesterJwtPayload, @Req() req: Request, @Res() res: Response) {
    const messages = validateMessages(body);
    this.limiter.check(user.sub);
    await runChat(messages, req, res, { system: SYSTEM, tools: TOOLS, execute: (name, args) => this.tools.execute(name, args, user.sub),
      describeError: error => error instanceof ToolInputError ? error.message : 'The application tool could not fulfill this request. Check arguments or try the existing application screen.' });
  }
}
@Module({
  imports: [RequestersModule, WalletModule, RequestsModule, CatalogModule, WithdrawalsModule, BatchesModule, EventsModule, ReportsModule, CustodyModule, ReweighModule, PayoutsModule, RegistryModule, MaterialsModule, MaterialRatesModule, CreditRatesModule, UsersModule],
  controllers: [AssistantController, StaffAssistantController],
  providers: [AssistantTools, StaffAssistantTools, PendingAdminOps],
})
export class AssistantModule {}
