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
  Query,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { ContactDto, CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { JwtGuard } from 'src/common/guards/jwtAuth.guard';
import { CurrentUser, Permissions, Roles } from 'src/common/decorators';
import { User } from '@prisma/client';
import { DateTime } from 'luxon';
import { PaginationDto } from 'src/common/dto';

@Controller('api/v1/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  /************************ CREATE CUSTOMER *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createCustomer')
  @Put('create-customer')
  createCustomer(
    @CurrentUser() user: User,
    @Body() createCustomerDto: CreateCustomerDto,
  ) {
    return this.customersService.createCustomer(user.id, createCustomerDto);
  }

  /************************ UPLOAD CUSTOMER *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createCustomer')
  @Put('upload-customers')
  uploadCustomers(
    @CurrentUser() user: User,
    @Body() createCustomerDto: CreateCustomerDto[],
  ) {
    return this.customersService.uploadCustomers(user.id, createCustomerDto);
  }

  /************************ DELETE CUSTOMER *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('deleteCustomer')
  @Delete('delete/:customerId')
  deleteProduct(
    @CurrentUser() user: User,
    @Param('customerId') customerId: number,
  ): Promise<any> {
    return this.customersService.deleteCustomer(user.id, customerId);
  }

  /************************ DELETE ALL CUSTOMERS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('deleteCustomer')
  @Delete('delete')
  deleteAllCustomers(@CurrentUser() user: User): Promise<any> {
    return this.customersService.deleteAllCustomers(user.id);
  }

  /************************ Edit CUSTOMERS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('updateCustomer')
  @Put('edit/:customerId')
  editSupplier(
    @CurrentUser() user: User,
    @Param('customerId') customerId: number,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ): Promise<any> {
    return this.customersService.editCustomer(
      user.id,
      customerId,
      updateCustomerDto,
    );
  }

  /************************ GET ALL CUSTOMERS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('get-customers')
  getCustomers(
    @CurrentUser() user: User,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.customersService.getCustomers(user.id, paginationDto);
  }

  /************************ GET ALL CONTACTS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('get-contacts')
  getContacts(
    @CurrentUser() user: User,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.customersService.getContacts(user.id, paginationDto);
  }

  /************************ GET Customer BY ID *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get(':customerId')
  getCustomerById(
    @CurrentUser() user: User,
    @Param('customerId') customerId: number,
  ) {
    return this.customersService.getCustomerById(user.id, customerId);
  }

  /************************ CREATE CUSTOMER *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Put('create-contact')
  createContact(@CurrentUser() user: User, @Body() contactDto: ContactDto) {
    return this.customersService.createContact(user.id, contactDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Get('top/customers')
  async getBestCustomers(
    @CurrentUser() user: User,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('limit') limit: number,
  ) {
    try {
      const processedStartDate = this.processDate(startDate);
      const processedEndDate = this.processDate(endDate);

      // Parse the startDate and endDate strings into Luxon DateTime objects
      const start = DateTime.fromISO(processedStartDate);
      const end = DateTime.fromISO(processedEndDate);

      // Check if the parsed dates are valid
      if (!start.isValid || !end.isValid) {
        throw new Error('Invalid date format');
      }

      // Adjust the parsed dates to start and end of the day
      const startOfDay = start.startOf('day');
      const endOfDay = end.endOf('day');

      const bestSellingItems = await this.customersService.getBestCustomers(
        user.id,
        startOfDay,
        endOfDay,
        limit,
      );
      return bestSellingItems;
    } catch (error) {
      // Handle errors appropriately
      console.error('Error:', error);
      throw error;
    }
  }

  // Function to process date string into ISO format with time and timezone
  processDate(dateString: string): string {
    const [year, month, day] = dateString.split('-').map(Number);
    const processedDate = new Date(Date.UTC(year, month - 1, day));
    const isoDateString = processedDate.toISOString().split('T')[0]; // Extract date part
    return isoDateString + 'T00:00:00.000Z'; // Append time and UTC timezone
  }
}
