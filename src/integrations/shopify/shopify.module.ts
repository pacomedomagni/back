import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ShopifyService } from './shopify.service';
import { ShopifyController } from './shopify.controller';
import { UsersModule } from 'src/auth/users/users.module';
import { JwtAuthService, PrismaService } from 'src/common';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [ConfigModule, UsersModule, HttpModule],
  providers: [ShopifyService, PrismaService, JwtAuthService],
  controllers: [ShopifyController],
  exports: [ShopifyService],
})
export class ShopifyModule {}
