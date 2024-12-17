import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { PrismaService } from 'src/common';
import { AdminService } from 'src/admin/admin.service';
import { Prisma, Status, User, UserType } from '@prisma/client';
import { generateEmployeeID } from 'src/common/utils/generate.password';
import { UserDto } from './dto/create-user.dto';
import { MailService } from 'src/common/mail/mail.service';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly adminService: AdminService,
    private readonly mailService: MailService,
  ) {}

  async createEmployee(
    userId: number,
    createEmployeeDto: CreateEmployeeDto,
    userDto: UserDto,
  ) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: {
          adminCompanyId: true,
          employeeId: { include: { Company: true } },
        },
      });

      if (!user) {
        throw new HttpException('Credentials not found', HttpStatus.NOT_FOUND);
      }

      const companyId =
        user?.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the user initiating the invitation is an admin
      const initiatingUser = await this.prismaService.user.findFirst({
        where: { companyEmail: userDto.companyEmail, companyId },
        select: { userType: true },
      });

      if (initiatingUser && initiatingUser.userType === UserType.ADMIN) {
        throw new HttpException(
          'Admins cannot send invitations to themselves',
          HttpStatus.FORBIDDEN,
        );
      }

      // Check if employee with the same email already exists
      const existingEmployee = await this.getEmployeeByEmail(
        userDto.companyEmail,
        companyId,
      );

      if (existingEmployee) {
        throw new HttpException(
          'Employee with this email already exists',
          HttpStatus.CONFLICT,
        );
      }

      // Check if employee with the same email already exists
      const existingUser = await this.getUserByEmail(userDto.companyEmail);

      if (existingUser) {
        throw new HttpException('Email already exists', HttpStatus.CONFLICT);
      }

      // Generate random password
      const randomPassword = generateEmployeeID(20);

      // Wrap the following database operations in a transaction
      const result = await this.prismaService.$transaction(async (prisma) => {
        //console.log(randomPassword);
        const employeeUser = await prisma.user.create({
          data: {
            companyEmail: userDto.companyEmail,
            companyId,
            phone: userDto.phone,
            primaryContactName: userDto.primaryContactName,
            userType: UserType.EMPLOYEE,
            status: Status.Deactivate,
            randomNumber: await bcrypt.hash(randomPassword, 10),
            systemRoles: {
              connect: (userDto.systemRoles || []).map((role) => ({
                id: role.id,
              })),
            },
            customRoles: {
              connect: (userDto?.customRoles || [])?.map((role) => ({
                id: role?.id,
                companyId,
              })),
            },
            resetToken: new Date(),
            resetTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });

        // Update each system role individually
        for (const roles of userDto.systemRoles || []) {
          await prisma.systemRole.update({
            where: { id: roles.id },
            data: {
              companies: {
                connect: { id: user?.adminCompanyId?.id },
              },
              users: {
                connect: { id: employeeUser.id },
              },
            },
          });
        }

        const employee = await prisma.employee.create({
          data: {
            user_employeeID: employeeUser.id,
            ...createEmployeeDto,
            companyId,
            registeredBy: user.primaryContactName,
            companyEmail: employeeUser.companyEmail,
          },
        });

        return {
          employeeUser,
          employee,
          randomPassword,
        };
      });

      // Send user confirmation email outside of the transaction
      const userRoles = await this.getEmployeeRoles(result.employeeUser.id);

      const organizationName =
        user?.adminCompanyId?.organizationName ||
        user?.employeeId?.Company?.organizationName;

      await this.mailService.sendEmployeeConfirmation(
        result,
        randomPassword,
        userRoles,
        organizationName,
      );

      return {
        status: 'successful',
        message: 'Invitation successfully sent',
        data: {
          ...result.employeeUser,
          ...result.employee,
          randomNumber: undefined,
          password: undefined,
          adminId: undefined,
          companyId: undefined,
          user_employeeID: undefined,
        },
      };
    } catch (error) {
      console.log(error);
      if (error.code === 'P2025') {
        throw new HttpException(
          'Please create custom roles before inviting employees',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (error instanceof Prisma.PrismaClientValidationError) {
        console.log(error);
        throw new HttpException(
          'An error occurred while creating employee',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error.message;
    }
  }

  async bulkCreateEmployees(userId: number, userDto: UserDto[]) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: {
          adminCompanyId: true,
          employeeId: { include: { Company: true } },
        },
      });

      if (!user) {
        throw new HttpException('Credentials not found', HttpStatus.NOT_FOUND);
      }

      const companyId =
        user?.adminCompanyId?.adminID || user.employeeId?.companyId;

      const createdUsers = [];
      const generatedPasswords = [];

      // Create a Set to store emails for uniqueness check
      const emailSet = new Set();

      const result = await this.prismaService.$transaction(async (prisma) => {
        for (const createEmployeeDto of userDto) {
          const email = createEmployeeDto.companyEmail.toLowerCase();

          // Check if email is already in the Set
          if (emailSet.has(email)) {
            throw new HttpException(
              `Employee with email ${email} already exists in the current batch`,
              HttpStatus.CONFLICT,
            );
          }

          // Add email to the Set
          emailSet.add(email);

          // Check for existing employee in the database
          const existingEmployee = await this.getEmployeeByEmail(
            email,
            companyId,
          );

          if (existingEmployee) {
            throw new HttpException(
              `Employee with email ${email} already exists`,
              HttpStatus.CONFLICT,
            );
          }

          // Check for existing user in the database
          const existingUser = await this.getUserByEmail(email);
          if (existingUser) {
            throw new HttpException(
              `User with email ${email} already exists`,
              HttpStatus.CONFLICT,
            );
          }

          const randomPassword = generateEmployeeID(10);
          const encryptedPassword = await bcrypt.hash(randomPassword, 10);

          const employeeUser = await prisma.user.create({
            data: {
              companyEmail: email,
              companyId,
              phone: createEmployeeDto.phone,
              primaryContactName: createEmployeeDto.primaryContactName,
              userType: UserType.EMPLOYEE,
              status: Status.Active,
              password: encryptedPassword,
              systemRoles: {
                connect: (createEmployeeDto.systemRoles || []).map((role) => ({
                  id: role.id,
                })),
              },
              customRoles: {
                connect: (createEmployeeDto.customRoles || []).map((role) => ({
                  id: role.id,
                  companyId,
                })),
              },
            },
          });

          const employee = await prisma.employee.create({
            data: {
              user_employeeID: employeeUser.id,
              companyId,
              registeredBy: user.primaryContactName,
              companyEmail: employeeUser.companyEmail,
            },
          });

          createdUsers.push({ employeeUser, employee });
          generatedPasswords.push({
            user: employeeUser,
            primaryContactName: employeeUser.primaryContactName,
            email: employeeUser.companyEmail,
            password: randomPassword,
            organizationName:
              user?.adminCompanyId?.organizationName ||
              user?.employeeId?.Company?.organizationName,
          });
        }

        return { createdUsers, generatedPasswords };
      });

      // Send confirmation emails to employees
      for (const {
        user,
        password,
        organizationName,
      } of result.generatedPasswords) {
        await this.mailService.sendEmployeeInvite(
          user,
          password,
          'Employee',
          organizationName,
        );
      }

      // Send summary email to admin with all employee login details
      const adminEmailData = result.generatedPasswords.map(
        ({ primaryContactName, email, password, organizationName }) => ({
          primaryContactName,
          email,
          password,
          organizationName,
        }),
      );

      await this.mailService.sendAdminNotification(user, adminEmailData);

      return {
        status: 'successful',
        message: 'Employee(s) successfully created and invitations sent',
        data: result.createdUsers.map((user) => ({
          ...user.employeeUser,
          ...user.employee,
          password: undefined,
          randomNumber: undefined,
          adminId: undefined,
          companyId: undefined,
          user_employeeID: undefined,
        })),
      };
    } catch (error) {
      console.log(error);
      if (error.code === 'P2025') {
        throw new HttpException(
          'Please create custom roles before inviting employees',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating employees',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getAllEmployeesInCompany(userId: number) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: {
          adminCompanyId: true,
          employeeId: true,
        },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Find the company by user's company ID
      const companies = await this.prismaService.adminCompany.findMany({
        where: {
          adminID: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
        include: { employees: { include: { user: true } } },
      });

      if (!companies || companies.length === 0) {
        throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
      }

      const employees = await Promise.all(
        companies.flatMap(async (company) => {
          const companyEmployees = company.employees;
          const companyId = company.adminID;
          const employeesWithUserDetails = await Promise.all(
            companyEmployees.map(async (employee) => {
              const user = await this.prismaService.user.findUnique({
                where: { id: employee.user_employeeID },
                include: {
                  customRoles: { where: { companyId } },
                  systemRoles: {
                    where: {
                      users: {
                        some: {
                          companyId,
                        },
                      },
                    },
                  },
                  departments: {
                    include: {
                      departmentRoles: true,
                      systemRole: {
                        where: {
                          users: {
                            some: {
                              companyId,
                            },
                          },
                        },
                      },
                      customRole: { where: { companyId } },
                    },
                  },
                  image: true,
                },
              });

              if (!user) {
                console.log('no user');
                return null;
              }

              return {
                ...employee,
                user: {
                  ...user,
                  password: undefined,
                  randomNumber: undefined,
                  resetToken: undefined,
                  resetTokenExpiresAt: undefined,
                },
              };
            }),
          );

          // Remove null values (users not found) from the array
          return employeesWithUserDetails.filter(Boolean);
        }),
      );

      // Fetch the admin owner for each company
      const admin = await Promise.all(
        companies.map(async (company) => {
          const companyId = company.adminID;
          const adminOwner = await this.prismaService.user.findUnique({
            where: { id: company.adminID },
            include: {
              adminCompanyId: true,
              image: true,
              customRoles: { where: { companyId } },
              systemRoles: {
                where: {
                  users: {
                    some: {
                      companyId,
                    },
                  },
                },
              },
            },
          });
          return adminOwner;
        }),
      );

      return {
        status: 'Success',
        message: 'Employees retrieved successfully',
        data: { employees, admin },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching employees',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getEmployeeByEmail(companyEmail: string, companyId: number) {
    return this.prismaService.user.findFirst({
      where: { companyEmail, companyId },
      include: {
        employeeId: true,
        adminCompanyId: true,
      },
    });
  }

  private async getUserByEmail(companyEmail: string) {
    return this.prismaService.user.findFirst({
      where: { companyEmail },
      include: {
        employeeId: true,
      },
    });
  }

  async getEmployeeByEmployeeId(
    randomNumber: string,
    companyId: number,
  ): Promise<User | null> {
    return this.prismaService.user.findFirst({
      where: { randomNumber, companyId },
      include: {
        employeeId: true,
      },
    });
  }

  async getEmployeeRoles(employeeId: number) {
    const userRoles = await this.prismaService.user.findUnique({
      where: { id: employeeId },
      select: {
        systemRoles: { select: { name: true } },
        customRoles: { select: { name: true } },
      },
    });

    const formattedRoles = {
      roles: [
        ...userRoles.systemRoles.map((role) => role.name),
        ...userRoles.customRoles.map((role) => role.name),
      ],
    };

    return formattedRoles.roles;
  }
}
