import { Logger, Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
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
import { InvoiceService } from 'src/invoice/invoice.service';
//import { zeroStocks } from 'src/common/utils/zeroStocks';

@Module({
  controllers: [PaymentController],
  providers: [
    PaymentService,
    PrismaService,
    UsersService,
    MailService,
    JwtAuthService,
    SerialNumberService,
    OTPService,
    CloudinaryService,
    InvoiceService,
    finaliseSerialNumber,
    //zeroStocks,
    Logger,
  ],
})
export class PaymentModule {}
