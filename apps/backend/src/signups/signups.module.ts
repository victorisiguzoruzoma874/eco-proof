import { Module } from "@nestjs/common";
import { SignupsController } from "./signups.controller";
import { SIGNUP_OPTIONS, SignupsService, type SignupOptions } from "./signups.service";
import { AuthModule } from "../auth/auth.module";
import { loadConfig } from "../config/configuration";

@Module({
  imports: [AuthModule],
  controllers: [SignupsController],
  providers: [
    SignupsService,
    {
      provide: SIGNUP_OPTIONS,
      useFactory: (): SignupOptions => ({ maxPending: loadConfig().signupMaxPending }),
    },
  ],
})
export class SignupsModule {}
