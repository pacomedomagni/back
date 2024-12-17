import { Logger, Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import {
  CloudinaryService,
  PrismaService,
  SerialNumberService,
  finaliseSerialNumber,
} from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import { MailService } from 'src/common/mail/mail.service';
import { JwtAuthService } from 'src/common/utils/token.generators';
import { OTPService } from 'src/common/OTP';
import { EventsGateway } from 'src/events/events.gateway';
import { NotificationsService } from 'src/notifications/notifications.service';
import { EventsModule } from 'src/events/events.module';
import { LoggerModule } from 'src/logger/logger.module';

@Module({
  imports: [EventsModule, LoggerModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    PrismaService,
    UsersService,
    MailService,
    JwtAuthService,
    SerialNumberService,
    OTPService,
    CloudinaryService,
    Logger,
    NotificationsService,
    finaliseSerialNumber,
  ],
})
export class OrdersModule {}
