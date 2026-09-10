import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RequesterEntity, WasteWalletEntity } from "../database/entities";
import { RequestersService } from "./requesters.service";
import { RequestersController } from "./requesters.controller";
import { RequesterAuthGuard } from "./requester-auth.guard";
import { AuthModule } from "../auth/auth.module";

/**
 * `CurrentRequester()` and `RequesterAuthGuard` live in `requester-auth.guard.ts`,
 * not here — see that file's doc comment for why (a module <-> controller
 * circular require if they lived alongside this `@Module()` instead).
 *
 * `TypeOrmModule` and `AuthModule` are re-exported alongside `RequesterAuthGuard`
 * for the same reason `auth.module.ts` re-exports `TypeOrmModule` for
 * `JwtAuthGuard`: `RequestsModule` and `WalletModule` apply this guard via
 * `@UseGuards(RequesterAuthGuard)` on their own controllers, and Nest resolves
 * a guard referenced that way using the *consuming* module's own injector —
 * so `RequesterAuthGuard`'s constructor deps (`JwtService`, its
 * `Repository<RequesterEntity>`) must be visible there too, not only here.
 * Without re-exporting both, the app fails to boot with "Nest can't resolve
 * dependencies of RequesterAuthGuard ... in the WalletModule context."
 */
@Module({
  imports: [TypeOrmModule.forFeature([RequesterEntity, WasteWalletEntity]), AuthModule],
  controllers: [RequestersController],
  providers: [RequestersService, RequesterAuthGuard],
  exports: [RequestersService, RequesterAuthGuard, TypeOrmModule, AuthModule],
})
export class RequestersModule {}
