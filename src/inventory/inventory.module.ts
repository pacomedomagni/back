import { Logger, Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import {
  CloudinaryService,
  JwtAuthService,
  MailService,
  PrismaService,
  SerialNumberService,
  finaliseSerialNumber,
} from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import { OTPService } from 'src/common/OTP';
import { EventsGateway } from 'src/events/events.gateway';
import { NotificationsService } from 'src/notifications/notifications.service';
import { EventsModule } from 'src/events/events.module';
//import { zeroStocks } from 'src/common/utils/zeroStocks';

@Module({
  imports: [EventsModule],
  controllers: [InventoryController],
  providers: [
    InventoryService,
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
    //zeroStocks,
  ],
})
export class InventoryModule {}
