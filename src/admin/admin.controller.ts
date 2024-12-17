import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Res,
  UseGuards,
  ParseIntPipe,
  Put,
  UseInterceptors,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  UploadedFile,
  ParseFilePipeBuilder,
  HttpStatus,
  Query,
  UsePipes,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { ApiTags } from '@nestjs/swagger';
import { UpdateComapnyDto } from './dto/update-company.dto';
import { CurrentUser, Permissions, Roles } from 'src/common/decorators';
import { User } from '@prisma/client';
import { AdminRoleDto } from './dto/create-admin-role.dto';
import { JwtGuard } from 'src/common/guards/jwtAuth.guard';
import { DepartmentDto } from './dto/create-department.dto';
import { DepartmentRoleDto } from './dto/create-department-role.dto';
import { AddUsersToDepartmentDto } from './dto/addUserToDepartment.dto';
import { CustomRoleDto } from './dto/custom-role.dto';
import { AddUsersToRoleDto } from './dto/addUsersToRole.dto';
import { CategoryDto } from './dto/product-category.dto';
import { wareHouseDto } from './dto/create-warehouse.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { MetricDto } from './dto/product-metric.dto';
import { AddRolesToDepartmentDto } from './dto/addRolesToDepartment.dto';
import { PaginationDto } from 'src/common/dto';
import { AccountDto } from './dto/account.dto';
import { DebugValidationPipe } from 'src/common/interceptors/validationPipe';

@ApiTags('api/v1/admin')
@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Patch('update-company')
  @UseInterceptors(FileInterceptor('file'))
  updateCompany(
    @CurrentUser() user: User,
    @Body() updateComapnyDto: UpdateComapnyDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        // .addFileTypeValidator({
        //   fileType: 'jpeg',
        // })
        .addMaxSizeValidator({
          maxSize: 5000000,
        })
        .build({
          fileIsRequired: false,
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
    file: Express.Multer.File,
  ) {
    return this.adminService.updateCompany(user.id, updateComapnyDto, file);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Put('create-department')
  createDepartment(
    @CurrentUser() user: User,
    @Body() departmentDto: DepartmentDto,
  ) {
    return this.adminService.createDepartment(user.id, departmentDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createWarehouse')
  @Put('create-warehouse')
  createWareHouse(
    @CurrentUser() user: User,
    @Body() wareHouseDto: wareHouseDto,
  ) {
    return this.adminService.createWareHouse(user.id, wareHouseDto);
  }

  /************************ DELETE ALL WAREHOUSES *****************************/
  // @UseGuards(JwtGuard)
  // @Roles('ADMIN', 'EMPLOYEE')
  // //@Permissions('createProduct')
  // @Delete('warehouse-delete/all')
  // deleteAllWarehouses(@Param('id', ParseIntPipe) id: number) {
  //   return this.adminService.deleteAllWarehouses(id);
  // }

  /************************ RESET INVENTORY *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('deleteProduct')
  //@UsePipes(DebugValidationPipe)
  @Delete('reset-inventory')
  resetCompanyInventory(@CurrentUser() user: User) {
    return this.adminService.resetCompanyInventory(user.id);
  }

  /************************ DELETE WAREHOUSE *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('deleteWarehouse')
  @Delete('warehouse-delete/:id')
  deleteProduct(
    @CurrentUser() user: User,
    @Param('id') id: number,
  ): Promise<any> {
    return this.adminService.deleteWarehouse(user.id, id);
  }

  /************************ EDIT WAREHOUSE *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('updateWarehouse')
  @Put('warehouse-edit/:id')
  editWarehouse(
    @CurrentUser() user: User,
    @Param('id') id: number,
    @Body() wareHouseDto: wareHouseDto,
  ): Promise<any> {
    return this.adminService.editWarehouse(user.id, id, wareHouseDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('get-warehouse/:id')
  getWarehouseById(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminService.getWarehouseById(user.id, id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createRole')
  @Put('create-custome-role')
  createCustomRole(
    @CurrentUser() user: User,
    @Body() customRoleDto: CustomRoleDto,
  ) {
    return this.adminService.createCustomRole(user.id, customRoleDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Get('get-category')
  getCategory(@CurrentUser() user: User) {
    return this.adminService.getCategory(user.id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Get('get-warehouse')
  getWareHouse(@CurrentUser() user: User) {
    return this.adminService.getWareHouse(user.id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Get('get-stocks')
  getStocks(@CurrentUser() user: User, @Query() paginationDto: PaginationDto) {
    return this.adminService.getStocks(user.id, paginationDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Put('create-category')
  createCategory(@CurrentUser() user: User, @Body() categoryDto: CategoryDto) {
    return this.adminService.createCategory(user.id, categoryDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Put('packagingMetric')
  packagingMetric(@CurrentUser() user: User, @Body() metricDto: MetricDto) {
    return this.adminService.packagingMetric(user.id, metricDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Get('packagingMetrics')
  packagingMetrics(@CurrentUser() user: User) {
    return this.adminService.packagingMetrics(user.id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('get-department')
  getAllDepartmentsInCompany(@CurrentUser() user: User) {
    return this.adminService.getAllDepartmentsInCompany(user.id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('get-custom-role')
  getAllCustomRolesInCompany(@CurrentUser() user: User) {
    return this.adminService.getAllCustomRolesInCompany(user.id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('updateRole')
  @Patch('update-custom-role/:roleId')
  updateCustomRole(
    @CurrentUser() user: User,
    @Param('roleId', ParseIntPipe) roleId: number,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    return this.adminService.updateCustomRole(user.id, roleId, updateRoleDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('get-system-role')
  getSystemRole(@CurrentUser() user: User) {
    return this.adminService.getSystemRole(user.id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Delete('delete-department/:id')
  deleteDepartment(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.adminService.deleteDepartment(user.id, id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Delete('delete-departmental-role/:id')
  deleteDepartmentalRole(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.adminService.deleteDepartmentalRole(user.id, id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('deleteRole')
  @Delete('delete-custom-role/:id')
  deleteCustomRole(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: User,
  ) {
    return this.adminService.deleteCustomRole(user.id, id);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Put('create-department-role/:id')
  createDepartmentRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() departmentRoleDto: DepartmentRoleDto,
    @CurrentUser() user: User,
  ) {
    return this.adminService.createDepartmentRole(
      user.id,
      id,
      departmentRoleDto,
    );
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Post('add-user-department')
  addUsersToDepartment(
    @CurrentUser() user: User,
    @Body() addUserToDepartmentDto: AddUsersToDepartmentDto,
  ) {
    return this.adminService.addUsersToDepartment(
      user.id,
      addUserToDepartmentDto,
    );
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Put('update-user-roles')
  updateUserRoles(
    @CurrentUser() user: User,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    return this.adminService.updateUserRoles(updateRoleDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Put('add-roles-department')
  addRolesToDepartment(
    @Body() addRolesToDepartmentDto: AddRolesToDepartmentDto,
  ) {
    return this.adminService.addRolesToDepartment(addRolesToDepartmentDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Post('add-user-role')
  addUsersToCustomRole(@Body() addUsersToRoleDto: AddUsersToRoleDto) {
    return this.adminService.addUsersToCustomRole(addUsersToRoleDto);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('banks')
  async getBanks(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search?: string,
  ) {
    return this.adminService.getBanks(page, limit, search);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Post('validate-bank')
  async validateBank(
    @Body() validateBankDto: { accountNumber: string; bankCode: string },
  ) {
    const { accountNumber, bankCode } = validateBankDto;
    return this.adminService.validateBankDetails(accountNumber, bankCode);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Put('account')
  createAccount(@CurrentUser() user: User, @Body() account: AccountDto) {
    return this.adminService.createAccount(user.id, account);
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Put('update-account/:accountId')
  updateAccount(
    @CurrentUser() user: User,
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() updateAccountDto: AccountDto,
  ) {
    return this.adminService.updateAccount(
      user.id,
      accountId,
      updateAccountDto,
    );
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('accounts')
  getAccounts(@CurrentUser() user: User) {
    return this.adminService.getAccounts(user.id);
  }
}
