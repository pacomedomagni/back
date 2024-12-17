import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Put,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateSalesRequestDto } from './dto/create-sales-request.dto';
import { CurrentUser, Permissions, Roles } from 'src/common/decorators';
import { JwtGuard } from 'src/common/guards/jwtAuth.guard';
import { LoanRequest, User } from '@prisma/client';
import { UpdateSalesRequestDto } from './dto/update-sales-request.dto';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto';
import { PaginationDto } from 'src/common/dto';
import { CreateLoanRequestDto } from './dto/create-loan-request.dto';
import { UpdateLoanRequestDto } from './dto/update-loan-request.dto';
import { GetResponse } from 'src/common/interface';
import { ReturnLoanDto } from './dto/return-loan-request.dto';

@Controller('api/v1/requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  /************************ CREATE SALES REQUESTS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createRequest')
  @Put('create-sales-request')
  createSalesRequest(
    @CurrentUser() user: User,
    @Body() createSalesRequestDto: CreateSalesRequestDto,
  ) {
    return this.requestsService.createSalesRequest(
      user.id,
      createSalesRequestDto,
    );
  }

  /************************ GET SALES REQUESTS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Get('get-sales-requests')
  getSalesRequests(@CurrentUser() user: User) {
    return this.requestsService.getSalesRequests(user.id);
  }

  /************************ GET PURCHASE REQUESTS ********************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Get('get-purchase-requests')
  getPurchaseRequests(@CurrentUser() user: User) {
    return this.requestsService.getPurchaseRequests(user.id);
  }

  /************************ GET APPROVED PURCHASE REQUESTS ********************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Get('get-approved-purchase-requests')
  getApprovedPurchaseRequests(@CurrentUser() user: User) {
    return this.requestsService.getApprovedPurchaseRequests(user.id);
  }

  /************************ GET APPROVED SALES REQUESTS ********************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Get('get-approved-sales-requests')
  getApprovedSalesRequests(
    @CurrentUser() user: User,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.requestsService.getApprovedSalesRequests(
      user.id,
      paginationDto,
    );
  }

  /************************ UPDATE SALES APPROVAL REQUEST *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('approver')
  @Patch('sales/:salesId')
  updateSalesApprovalRequest(
    @CurrentUser() user: User,
    @Param('salesId') salesId: number,
    @Body() updateRequestDto: UpdateSalesRequestDto,
  ): Promise<any> {
    return this.requestsService.updateSalesApprovalRequest(
      user.id,
      salesId,
      updateRequestDto,
    );
  }

  /************************ EDIT PURCHASE REQUEST*****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('updateRequest')
  @Put('purchase/:id')
  editPurchaseRequest(
    @CurrentUser() user: User,
    @Param('id') id: number,
    @Body() updatePurchaseRequestDto: UpdatePurchaseRequestDto,
  ): Promise<any> {
    return this.requestsService.editPurchaseRequest(
      user.id,
      id,
      updatePurchaseRequestDto,
    );
  }

  /************************ CREATE PURCHASE REQUESTS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createRequest')
  @Put('create-purchase-request')
  createRequest(
    @CurrentUser() user: User,
    @Body() createRequestDto: CreatePurchaseRequestDto,
  ) {
    return this.requestsService.createPurchaseRequest(
      user.id,
      createRequestDto,
    );
  }

  /************************ EDIT PURCHASE REQUEST*****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('updateRequest')
  @Put('sales/:id')
  editSalesRequest(
    @CurrentUser() user: User,
    @Param('id') id: number,
    @Body() updateSalesRequestDto: UpdateSalesRequestDto,
  ): Promise<any> {
    return this.requestsService.editSalesRequest(
      user.id,
      id,
      updateSalesRequestDto,
    );
  }

  /************************ UPDATE PURCHASE APPROVAL REQUEST *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('approver')
  @Patch('purchase/:purchaseId')
  updatePurchaseApprovalRequest(
    @CurrentUser() user: User,
    @Param('purchaseId') purchaseId: number,
    @Body() updateRequestDto: UpdateSalesRequestDto,
  ): Promise<any> {
    return this.requestsService.updatePurchaseApprovalRequest(
      user.id,
      purchaseId,
      updateRequestDto,
    );
  }

  /************************ SEND QUOTE *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Post('quote/mail/:id')
  sendEmailToCustomer(
    @CurrentUser() user: User,
    @Param('id') id: number,
  ): Promise<any> {
    return this.requestsService.sendEmailToCustomer(user.id, id);
  }

  /************************ CANCEL SALES REQUEST *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('cancelRequest')
  @Patch('sales/cancel/:id')
  cancelSalesRequest(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
    @Body('comment') comment?: string,
  ) {
    return this.requestsService.cancelSalesRequest(user.id, id, comment);
  }

  /************************ CREATE LOAN REQUEST *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createRequest')
  @Put('create-loan-request')
  loanRequest(
    @CurrentUser() user: User,
    @Body() createLoanRequestDto: CreateLoanRequestDto,
  ) {
    return this.requestsService.loanRequest(user.id, createLoanRequestDto);
  }

  /************************ APPROVE LOAN REQUEST *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('approver')
  @Patch('loan-request/:loanId')
  approveLoanRequest(
    @CurrentUser() user: User,
    @Param('loanId') loanId: number,
    @Body() updateLoanRequestDto: UpdateLoanRequestDto,
  ): Promise<any> {
    return this.requestsService.approveLoanRequest(
      user.id,
      loanId,
      updateLoanRequestDto,
    );
  }

  /************************ GET LOAN REQUESTS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('loan-requests')
  getLoanRequests(
    @CurrentUser() user: User,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.requestsService.getLoanRequests(user.id, paginationDto);
  }

  /************************ GET LOAN REQUEST BY REQUEST NUMBER *********/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('loan-request/:id')
  getLoanRequestByID(
    @CurrentUser() user: User,
    @Param('id') id: number,
  ): Promise<GetResponse<LoanRequest>> {
    return this.requestsService.getLoanRequestByID(user.id, id);
  }

  /************************ RETURN LOAN *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  // @Permissions('purchaseOderConfirmation')
  @Put('loan-return/:id')
  LoanReturn(
    @CurrentUser() user: User,
    @Param('id') id: number,
    @Body() returnLoanDto: ReturnLoanDto,
  ) {
    return this.requestsService.LoanReturn(user.id, id, returnLoanDto);
  }

  /************************ GET LOAN REQUESTS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('loan-returns/:loanId')
  getLoanReturns(
    @CurrentUser() user: User,
    @Param('loanId') loanId: number,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.requestsService.getReturnLoans(user.id, loanId, paginationDto);
  }

  /************************ GET REQUEST BY REQUEST SERIAL NUMBER *********/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get(':req')
  getRequestByREQ(
    @CurrentUser() user: User,
    @Param('req') req: string,
  ): Promise<any> {
    return this.requestsService.getRequestByREQ(user.id, req);
  }
}
