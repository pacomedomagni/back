import { Logger, MiddlewareConsumer, Module } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import {
  CloudinaryService,
  MailService,
  PrismaService,
  SerialNumberService,
  finaliseSerialNumber,
} from 'src/common';
import { JwtAuthService } from 'src/common/utils/token.generators';
import { UsersService } from 'src/auth/users/users.service';
import { OTPService } from 'src/common/OTP';
import { ValidationLoggerMiddleware } from 'src/common/middleWare/ValidationLogger';

@Module({
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    PrismaService,
    JwtAuthService,
    UsersService,
    MailService,
    SerialNumberService,
    OTPService,
    CloudinaryService,
    Logger,
    finaliseSerialNumber,
  ],
})
export class SuppliersModule {
  //Remove after
  // configure(consumer: MiddlewareConsumer) {
  //   consumer
  //     .apply(ValidationLoggerMiddleware)
  //     .forRoutes('api/v1/supplier/create-supplier');
  // }
}
