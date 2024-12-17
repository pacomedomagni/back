import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UpdateComapnyDto } from './dto/update-company.dto';
import {
  Account,
  AdminCompany,
  Image,
  Prisma,
  Stock,
  User,
  UserType,
  WareHouse,
} from '@prisma/client';
import { CloudinaryService, paginate, PrismaService } from 'src/common';
import { AdminRoleDto } from './dto/create-admin-role.dto';
import { DepartmentDto } from './dto/create-department.dto';
import { DepartmentRoleDto } from './dto/create-department-role.dto';
import { AddUsersToDepartmentDto } from './dto/addUserToDepartment.dto';
import { CustomRoleDto } from './dto/custom-role.dto';
import { AddUsersToRoleDto } from './dto/addUsersToRole.dto';
import { CategoryDto } from './dto/product-category.dto';
import { wareHouseDto } from './dto/create-warehouse.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UsersService } from 'src/auth/users/users.service';
import { MetricDto } from './dto/product-metric.dto';
import { AddRolesToDepartmentDto } from './dto/addRolesToDepartment.dto';
import { GetAllResponse } from 'src/common/interface';
import { PaginationDto } from 'src/common/dto';
import { PaystackService } from 'src/common/utils/paystack.util';
import { AccountDto } from './dto/account.dto';
import { WinstonLoggerService } from 'src/logger/logger.service';
import { error } from 'console';

@Injectable()
export class AdminService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly paystackService: PaystackService,
    private readonly logger: WinstonLoggerService,
  ) {}
  async updateCompany(
    adminId: number,
    data: UpdateComapnyDto,
    file?: Express.Multer.File,
  ) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: adminId },
        include: {
          adminCompanyId: { include: { logo: true } },
          employeeId: true,
          image: true,
        },
      });
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      if (!user.adminCompanyId) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      await this.prismaService.packagingMetric.updateMany({
        where: {
          companyId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });

      let metric;
      if (data.packagingMetric) {
        metric = await this.prismaService.packagingMetric.findUnique({
          where: {
            id: Number(data.packagingMetric),
            companyId,
          },
        });

        if (!metric) {
          throw new HttpException(
            `Packaging matric with name ${metric?.packName} not found`,
            HttpStatus.NOT_FOUND,
          );
        }
      }

      if (metric) {
        await this.prismaService.packagingMetric.update({
          where: {
            id: metric.id,
          },
          data: {
            isDefault: true,
          },
        });
      }

      let account: Account;
      if (data.accountId) {
        account = await this.prismaService.account.findUnique({
          where: {
            id: Number(data.accountId),
            companyId,
          },
        });

        if (!account) {
          throw new HttpException(`Account not found`, HttpStatus.NOT_FOUND);
        }
      }

      if (account) {
        await this.prismaService.account.update({
          where: {
            id: account.id,
          },
          data: {
            isDefault: true,
          },
        });
      }

      let logo = null;
      const companyLogo = user.adminCompanyId.logo;

      if (file) {
        // Delete the previous image if it exists
        if (companyLogo) {
          await this.cloudinaryService.deleteImage(companyLogo.publicId);
        }

        const imagesLink = await this.cloudinaryService
          .uploadImage(file)
          .catch((error) => {
            throw new HttpException(error, HttpStatus.BAD_REQUEST);
          });

        // Check if the user already has an image
        if (companyLogo) {
          // If the user has an existing image, update it
          logo = await this.prismaService.image.update({
            where: { id: companyLogo.id }, // Use existing image ID
            data: {
              publicId: imagesLink.public_id,
              url: imagesLink.url,
              companyId,
            },
          });
        } else {
          // If the user doesn't have an existing image, create a new one
          logo = await this.prismaService.image.create({
            data: {
              publicId: imagesLink.public_id,
              url: imagesLink.url,
              companyId,
            },
          });
        }
      }

      if (user.userType === UserType.ADMIN) {
        if (!user.adminCompanyId) {
          throw new HttpException(
            'No existing company, please create a company',
            HttpStatus.NOT_FOUND,
          );
        }

        const company = await this.prismaService.adminCompany.findUnique({
          where: { adminID: user.id },
        });

        if (!company) {
          throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
        }

        const { accountId, ...updatedData } = data;
        const update = await this.prismaService.adminCompany.update({
          where: { id: company.id },
          data: {
            ...updatedData,
            imageId: logo?.id,
            packagingMetric: metric
              ? {
                  connect: { id: metric?.id ?? undefined },
                }
              : undefined,
            accounts: account
              ? {
                  connect: { id: account?.id ?? undefined },
                }
              : undefined,
          },

          include: { logo: true, packagingMetric: true, accounts: true },
        });
        if (update) {
          return {
            status: 'Success',
            message: 'Rocords updated',
            data: update,
          };
        }
      } else if (user.userType === UserType.EMPLOYEE) {
        const company = await this.prismaService.adminCompany.findUnique({
          where: { adminID: user.employeeId.companyId },
        });

        if (!company) {
          throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
        }

        const { accountId, ...updatedData } = data;
        const update = await this.prismaService.adminCompany.update({
          where: { id: company.id },
          data: {
            ...updatedData,
            imageId: logo.id,
            packagingMetric: metric
              ? {
                  connect: { id: metric?.id ?? null },
                }
              : undefined,

            accounts: account
              ? {
                  connect: { id: account?.id ?? undefined },
                }
              : undefined,
          },
          include: { logo: true },
        });
        if (update) {
          return {
            status: 'Success',
            message: 'Updated successfully',
            data: update,
          };
        }
      }
    } catch (error) {
      console.log(error.message);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating records',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async createDepartment(userId: number, departmentDto: DepartmentDto) {
    try {
      // Check if the user (admin or employee) exists
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found ', HttpStatus.NOT_FOUND);
      }

      // Check if the department name already exists in the company
      const existingDepartment = await this.prismaService.department.findFirst({
        where: {
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
          name: departmentDto.name,
        },
      });

      if (existingDepartment) {
        throw new HttpException(
          'Department with this name already exists in the company',
          HttpStatus.CONFLICT,
        );
      }

      const createdDepartment = await this.prismaService.department.create({
        data: {
          name: departmentDto.name,
          description: departmentDto.description,
          permissions: departmentDto.permissions,
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Department created successfully',
        ...createdDepartment,
        companyId: undefined,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating department',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async createWareHouse(userId: number, wareHouseDto: wareHouseDto) {
    try {
      // Check if the user (admin or employee) exists
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found ', HttpStatus.NOT_FOUND);
      }

      const existingWareHouse = await this.prismaService.wareHouse.findFirst({
        where: {
          name: {
            equals: wareHouseDto.name.trim(),
            mode: 'insensitive',
          },
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (existingWareHouse) {
        throw new HttpException(
          `Warehouse with this name ${existingWareHouse.name} already exists in the company`,
          HttpStatus.CONFLICT,
        );
      }

      const createdWareHouse = await this.prismaService.wareHouse.create({
        data: {
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
          name: wareHouseDto.name.trim(),
          address: wareHouseDto.address,
          companyEmail: wareHouseDto.companyEmail,
          createdBy: user.primaryContactName,
          ...wareHouseDto,
        },
      });

      return {
        status: 'Success',
        message: 'Warehouse created successfully',
        ...createdWareHouse,
        companyId: undefined,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating warehouse',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getWarehouseById(userId: number, warehouseId: number): Promise<any> {
    try {
      // Check if the user exists with associated relationships
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const warehouse = await this.prismaService.wareHouse.findUnique({
        where: { id: warehouseId, companyId },
        include: {
          //products: true,
          stocks: { include: { product: true } },
        },
      });

      if (!warehouse) {
        throw new HttpException('Warehouse not found', HttpStatus.NOT_FOUND);
      }

      return {
        status: 'Success',
        data: warehouse,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching records',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async createCategory(userId: number, categoryDto: CategoryDto) {
    try {
      // Check if the user (admin or employee) exists
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found ', HttpStatus.NOT_FOUND);
      }

      const existingCategory = await this.prismaService.category.findFirst({
        where: {
          name: {
            equals: categoryDto.name.trim(),
            mode: 'insensitive',
          },
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (existingCategory) {
        throw new HttpException(
          'Category with this name already exists in the company',
          HttpStatus.CONFLICT,
        );
      }

      const category = await this.prismaService.category.create({
        data: {
          name: categoryDto.name.trim(),
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Category created successfully',
        ...category,
        companyId: undefined,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating category',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async packagingMetric(userId: number, metricDto: MetricDto) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found ', HttpStatus.NOT_FOUND);
      }

      const existingMetric = await this.prismaService.packagingMetric.findFirst(
        {
          where: {
            packName: {
              equals: metricDto.packName.trim(),
              mode: 'insensitive',
            },
            companyId:
              user.adminCompanyId?.adminID || user.employeeId?.companyId,
          },
        },
      );

      if (existingMetric) {
        throw new HttpException(
          `Packaging metric with name ${existingMetric.packName} already exists in the company`,
          HttpStatus.CONFLICT,
        );
      }

      const metric = await this.prismaService.packagingMetric.create({
        data: {
          packName: metricDto.packName.trim(),
          unitName: metricDto.unitName.trim(),
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Successfully Created',
        ...metric,
        companyId: undefined,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating metric',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async packagingMetrics(userId: number) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Check if the company exists
      const company = await this.prismaService.adminCompany.findUnique({
        where: {
          adminID: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (!company) {
        throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
      }

      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;
      const packagingMetrics =
        await this.prismaService.packagingMetric.findMany({
          where: {
            companyId,
          },
          include: {
            products: {
              where: {
                companyId,
              },
            },
          },
        });

      return {
        status: 'Success',
        message: 'Packaging metrics retrieved successfully',
        data: packagingMetrics,
      };
    } catch (error) {
      throw error;
    }
  }

  async createAccount(userId: number, accountDto: AccountDto) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found ', HttpStatus.NOT_FOUND);
      }

      const existingAccount = await this.prismaService.account.findFirst({
        where: {
          bankName: {
            equals: accountDto.bankName.trim(),
            mode: 'insensitive',
          },
          accountNumber: accountDto.accountNumber,
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (existingAccount) {
        throw new HttpException(
          `Account with name ${existingAccount.accountName} already exist in the company`,
          HttpStatus.CONFLICT,
        );
      }

      const accountDetails = await this.paystackService.validateBankDetails(
        accountDto.accountNumber,
        accountDto.bankCode,
      );

      if (
        accountDetails.account_name !== accountDto.accountName ||
        accountDetails.account_number !== accountDto.accountNumber
      ) {
        throw new HttpException(
          'Invalid account details provided',
          HttpStatus.BAD_REQUEST,
        );
      }

      const account = await this.prismaService.account.create({
        data: {
          accountName: accountDto.accountName.trim(),
          accountNumber: accountDto.accountNumber.trim(),
          bankName: accountDto.bankName.trim(),
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Successfully Created',
        ...account,
        companyId: undefined,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating accunt',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async updateAccount(
    userId: number,
    accountId: number,
    accountDto: AccountDto,
  ) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const account = await this.prismaService.account.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
      }

      const accountDetails = await this.paystackService.validateBankDetails(
        accountDto.accountNumber,
        accountDto.bankCode,
      );

      if (
        accountDetails.account_name !== accountDto.accountName ||
        accountDetails.account_number !== accountDto.accountNumber
      ) {
        throw new HttpException(
          'Invalid account details provided',
          HttpStatus.BAD_REQUEST,
        );
      }

      const updatedAccount = await this.prismaService.account.update({
        where: { id: accountId },
        data: {
          accountName: accountDto.accountName.trim(),
          accountNumber: accountDto.accountNumber.trim(),
          bankName: accountDto.bankName.trim(),
        },
      });

      return {
        status: 'Success',
        message: 'Successfully Updated',
        ...updatedAccount,
        companyId: undefined,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating account',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getAccounts(userId: number) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const company = await this.prismaService.adminCompany.findUnique({
        where: {
          adminID: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (!company) {
        throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
      }

      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;
      const accounts = await this.prismaService.account.findMany({
        where: {
          companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Account retrieved successfully',
        data: accounts,
      };
    } catch (error) {
      throw error;
    }
  }

  async createCustomRole(userId: number, customRoleDto: CustomRoleDto) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;
      const createdCustomRoles = await this.prismaService.$transaction(
        async (prisma) => {
          const existingRole = await prisma.customRole.findFirst({
            where: {
              companyId,
              name: {
                equals: customRoleDto.name.trim(),
                mode: 'insensitive',
              },
            },
          });

          const existingSystemRole =
            await this.prismaService.systemRole.findFirst({
              where: {
                name: {
                  equals: customRoleDto.name.trim(),
                  mode: 'insensitive',
                },
              },
            });

          if (existingRole || existingSystemRole) {
            throw new HttpException(
              `Role with name already exists`,
              HttpStatus.CONFLICT,
            );
          }

          return prisma.customRole.create({
            data: {
              companyId,
              name: customRoleDto.name,
              description: customRoleDto.description,
              permissions: customRoleDto.permissions,
            },
          });
        },
      );

      return {
        status: 'Success',
        message: 'Custom role created successfully',
        ...createdCustomRoles,
        companyId: undefined,
      };
    } catch (error) {
      throw error;
    }
  }

  async getAllDepartmentsInCompany(userId: number) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Check if the company exists
      const company = await this.prismaService.adminCompany.findUnique({
        where: {
          adminID: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (!company) {
        throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
      }

      // Get all departments in the company
      const departments = await this.prismaService.department.findMany({
        where: {
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
        include: {
          users: { include: { image: true } },
          departmentRoles: true,
          customRole: true,
          systemRole: true,
        },
      });

      return {
        status: 'Success',
        message: 'Departments retrieved successfully',
        data: departments,
      };
    } catch (error) {
      throw error;
    }
  }

  async getAllCustomRolesInCompany(userId: number) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Check if the company exists
      const company = await this.prismaService.adminCompany.findUnique({
        where: {
          adminID: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (!company) {
        throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
      }

      // Get all departments in the company
      const roles = await this.prismaService.customRole.findMany({
        where: {
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
        include: { users: true },
      });

      if (!roles) {
        throw new HttpException('Not found', HttpStatus.NOT_FOUND);
      }

      return {
        status: 'Success',
        message: 'roles retrieved successfully',
        data: roles,
      };
    } catch (error) {
      throw error;
    }
  }

  async getCategory(userId: number) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Check if the company exists
      const company = await this.prismaService.adminCompany.findUnique({
        where: {
          adminID: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (!company) {
        throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
      }

      // Get all departments in the company
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;
      const categories = await this.prismaService.category.findMany({
        where: {
          companyId,
        },
        include: {
          products: {
            where: {
              companyId,
            },
          },
        },
      });

      return {
        status: 'Success',
        message: 'categories retrieved successfully',
        data: categories,
      };
    } catch (error) {
      throw error;
    }
  }

  async getWareHouse(userId: number) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Check if the company exists
      const company = await this.prismaService.adminCompany.findUnique({
        where: {
          adminID: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (!company) {
        throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
      }

      // Get all warehouses in the company
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;
      const warehouses = await this.prismaService.wareHouse.findMany({
        where: {
          companyId,
        },
        include: {
          //products: true,
          stocks: { include: { product: true } },
        },
      });

      if (warehouses && warehouses.length === 0) {
        throw new HttpException(
          'Please create a warehouse',
          HttpStatus.METHOD_NOT_ALLOWED,
        );
      }

      return {
        status: 'Success',
        message: 'warehouses retrieved successfully',
        data: warehouses,
      };
    } catch (error) {
      throw error;
    }
  }

  async getStocks(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<Stock>> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const company = await this.prismaService.adminCompany.findUnique({
        where: {
          adminID: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (!company) {
        throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
      }

      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const stocks = await paginate(
        this.prismaService.stock,
        paginationDto,

        {
          where: {
            companyId,
          },
          include: {
            product: {
              where: {
                companyId,
              },
            },
            warehouses: {
              where: {
                companyId,
              },
            },
          },
        },
      );

      return {
        status: 'Success',
        message: 'stocks retrieved successfully',
        data: stocks.data as Stock[],
        totalItems: stocks.totalItems,
        currentPage: stocks.currentPage,
        totalPages: stocks.totalPages,
      };
    } catch (error) {
      throw error;
    }
  }

  async getSystemRole(userId: number) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;
      const roles = await this.prismaService.systemRole.findMany({
        // where: {
        //   companyId,
        // },
        include: {
          users: {
            where: {
              companyId,
            },
          },
        },
      });

      if (!roles) {
        throw new HttpException(
          'Please create a role',
          HttpStatus.METHOD_NOT_ALLOWED,
        );
      }

      return {
        status: 'Success',
        message: 'roles retrieved successfully',
        data: roles,
      };
    } catch (error) {
      throw error;
    }
  }

  async deleteCustomRole(userId: number, roleId: number) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const role = await this.prismaService.customRole.findUnique({
        where: { id: roleId, companyId },
      });

      if (!role) {
        throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
      }

      if (role.companyId !== companyId) {
        throw new HttpException(
          'You do not have permission to delete',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Use Prisma transaction for atomic operations
      await this.prismaService.customRole.delete({
        where: { id: roleId, companyId },
      });

      return {
        status: 'Success',
        message: 'role deleted successfully',
      };
    } catch (error) {
      throw error;
    }
  }

  async deleteDepartment(userId: number, departmentId: number) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the department exists
      const department = await this.prismaService.department.findUnique({
        where: { id: departmentId, companyId },
      });

      if (!department) {
        throw new HttpException('Department not found', HttpStatus.NOT_FOUND);
      }

      if (department.companyId !== companyId) {
        throw new HttpException(
          'You do not have permission to delete',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Use Prisma transaction for atomic operations
      await this.prismaService.$transaction(async (tx) => {
        await tx.departmentRole.deleteMany({
          where: {
            department: {
              some: {
                id: departmentId,
                companyId,
              },
            },
          },
        });

        await tx.department.delete({
          where: { id: departmentId, companyId },
        });
      }),
        {
          maxWait: 2000, // default: 2000
          timeout: 5000, // default: 5000
          //isolationLevel: Prisma.TransactionIsolationLevel.Serializable, // optional, default defined by database configuration
        };

      return {
        status: 'Success',
        message: 'Department deleted successfully',
      };
    } catch (error) {
      throw error;
    }
  }

  async deleteDepartmentalRole(userId: number, roleId: number) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the department exists
      const departmentRole = await this.prismaService.departmentRole.findUnique(
        {
          where: { id: roleId },
        },
      );

      if (!departmentRole) {
        throw new HttpException(
          'Department role not found',
          HttpStatus.NOT_FOUND,
        );
      }
      if (departmentRole.companyId !== companyId) {
        throw new HttpException(
          'You do not have permission to delete',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Use Prisma transaction for atomic operations
      await this.prismaService.departmentRole.delete({
        where: {
          id: roleId,
          companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Department role deleted successfully',
      };
    } catch (error) {
      throw error;
    }
  }

  async createDepartmentRole(
    userId: number,
    departmentId: number,
    departmentRoleDto: DepartmentRoleDto,
  ) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the department exists
      const department = await this.prismaService.department.findUnique({
        where: { id: departmentId, companyId },
      });

      if (!department) {
        throw new HttpException('Department not found', HttpStatus.NOT_FOUND);
      }

      // Create the department role
      const createdDepartmentRole =
        await this.prismaService.departmentRole.create({
          data: {
            companyId,
            name: departmentRoleDto.name,
            description: departmentRoleDto.description,
            department: {
              connect: { id: departmentId },
            },
          },
        });

      return {
        status: 'Success',
        message: 'Department role created successfully',
        data: createdDepartmentRole,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating roles',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async addUsersToDepartment(
    userId: number,
    updateUsersInDepartmentDto: AddUsersToDepartmentDto,
  ) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;
      const { departmentId, userIds } = updateUsersInDepartmentDto;

      // Find the department and include current users
      const department = await this.prismaService.department.findUnique({
        where: { id: departmentId },
        include: { users: true },
      });

      if (!department) {
        throw new HttpException('Department not found', HttpStatus.NOT_FOUND);
      }

      // Find the users by their IDs
      const users = await this.prismaService.user.findMany({
        where: { id: { in: userIds } },
        include: { departments: true },
      });

      // Check if any user is not found
      const notFoundUsers = userIds.filter(
        (userId) => !users.find((user) => user.id === userId),
      );

      if (notFoundUsers.length > 0) {
        const errorMessage = `Users with IDs ${notFoundUsers.join(', ')} not found`;
        throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
      }

      const currentUserIdsInDepartment = department.users.map(
        (user) => user.id,
      );

      const usersToAdd = userIds.filter(
        (userId) => !currentUserIdsInDepartment.includes(userId),
      );
      const usersToRemove = currentUserIdsInDepartment.filter(
        (userId) => !userIds.includes(userId),
      );

      // Remove users from the department
      if (usersToRemove.length > 0) {
        await Promise.all(
          usersToRemove.map(async (userId) => {
            await this.prismaService.user.update({
              where: { id: userId, companyId },
              data: {
                departments: {
                  disconnect: { id: departmentId },
                },
              },
            });
          }),
        );
      }

      // Add new users to the department
      if (usersToAdd.length > 0) {
        await Promise.all(
          usersToAdd.map(async (userId) => {
            await this.prismaService.user.update({
              where: { id: userId, companyId },
              data: {
                departments: {
                  connect: { id: departmentId },
                },
              },
            });
          }),
        );
      }

      const updatedUsers = await this.prismaService.user.findMany({
        where: { id: { in: userIds } },
        include: { departments: true },
      });

      return {
        status: 'Success',
        message: 'Users successfully updated in the department',
        data: updatedUsers.map((user) => ({
          ...user,
          password: undefined,
          randomNumber: undefined,
          resetToken: undefined,
          resetTokenExpiresAt: undefined,
        })),
      };
    } catch (error) {
      console.error(error.message);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating users in department',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async addRolesToDepartment(addRolesToDepartmentDto: AddRolesToDepartmentDto) {
    try {
      const {
        departmentId,
        systemRoleIds = [],
        customRoleIds = [],
      } = addRolesToDepartmentDto;

      const department = await this.prismaService.department.findUnique({
        where: { id: departmentId },
        include: { systemRole: true, customRole: true },
      });

      if (!department) {
        throw new HttpException('Department not found', HttpStatus.NOT_FOUND);
      }

      // Find the specified system roles
      let systemRoles = [];
      if (systemRoleIds.length > 0) {
        systemRoles = await this.prismaService.systemRole.findMany({
          where: { id: { in: systemRoleIds } },
        });
      }

      // Find the specified custom roles
      let customRoles = [];
      if (customRoleIds.length > 0) {
        customRoles = await this.prismaService.customRole.findMany({
          where: { id: { in: customRoleIds } },
        });
      }

      // Check for not found system roles
      const notFoundSystemRoles = systemRoleIds.filter(
        (roleId) => !systemRoles.find((role) => role.id === roleId),
      );

      // Check for not found custom roles
      const notFoundCustomRoles = customRoleIds.filter(
        (roleId) => !customRoles.find((role) => role.id === roleId),
      );

      if (notFoundSystemRoles.length > 0 || notFoundCustomRoles.length > 0) {
        const errorMessage = [
          ...notFoundSystemRoles.map(
            (roleId) => `System role ID ${roleId} not found`,
          ),
          ...notFoundCustomRoles.map(
            (roleId) => `Custom role ID ${roleId} not found`,
          ),
        ].join(', ');

        throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
      }

      const currentSystemRoleIds = department.systemRole.map((role) => role.id);
      const currentCustomRoleIds = department.customRole.map((role) => role.id);

      const systemRolesToAdd = systemRoleIds.filter(
        (roleId) => !currentSystemRoleIds.includes(roleId),
      );
      const systemRolesToRemove = currentSystemRoleIds.filter(
        (roleId) => !systemRoleIds.includes(roleId),
      );

      const customRolesToAdd = customRoleIds.filter(
        (roleId) => !currentCustomRoleIds.includes(roleId),
      );
      const customRolesToRemove = currentCustomRoleIds.filter(
        (roleId) => !customRoleIds.includes(roleId),
      );

      // Remove roles from the department
      if (systemRolesToRemove.length > 0) {
        await Promise.all(
          systemRolesToRemove.map(async (roleId) => {
            await this.prismaService.department.update({
              where: { id: departmentId },
              data: {
                systemRole: {
                  disconnect: { id: roleId },
                },
              },
            });
          }),
        );
      }

      if (customRolesToRemove.length > 0) {
        await Promise.all(
          customRolesToRemove.map(async (roleId) => {
            await this.prismaService.department.update({
              where: { id: departmentId },
              data: {
                customRole: {
                  disconnect: { id: roleId },
                },
              },
            });
          }),
        );
      }

      // Add new roles to the department
      if (systemRolesToAdd.length > 0) {
        await Promise.all(
          systemRolesToAdd.map(async (roleId) => {
            await this.prismaService.department.update({
              where: { id: departmentId },
              data: {
                systemRole: {
                  connect: { id: roleId },
                },
              },
            });
          }),
        );
      }

      if (customRolesToAdd.length > 0) {
        await Promise.all(
          customRolesToAdd.map(async (roleId) => {
            await this.prismaService.department.update({
              where: { id: departmentId },
              data: {
                customRole: {
                  connect: { id: roleId },
                },
              },
            });
          }),
        );
      }

      const updatedDepartment = await this.prismaService.department.findUnique({
        where: { id: departmentId },
        include: { systemRole: true, customRole: true },
      });

      return {
        status: 'Success',
        message: 'Roles successfully updated for the department',
        data: updatedDepartment,
      };
    } catch (error) {
      console.error(error.message);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating roles for the department',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async addUsersToCustomRole(addUsersToRoleDto: AddUsersToRoleDto) {
    try {
      // Find the department by ID
      const customRole = await this.prismaService.customRole.findUnique({
        where: { id: addUsersToRoleDto.roleId },
        include: { users: true },
      });

      if (!customRole) {
        throw new HttpException('customRole not found', HttpStatus.NOT_FOUND);
      }

      // Find the users by their IDs
      const users = await this.prismaService.user.findMany({
        where: { id: { in: addUsersToRoleDto.userIds } },
        include: { departments: true },
      });

      // Check if any user is not found
      const notFoundUsers = addUsersToRoleDto.userIds.filter(
        (userId) => !users.find((user) => user.id === userId),
      );

      if (notFoundUsers.length > 0) {
        const notFoundUserNames = notFoundUsers.map((userId) => {
          const user = users.find((u) => u.id === userId);

          return user
            ? user?.primaryContactName || 'Unknown User'
            : `ID ${userId}`;
        });

        const errorMessage =
          notFoundUserNames.length === 1
            ? `User with ${notFoundUserNames[0]} not found`
            : `Users with ${notFoundUserNames.join(', ')} not found`;

        throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
      }

      // Check if users are already in the department
      const usersInRole = users.filter((user) =>
        user.departments.some((d) => d.id === addUsersToRoleDto.roleId),
      );

      if (usersInRole.length === 0) {
        // Add users to the department
        const updatedUsers = await Promise.all(
          addUsersToRoleDto.userIds.map(async (userId) => {
            return this.prismaService.user.update({
              where: { id: userId },
              data: {
                customRoles: {
                  connect: { id: addUsersToRoleDto.roleId },
                },
              },
              include: { customRoles: true },
            });
          }),
        );

        return {
          status: 'Success',
          message: 'Users successfully added',
          data: updatedUsers.map((user) => ({
            ...user,
            password: undefined,
            randomNumber: undefined,
            resetToken: undefined,
            resetTokenExpiresAt: undefined,
          })),
        };
      } else {
        const userNames = usersInRole.map((user) => user?.primaryContactName);
        const errorMessage =
          usersInRole.length === 1
            ? `${userNames[0]} already has role`
            : `${userNames.join(', ')} already have roles`;

        throw new HttpException(errorMessage, HttpStatus.CONFLICT);
      }
    } catch (error) {
      console.error(error.message);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while adding users to role',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getCompanyByAdminId(adminId: number) {
    return await this.prismaService.user.findUnique({
      where: { id: adminId },
      include: {
        adminCompanyId: true,
      },
    });
  }

  async updateCustomRole(
    userId: number,
    roleId: number,
    updateRoleDto: UpdateRoleDto,
  ) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const existingRole = await this.prismaService.customRole.findUnique({
        where: { id: roleId },
      });

      if (!existingRole) {
        throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
      }

      const updatedCustomRole = await this.prismaService.customRole.update({
        where: { id: roleId },
        data: {
          name: updateRoleDto.name,
          description: updateRoleDto.description,
          permissions: updateRoleDto.permissions,
          companyId: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Custom role updated successfully',
        ...updatedCustomRole,
        companyId: undefined,
      };
    } catch (error) {
      console.error(error.message);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating role',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async deleteWarehouse(userId: number, warehouseId: number) {
    try {
      // Check if the user exists with associated relationships
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const warehouse = await this.prismaService.wareHouse.findUnique({
        where: { id: warehouseId, companyId },
        include: { stocks: true },
      });

      if (!warehouse) {
        throw new HttpException('Warehouse not found', HttpStatus.NOT_FOUND);
      }

      if (warehouse.companyId !== companyId) {
        throw new HttpException(
          'You do not have permission to delete this warehouse',
          HttpStatus.UNAUTHORIZED,
        );
      }

      if (warehouse.name.trim() === 'primary') {
        throw new HttpException(
          'Sorry, you cannot delete this warehouse',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Delete the product from associated warehouses
      await Promise.all(
        warehouse.stocks.map(async (stock) => {
          await this.prismaService.stock.delete({
            where: {
              id: stock.id,
              companyId,
            },
          });
        }),
      );

      await this.prismaService.wareHouse.delete({
        where: {
          id: warehouseId,
          companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Warehouse deleted successfully',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while deleting warehouse',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async deleteAllWarehouses(userId: number) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const { count } = await this.prismaService.wareHouse.deleteMany({
        where: {
          companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Warehouse deleted successfully',
        count,
      };
    } catch (error) {
      console.error(error.message);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while deleting warehouse',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async updateUserRoles(updateUserRolesDto: UpdateRoleDto) {
    try {
      const {
        userId,
        systemRoleIds = [],
        customRoleIds = [],
      } = updateUserRolesDto;

      if (!userId) {
        throw new HttpException(
          'Please provide userId',
          HttpStatus.BAD_REQUEST,
        );
      }
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { systemRoles: true, customRoles: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Find the specified system roles
      let systemRoles = [];
      if (systemRoleIds.length > 0) {
        systemRoles = await this.prismaService.systemRole.findMany({
          where: { id: { in: systemRoleIds } },
        });
      }

      // Find the specified custom roles
      let customRoles = [];
      if (customRoleIds.length > 0) {
        customRoles = await this.prismaService.customRole.findMany({
          where: { id: { in: customRoleIds } },
        });
      }

      // Check for not found system roles
      const notFoundSystemRoles = systemRoleIds.filter(
        (roleId) => !systemRoles.find((role) => role.id === roleId),
      );

      // Check for not found custom roles
      const notFoundCustomRoles = customRoleIds.filter(
        (roleId) => !customRoles.find((role) => role.id === roleId),
      );

      if (notFoundSystemRoles.length > 0 || notFoundCustomRoles.length > 0) {
        const errorMessage = [
          ...notFoundSystemRoles.map(
            (roleId) => `System role ID ${roleId} not found`,
          ),
          ...notFoundCustomRoles.map(
            (roleId) => `Custom role ID ${roleId} not found`,
          ),
        ].join(', ');

        throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
      }

      const currentSystemRoleIds = user.systemRoles.map((role) => role.id);
      const currentCustomRoleIds = user.customRoles.map((role) => role.id);

      const systemRolesToAdd = systemRoleIds.filter(
        (roleId) => !currentSystemRoleIds.includes(roleId),
      );
      const systemRolesToRemove = currentSystemRoleIds.filter(
        (roleId) => !systemRoleIds.includes(roleId),
      );

      const customRolesToAdd = customRoleIds.filter(
        (roleId) => !currentCustomRoleIds.includes(roleId),
      );
      const customRolesToRemove = currentCustomRoleIds.filter(
        (roleId) => !customRoleIds.includes(roleId),
      );

      // Remove roles from the user
      if (systemRolesToRemove.length > 0) {
        await Promise.all(
          systemRolesToRemove.map(async (roleId) => {
            await this.prismaService.user.update({
              where: { id: userId },
              data: {
                systemRoles: {
                  disconnect: { id: roleId },
                },
              },
            });
          }),
        );
      }

      if (customRolesToRemove.length > 0) {
        await Promise.all(
          customRolesToRemove.map(async (roleId) => {
            await this.prismaService.user.update({
              where: { id: userId },
              data: {
                customRoles: {
                  disconnect: { id: roleId },
                },
              },
            });
          }),
        );
      }

      // Add new roles to the user
      if (systemRolesToAdd.length > 0) {
        await Promise.all(
          systemRolesToAdd.map(async (roleId) => {
            await this.prismaService.user.update({
              where: { id: userId },
              data: {
                systemRoles: {
                  connect: { id: roleId },
                },
              },
            });
          }),
        );
      }

      if (customRolesToAdd.length > 0) {
        await Promise.all(
          customRolesToAdd.map(async (roleId) => {
            await this.prismaService.user.update({
              where: { id: userId },
              data: {
                customRoles: {
                  connect: { id: roleId },
                },
              },
            });
          }),
        );
      }

      const updatedUser = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { systemRoles: true, customRoles: true },
      });

      return {
        status: 'Success',
        message: 'User roles successfully updated',
        data: updatedUser,
      };
    } catch (error) {
      console.error(error.message);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating user roles',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async editWarehouse(
    userId: number,
    warehouseId: number,
    wareHouseDto: wareHouseDto,
  ) {
    try {
      // Check if the user (admin or employee) exists
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: { adminCompanyId: true, employeeId: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Check if the warehouse exists
      const existingWarehouse = await this.prismaService.wareHouse.findUnique({
        where: { id: warehouseId },
      });

      if (!existingWarehouse) {
        throw new HttpException('Warehouse not found', HttpStatus.NOT_FOUND);
      }

      // Ensure that the user has permission to edit the warehouse
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;
      if (existingWarehouse.companyId !== companyId) {
        throw new HttpException(
          'You do not have permission to edit this warehouse',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Update the warehouse with the new data
      const updatedWarehouse = await this.prismaService.wareHouse.update({
        where: { id: warehouseId },
        data: {
          name: wareHouseDto.name,
          address: wareHouseDto.address,
          companyEmail: wareHouseDto.companyEmail,
          ...wareHouseDto,
        },
      });

      return {
        status: 'Success',
        message: 'Warehouse updated successfully',
        ...updatedWarehouse,
        companyId: undefined,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating warehouse',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getBanks(page: number, limit: number, search?: string) {
    try {
      const banks = await this.paystackService.getBanks();

      const filteredBanks = search
        ? banks.filter((bank) =>
            bank.name.toLowerCase().includes(search.toLowerCase()),
          )
        : banks;

      const start = (page - 1) * limit;
      const end = page * limit;
      const paginatedBanks = filteredBanks.slice(start, end);

      return {
        status: 'Success',
        message: 'Banks retrieved successfully',
        data: paginatedBanks,
        total: filteredBanks.length,
        page,
        limit,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching banks',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async validateBankDetails(accountNumber: string, bankCode: string) {
    try {
      const bank = await this.paystackService.validateBankDetails(
        accountNumber,
        bankCode,
      );

      return {
        status: 'Success',
        message: 'Account successfully verified',
        data: bank,
      };
    } catch (error) {
      //this.logger.error('Error fetching paginated banks', error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while validating bank',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async resetCompanyInventory(userId: number): Promise<any> {
    const service = 'resetCompanyInventory';

    const user = await this.usersService.findUserWithRelationships(userId);
    const companyId =
      user.adminCompanyId?.adminID || user.employeeId?.companyId;

    if (!companyId) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    await this.prismaService.$transaction(
      async (prisma) => {
        try {
          // Delete salesTransactions related to the company's Product
          await prisma.salesTransaction.deleteMany({
            where: { Product: { companyId } },
          });
          this.logger.log(
            'Deleted all sales transactions for the company',
            companyId,
            service,
          );

          // Delete purchasesTransaction related to the company's Product
          await prisma.purchasesTransaction.deleteMany({
            where: { Product: { companyId } },
          });
          this.logger.log(
            'Deleted all purchases transactions for the company',
            companyId,
            service,
          );

          // Delete purchaseOrderConfirmation related to the company's
          await prisma.purchaseOrderConfirmation.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all purchase order confirmations for the company',
            companyId,
            service,
          );

          // Delete payments related to the company's invoices
          await prisma.payment.deleteMany({
            where: { invoice: { companyId } },
          });
          this.logger.log(
            'Deleted all payments for the company’s invoices',
            companyId,
            service,
          );

          // Delete loanReturn related to the company
          await prisma.loanReturn.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all loan returns for the company',
            companyId,
            service,
          );

          // Delete all loan requests related to the company
          await prisma.loanRequest.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all loan requests for the company',
            companyId,
            service,
          );

          // Delete all invoices tied to the company
          await prisma.invoice.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all invoices for the company',
            companyId,
            service,
          );

          // Delete payments related to the company's invoices
          await prisma.request.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all requests for the company',
            companyId,
            service,
          );

          // Delete all orders tied to the company
          await prisma.salesOrder.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all sales orders for the company',
            companyId,
            service,
          );

          await prisma.purchaseOrder.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all purchase orders for the company',
            companyId,
            service,
          );

          // Delete all stocks related to the company's products
          await prisma.stock.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all stocks for the company',
            companyId,
            service,
          );

          // Delete all products related to the company
          await prisma.product.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all products for the company',
            companyId,
            service,
          );

          // Delete all systemNotifications related to the company
          await prisma.systemNotifications.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all system notifications for the company',
            companyId,
            service,
          );

          // Delete all inAppNotifications related to the company
          await prisma.inAppNotifications.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all in-app notifications for the company',
            companyId,
            service,
          );

          // Delete all stockRequest related to the company
          await prisma.stockRequest.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all stock requests for the company',
            companyId,
            service,
          );

          // Delete all taskActivities tied to the company
          await prisma.taskActivities.deleteMany({
            where: { task: { companyId } },
          });
          this.logger.log(
            'Deleted all task activities for the company',
            companyId,
            service,
          );

          // Delete all taskComment tied to the company
          await prisma.taskComment.deleteMany({
            where: { task: { companyId } },
          });
          this.logger.log(
            'Deleted all task comments for the company',
            companyId,
            service,
          );

          // Delete all tasks tied to the company
          await prisma.task.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all tasks for the company',
            companyId,
            service,
          );

          this.logger.verbose(
            `Inventory data has been reset for the company.`,
            companyId,
            service,
          );

          // Delete all batchLog tied to the company
          await prisma.batchLog.deleteMany({
            where: { companyId },
          });
          this.logger.log(
            'Deleted all batchLog for the company',
            companyId,
            service,
          );

          this.logger.verbose(
            `Inventory data has been reset for the company.`,
            companyId,
            service,
          );

          // throw error;
        } catch (error) {
          this.logger.error(
            'Error resetting company inventory:',
            error.stack,
            companyId,
            service,
          );
          throw error;
        }
      },
      { isolationLevel: 'Serializable', timeout: 60000 },
    );

    this.logger.log(
      `Successfully reset inventory for the company`,
      companyId,
      service,
    );

    return {
      status: 'Success',
      message: 'Reset Successfully',
    };
  }
}
