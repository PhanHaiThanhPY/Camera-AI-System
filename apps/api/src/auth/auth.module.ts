import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { authTokenTtlDays, requireJwtSecret } from "../config/jwt-secret";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

@Module({
  imports: [
    UsersModule,
    JwtModule.register({
      secret: requireJwtSecret(),
      signOptions: { expiresIn: `${authTokenTtlDays()}d` }
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }]
})
export class AuthModule {}
