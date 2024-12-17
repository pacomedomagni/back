import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Put,
} from '@nestjs/common';
import { EbayService } from './ebay.service';
import { CreateEbayDto } from './dto/create-ebay.dto';
import { User } from '@prisma/client';
import { CurrentUser, Roles } from 'src/common/decorators';
import { PaginationDto } from 'src/common/dto';
import { JwtGuard } from 'src/common/guards/jwtAuth.guard';
import { IntegrationDto } from '../dto/integration.dto';

@Controller('/api/v1/integration')
export class EbayController {
  constructor(private readonly ebayService: EbayService) {}

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Put('ebay/code')
  async getAccessToken(
    @Query() createEbayDto: CreateEbayDto,
    @CurrentUser() user: User,
  ) {
    return this.ebayService.getAccessToken(createEbayDto, user.id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('ebay/orders')
  async fetchOrders(
    @CurrentUser() user: User,
    @Query() integration: IntegrationDto,
  ) {
    const { integrationId } = integration;
    return this.ebayService.fetchOrders(user.id, +integrationId);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('ebay/products')
  async fetchProducts(
    @CurrentUser() user: User,
    @Query() integration: IntegrationDto,
  ) {
    const { integrationId } = integration;
    return this.ebayService.fetchProducts(user.id, +integrationId);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get()
  async getUserIntegrations(
    @CurrentUser() user: User,
    @Query() paginationDto: PaginationDto,
  ) {
    return await this.ebayService.getUserIntegrations(user.id, paginationDto);
  }
}
