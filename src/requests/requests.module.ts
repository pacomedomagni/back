import { Logger, Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { UsersService } from 'src/auth/users/users.service';
import {
  PrismaService,
  SerialNumberService,
  MailService,
  CloudinaryService,
  finaliseSerialNumber,
} from 'src/common';
import { JwtAuthService } from 'src/common/utils/token.generators';
import { OTPService } from 'src/common/OTP';
import { EventsGateway } from 'src/events/events.gateway';
import { NotificationsService } from 'src/notifications/notifications.service';
import { EventsModule } from 'src/events/events.module';
//import { zeroStocks } from 'src/common/utils/zeroStocks';

@Module({
  imports: [EventsModule],
  controllers: [RequestsController],
  providers: [
    RequestsService,
    UsersService,
    PrismaService,
    MailService,
    SerialNumberService,
    JwtAuthService,
    OTPService,
    CloudinaryService,
    //zeroStocks,
    Logger,
    finaliseSerialNumber,
    NotificationsService,
  ],
})
export class RequestsModule {}
