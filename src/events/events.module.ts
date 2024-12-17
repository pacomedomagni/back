import { Module } from '@nestjs/common';
import {
  CloudinaryService,
  JwtAuthService,
  MailService,
  PrismaService,
  SerialNumberService,
} from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import { OTPService } from 'src/common/OTP';
import { EventsGateway } from './events.gateway';
import { NotificationsService } from 'src/notifications/notifications.service';

@Module({
  // controllers: [NotificationsController],
  providers: [
    EventsGateway,
    NotificationsService,
    PrismaService,
    UsersService,
    MailService,
    JwtAuthService,
    SerialNumberService,
    OTPService,
    CloudinaryService,
  ],
  exports: [EventsGateway],
})
export class EventsModule {}
