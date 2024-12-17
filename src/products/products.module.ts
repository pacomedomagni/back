import { Logger, Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import {
  CloudinaryService,
  PrismaService,
  SerialNumberService,
} from 'src/common';
import { JwtAuthService } from 'src/common/utils/token.generators';
import { UsersService } from 'src/auth/users/users.service';
import { MailService } from 'src/common/mail/mail.service';
import { OTPService } from 'src/common/OTP';
import { EventsModule } from 'src/events/events.module';
import { LoggerModule } from 'src/logger/logger.module';

@Module({
  imports: [EventsModule, LoggerModule],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    PrismaService,
    JwtAuthService,
    UsersService,
    MailService,
    CloudinaryService,
    SerialNumberService,
    OTPService,
    CloudinaryService,
  ],
})
export class ProductsModule {}
