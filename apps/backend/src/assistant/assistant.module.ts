import { Body, Controller, Module, Post, Req, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth.module';
import { CurrentRequester, RequesterAuthGuard } from '../requesters/requester-auth.guard';
import { RequestersModule } from '../requesters/requesters.module';
import type { RequesterJwtPayload } from '../requesters/requesters.service';
import { WalletModule } from '../wallet/wallet.module';
import { validateMessages, UserLimiter, ToolInputError } from './contracts';
import { AssistantTools, TOOLS } from './tools';
import { complete } from './deepseek';
import { SYSTEM } from './policy';

@Controller('api/v1/assistant')
export class AssistantController {
  private limiter = new UserLimiter();
  constructor(private readonly tools: AssistantTools) {}
  @Public()
  @UseGuards(RequesterAuthGuard)
  @Post()
  async chat(@Body() body: unknown, @CurrentRequester() user: RequesterJwtPayload, @Req() req: Request, @Res() res: Response) {
    const messages: any[] = [{ role: 'system', content: SYSTEM }, ...validateMessages(body)];
    this.limiter.check(user.sub);
    if (!process.env.DEEPSEEK_API_KEY) throw new ServiceUnavailableException('Assistant backend is not configured.');
    const abort = new AbortController(); const cancel = () => { if (!res.writableEnded) abort.abort(); };
    res.on('close', cancel); req.on('aborted', cancel);
    const timer = setTimeout(() => abort.abort(), 45000);
    const emit = (value: unknown) => { if (!res.destroyed && !abort.signal.aborted) res.write(`data: ${JSON.stringify(value)}\n\n`); };
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
    try {
      let executions = 0;
      for (let round = 0; round < 4; round++) {
        const answer = await complete(messages, TOOLS, abort.signal, text => emit({ delta: text }));
        if (!answer.tool_calls?.length) { res.write('data: [DONE]\n\n'); return; }
        if (round === 3 || executions + answer.tool_calls.length > 8) throw new Error('Tool budget exhausted');
        messages.push(answer);
        for (const call of answer.tool_calls) {
          executions++; if (abort.signal.aborted) throw new Error('Cancelled');
          // Activity reflects an actual tool attempt, not invented progress.
          emit({ activity: 'Checking an application request…' });
          let result: unknown;
          try {
            if (!TOOLS.some(t => t.function.name === call.function.name)) throw new Error('Unsupported tool');
            result = await this.tools.execute(call.function.name, JSON.parse(call.function.arguments), user.sub);
            if (abort.signal.aborted) throw new Error('Cancelled');
            const action = result as { action?: unknown; label?: string };
            if (action.action) emit({ action: action.action, label: action.label?.slice(0, 200) });
          } catch (error) { result = { error: error instanceof ToolInputError ? error.message : 'The application tool could not fulfill this request. Check arguments or try the existing application screen.' }; }
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
    } catch {
      if (!res.destroyed) res.write(`data: ${JSON.stringify({ error: 'The assistant service is unavailable. Please retry.' })}\n\n`);
    } finally { clearTimeout(timer); abort.abort(); res.off('close', cancel); req.off('aborted', cancel); res.end(); }
  }
}
@Module({ imports: [RequestersModule, WalletModule], controllers: [AssistantController], providers: [AssistantTools] })
export class AssistantModule {}
