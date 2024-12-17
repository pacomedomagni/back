import { Module } from '@nestjs/common';
import { EbayService } from './ebay.service';
import { EbayController } from './ebay.controller';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from 'src/auth/users/users.module';
import { HttpModule } from '@nestjs/axios';
import { JwtAuthService, PrismaService } from 'src/common';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    HttpModule.registerAsync({
      useFactory: () => ({
        timeout: 5000,
        maxRedirects: 5,
      }),
    }),
  ],
  controllers: [EbayController],
  providers: [EbayService, PrismaService, JwtAuthService],
  exports: [EbayService],
})
export class EbayModule {}
