import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
  Put,
  Query,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { JwtGuard } from 'src/common/guards/jwtAuth.guard';
import { CurrentUser, Permissions, Roles } from 'src/common/decorators';
import { User } from '@prisma/client';
import { PaginationDto } from 'src/common/dto';

@Controller('api/v1/invoice')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  /************************ CREATE INVOICE *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createInvoice')
  @Put('create-invoice')
  CreateSalesOrder(
    @CurrentUser() user: User,
    @Body() createInvoiceDto: CreateInvoiceDto,
  ) {
    return this.invoiceService.createInvoice(user.id, createInvoiceDto);
  }

  /************************ GET ALL INVOICES *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('get-invoices')
  getAllInvoices(
    @CurrentUser() user: User,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.invoiceService.getAllInvoices(user.id, paginationDto);
  }

  /************************ GET INVOICE BY ID *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get(':invoiceId')
  getCustomerById(
    @CurrentUser() user: User,
    @Param('invoiceId') invoiceId: number,
  ) {
    return this.invoiceService.getInvoiceById(user.id, invoiceId);
  }

  /************************ DELETE INVOICE *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('deleteInvoice')
  @Delete('delete/:id')
  deleteInvoice(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.invoiceService.deleteInvoice(user.id, id);
  }

  /************************ CANCEL INVOICE *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Patch('cancel/:id')
  cancelInvoice(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
    @Body('comment') comment?: string,
  ) {
    return this.invoiceService.cancelInvoice(user.id, id, comment);
  }
}
