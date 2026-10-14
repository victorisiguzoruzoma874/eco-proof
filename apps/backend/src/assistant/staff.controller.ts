import { Body, Controller, HttpCode, HttpException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, Roles, type JwtPayload } from '../auth/auth.module';
import { ToolInputError, UserLimiter, validateMessages } from './contracts';
import { runChat } from './chat-loop';
import { StaffAssistantTools, toolsFor } from './staff-tools';
import { STAFF_SYSTEM } from './staff-policy';

export function staffToolError(error: unknown): string {
  if (error instanceof ToolInputError) return error.message;
  // 4xx messages are the API's own user-facing explanations (conflicts, not found, invalid state).
  if (error instanceof HttpException && error.getStatus() < 500) return error.message;
  return 'The application tool could not fulfill this request. Check arguments or try the dashboard screen.';
}

@Controller('api/v1/assistant/staff')
export class StaffAssistantController {
  private limiter = new UserLimiter();
  constructor(private readonly tools: StaffAssistantTools) {}

  @Roles('admin', 'operator', 'auditor')
  @Post()
  async chat(@Body() body: unknown, @CurrentUser() user: JwtPayload, @Req() req: Request, @Res() res: Response) {
    const messages = validateMessages(body);
    this.limiter.check(user.sub);
    await runChat(messages, req, res, { system: `${STAFF_SYSTEM}\nSigned-in staff role: ${user.role}.`, tools: toolsFor(user.role), execute: (name, args) => this.tools.execute(name, args, user), describeError: staffToolError });
  }

  @Roles('admin')
  @Post('confirm/:id')
  @HttpCode(200)
  confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.tools.confirm(id, user);
  }
}
