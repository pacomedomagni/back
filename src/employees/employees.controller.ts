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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CurrentUser, Permissions, Roles } from 'src/common/decorators';
import { User } from '@prisma/client';
import { UserDto } from './dto/create-user.dto';
import { JwtGuard } from 'src/common/guards/jwtAuth.guard';

@Controller('api/v1/employees/')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createUser')
  @Put('create')
  createEmployee(
    @CurrentUser() user: User,
    @Body() createEmployeeDto: CreateEmployeeDto,
    @Body() userDto: UserDto,
  ) {
    return this.employeesService.createEmployee(
      user.id,
      createEmployeeDto,
      userDto,
    );
  }

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createUser')
  @Put('bulk-create')
  @HttpCode(HttpStatus.CREATED)
  BulkEmployeeUpload(@CurrentUser() user: User, @Body() userDto: UserDto[]) {
    return this.employeesService.bulkCreateEmployees(user.id, userDto);
  }

  @UseGuards(JwtGuard)
  //@Roles('ADMIN')
  @Get('get-all-employees')
  getAllEmployeesInCompany(@CurrentUser() user: User) {
    return this.employeesService.getAllEmployeesInCompany(user.id);
  }
}
