import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto } from './dto/create-user.dto';
import {
  PrismaService,
  SerialNumberService,
  CloudinaryService,
} from 'src/common';
import { GetUserDto } from './dto/get-user-dto';
import { Prisma, PrismaClient, Status, User, UserType } from '@prisma/client';
import { generateRandomPassword } from 'src/common/utils/generate.password';
import { CreateAdminCompanyDto } from './dto/adminCompanyDto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CreateSystemRoleDto } from './dto/create-system-role.dto';
import { employeeResetPasswordDto } from './dto/employee-reset-password.dto';
import { MailService } from 'src/common/mail/mail.service';
import { OTPService } from 'src/common/OTP';
import { PasswordRecoveryDto } from './dto/password-recovery.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly mailService: MailService,
    private readonly serialNumberService: SerialNumberService,
    private readonly otpService: OTPService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  /*********************** ADMIN PERSONAL INFORMATION *****************************/

  async createAdmin(
    createAdminComapany: CreateAdminCompanyDto,
    createUserDto: CreateUserDto,
    file?: Express.Multer.File,
  ) {
    try {
      await this.validateAdminAndCompanyDto(createAdminComapany, createUserDto);
      const randomPassword = generateRandomPassword(20);
      console.log(randomPassword);

      const user = await this.prismaService.user.create({
        data: {
          companyEmail: createUserDto.companyEmail,
          phone: createUserDto.phone,
          password: createUserDto.password,
          primaryContactName: createUserDto.primaryContactName,
          userType: UserType.ADMIN,
          status: Status.Active,
          randomNumber: await bcrypt.hash(randomPassword, 10),
          systemRoles: {
            connect: { name: 'ADMIN' },
          },
        },
      });

      // Fetch the existing ADMIN role
      const adminRole = await this.prismaService.systemRole.findUnique({
        where: { name: 'ADMIN' },
      });

      if (!adminRole) {
        throw new Error('ADMIN role not found');
      }

      await this.prismaService.user.update({
        where: { id: user.id },
        data: {
          companyId: user.id,
        },
      });

      const company = await this.prismaService.adminCompany.create({
        data: {
          ...createAdminComapany,
          companyEmail: user.companyEmail,
          adminID: user.id,
          organizationName: createAdminComapany.organizationName,
          companyAddress: createAdminComapany.companyAddress,
        },
      });

      await this.prismaService.systemRole.update({
        where: { id: adminRole.id },
        data: {
          companies: {
            connect: { id: company.id },
          },
          users: {
            connect: { id: user.id },
          },
        },
      });

      await this.prismaService.wareHouse.create({
        data: {
          name: 'primary',
          companyId: user.id,
          companyEmail: user.companyEmail,
          address: 'Primary Warehouse',
        },
      });

      await this.prismaService.category.create({
        data: {
          name: 'primary',
          companyId: user.id,
        },
      });

      const transactionResult = { user, company };

      // Send user confirmation email
      if (transactionResult) {
        console.log(randomPassword);
        await this.mailService.sendAdminConfirmation(
          transactionResult,
          randomPassword,
        );
      }

      return {
        status: 'successfull',
        message: 'Please check your email to setup your account',
        data: {
          ...transactionResult.user,
          ...transactionResult.company,
          randomNumber: undefined,
          password: undefined,
          resetToken: undefined,
          resetTokenExpiresAt: undefined,
          adminID: undefined,
          companyId: undefined,
        },
      };
    } catch (error) {
      console.log(error);
      // Handle the Prisma error
      if (error.code === 'P2025') {
        throw new HttpException(
          'Please create system roles before setting up account',
          HttpStatus.BAD_REQUEST,
        );
      } else if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating user',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async updateUser(
    userId: number,
    updateUserDto: UpdateUserDto,
    file?: Express.Multer.File,
  ): Promise<any> {
    try {
      const user = await this.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const existingUser = await this.prismaService.user.findUnique({
        where: { id: userId, companyId },
        include: { image: true },
      });

      if (!existingUser) {
        throw new HttpException(
          `User with id number ${userId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      let image = null;
      if (file) {
        // Delete the previous image if it exists
        if (existingUser.image) {
          await this.cloudinaryService.deleteImage(existingUser.image.publicId);
        }

        const imagesLink = await this.cloudinaryService
          .uploadImage(file)
          .catch((error) => {
            throw new HttpException(error, HttpStatus.BAD_REQUEST);
          });

        // Check if the user already has an image
        if (existingUser.image) {
          // If the user has an existing image, update it
          image = await this.prismaService.image.update({
            where: { id: existingUser.image.id }, // Use existing image ID
            data: {
              publicId: imagesLink.public_id,
              url: imagesLink.url,
              //companyId,
            },
          });
        } else {
          // If the user doesn't have an existing image, create a new one
          image = await this.prismaService.image.create({
            data: {
              publicId: imagesLink.public_id,
              url: imagesLink.url,
              //companyId,
            },
          });
        }
      }

      // Update the user data
      const updatedUser = await this.prismaService.user.update({
        where: { id: userId },
        data: {
          phone: updateUserDto.phone,
          password: updateUserDto.password,
          primaryContactName: updateUserDto.primaryContactName,
          gender: updateUserDto.gender,
          ...updateUserDto,
          imageId: image?.id,
        },
        include: { image: true },
      });

      return {
        status: 'Success',
        message: 'User profile updated successfully',
        data: {
          ...updatedUser,
          resetPassword: undefined,
          password: undefined,
          otp: undefined,
          otpExpiration: undefined,
          resetToken: undefined,
          resetTokenExpiresAt: undefined,
          passwordReset: undefined,
          companyId: undefined,
          otpExpiryTime: undefined,
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating profile',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async validateAdminAndCompanyDto(
    createAdminComapany: CreateAdminCompanyDto,
    createUserDto: CreateUserDto,
  ) {
    try {
      // Check if an admin with the same email already exist
      const admin = await this.prismaService.user.findFirst({
        where: { companyEmail: createUserDto.companyEmail },
      });

      // console.log(adminExists);

      if (admin) {
        throw new HttpException('Email already exists', HttpStatus.CONFLICT);
      }

      // Check if a company with the same name or email already exists
      const company = await this.prismaService.adminCompany.findUnique({
        where: { organizationName: createAdminComapany.organizationName },
      });

      if (company) {
        throw new HttpException(
          'Company name already exists',
          HttpStatus.CONFLICT,
        );
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while validating user',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async verifyUser(companyEmail: string, password: string) {
    try {
      // Find all users with the provided email
      const user = await this.prismaService.user.findFirst({
        where: { companyEmail },
        include: { employeeId: true, adminCompanyId: true },
      });

      if (!user) {
        throw new HttpException('Invalid user', HttpStatus.UNAUTHORIZED);
      }

      if (user.status !== Status.Active) {
        throw new HttpException('Account Inactive', HttpStatus.UNAUTHORIZED);
      }

      // Check if the user has a password
      if (!user.password) {
        throw new HttpException(
          'Please reset your password before login',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Check if the provided password matches
      const isPasswordMatch = bcrypt.compareSync(password, user.password);

      if (!isPasswordMatch) {
        throw new HttpException(
          'Invalid email or password',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Fetch user based on userType for the matched user
      let fetchedUser: any;
      const adminId = user?.adminCompanyId?.adminID;
      const employeeId = user?.employeeId?.companyId;
      const companyId = adminId || employeeId;

      if (user.userType === 'ADMIN') {
        fetchedUser = await this.prismaService.adminCompany.findFirst({
          where: { companyEmail },
          include: {
            user: { include: { image: { where: { companyId } } } },
            logo: { where: { companyId } },
            packagingMetric: { where: { companyId } },
          },
        });
      } else if (user.userType === 'SUPPLIER') {
        fetchedUser = await this.prismaService.supplier.findFirst({
          where: { companyEmail, companyId },
          include: { Company: true },
        });
      } else if (user.userType === 'EMPLOYEE') {
        fetchedUser = await this.prismaService.employee.findFirst({
          where: { companyEmail, companyId },
          //include: { user: true, Company: true },
          include: {
            user: { include: { image: { where: { companyId } } } },
            Company: {
              include: {
                logo: { where: { companyId } },
                packagingMetric: { where: { companyId } },
              },
            },
          },
        });
      }
      //
      return fetchedUser;
    } catch (error) {
      throw error;
    }
  }

  async getUser(getUserDto: GetUserDto): Promise<User | null> {
    try {
      const { id } = getUserDto;
      const user = await this.prismaService.user.findUnique({
        where: { id },
        include: { adminCompanyId: true, image: true },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          // Handle case where the record (user) was not found
          return null;
        } else if (error.code === 'P1017') {
          // Handle case where there's a constraint violation (e.g., unique constraint)
          throw new Error(
            'User retrieval failed due to a constraint violation.',
          );
        } else {
          // Handle other Prisma request errors (e.g., database connection issues)
          throw new Error('An error occurred while fetching the user.');
        }
      } else if (error instanceof Prisma.PrismaClientUnknownRequestError) {
        // Handle unknown Prisma request errors
        throw new Error('An unexpected Prisma request error occurred.');
      } else {
        if (error instanceof Prisma.PrismaClientValidationError) {
          throw new HttpException(
            'An error occurred while fetching records',
            HttpStatus.BAD_REQUEST,
          );
        }
        // Handle other unexpected errors (e.g., network issues, unhandled exceptions)
        throw new Error('An unexpected error occurred.');
      }
    }
  }

  async getUserById(userId: number, id: number) {
    try {
      const person = await this.findUserWithRelationships(userId);
      const companyId =
        person.adminCompanyId?.adminID || person.employeeId?.companyId;

      let user: User;

      user = await this.prismaService.user.findUnique({
        where: { id, companyId },
        include: {
          adminCompanyId: { include: { logo: true } },
          image: true,
          employeeId: true,
        },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Include related entities based on userType
      if (user.userType === 'CUSTOMER') {
        user = await this.prismaService.user.findUnique({
          where: { id: userId },
          include: {
            customRoles: true,
            systemRoles: true,
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
                customRole: true,
              },
            },
            image: true,
          },
        });
      } else if (user.userType === 'ADMIN') {
        user = await this.prismaService.user.findUnique({
          where: { id: userId },
          include: {
            adminCompanyId: true,
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
            // systemRoles: {
            //   where: {
            //     companies: {
            //       some: {
            //         adminID: companyId,
            //       },
            //     },
            //   },
            // },
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
      } else if (user.userType === 'SUPPLIER') {
        user = await this.prismaService.user.findUnique({
          where: { id: userId },
          include: {
            customRoles: true,
            systemRoles: true,
            departments: {
              include: {
                departmentRoles: true,
                systemRole: true,
                customRole: true,
              },
            },
            image: true,
          },
        });
      } else if (user.userType === 'EMPLOYEE') {
        user = await this.prismaService.user.findUnique({
          where: { id: userId },
          include: {
            employeeId: true,
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
      }
      return {
        status: 'Success',
        message: 'User successfully retrieved',
        ...user,
        password: undefined,
        randomNumber: undefined,
        resetToken: undefined,
        resetTokenExpiresAt: undefined,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching record',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async adminResetPassword(resetPassword: ResetPasswordDto) {
    try {
      const admin = await this.prismaService.adminCompany.findFirst({
        where: { companyEmail: resetPassword.companyEmail },
        include: { user: true },
      });

      // Check if the user exists
      if (!admin) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      if (resetPassword.newPassword !== resetPassword.confirmPassword) {
        throw new HttpException(
          'Passwords must match',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Check if the oldPassword matches the user's current password (you need to compare hashes)
      const oldPasswordMatches = await bcrypt.compare(
        resetPassword.oldPassword,
        admin.user.randomNumber,
      );

      if (!oldPasswordMatches) {
        throw new HttpException(
          'Invalid Default password',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Update the user's password with the new password
      await this.prismaService.user.update({
        where: { id: admin.user.id },
        data: { password: await bcrypt.hash(resetPassword.newPassword, 10) },
      });

      return { status: 'Success', message: 'Password reset successful' };
    } catch (error) {
      throw error;
    }
  }

  async employeeResetPassword(employeeResetPassword: employeeResetPasswordDto) {
    try {
      const employee = await this.prismaService.employee.findFirst({
        where: { companyEmail: employeeResetPassword.companyEmail },
        include: { user: true },
      });

      // Check if the user exists
      if (!employee) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      if (employee.user.resetTokenExpiresAt < new Date()) {
        throw new HttpException(
          'Expired Invitation link',
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }

      if (
        employeeResetPassword.newPassword !==
        employeeResetPassword.confirmPassword
      ) {
        throw new HttpException(
          'Passwords must match',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const employeeID = await bcrypt.compare(
        employeeResetPassword.employeeID,
        employee.user.randomNumber,
      );

      if (!employeeID) {
        throw new HttpException(
          'Incorrect employeeID',
          HttpStatus.UNAUTHORIZED,
        );
      }

      await this.prismaService.user.update({
        where: { id: employee.user.id },
        data: {
          password: await bcrypt.hash(employeeResetPassword.newPassword, 10),
          primaryContactName: employeeResetPassword.primaryContactName,
          status: Status.Active,
          resetTokenExpiresAt: null,
          resetToken: null,
        },
      });

      return { status: 'Success', message: 'Password reset successful' };
    } catch (error) {
      throw error;
    }
  }

  async findUserWithRelationships(userId: number) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        include: {
          employeeId: true,
          adminCompanyId: true,
        },
      });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      return user;
    } catch (error) {
      throw error;
    }
  }

  async getSystemRoles() {
    try {
      const roles = await this.prismaService.systemRole.findMany({});

      if (!roles) {
        throw new HttpException(
          'System roles not found',
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

  async getUserPermissions(userId: number) {
    try {
      const user = await this.findUserWithRelationships(userId);
      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const adminId = user.adminCompanyId?.adminID;
      const employeeId = user.employeeId?.companyId;
      const companyId = adminId || employeeId;

      if (!companyId) {
        throw new HttpException('Company ID not found', HttpStatus.NOT_FOUND);
      }

      const users = await this.prismaService.user.findMany({
        where: { companyId },
        include: {
          customRoles: {
            where: { companyId },
          },
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

      const usersWithApproverPermission = users.filter(
        (user) =>
          user.customRoles.some(
            (customRole) =>
              (customRole.permissions as { approver?: boolean })?.approver ===
              true,
          ) ||
          user.systemRoles.some(
            (systemRole) =>
              (systemRole.permissions as { approver?: boolean })?.approver ===
              true,
          ),
      );

      if (usersWithApproverPermission.length === 0) {
        throw new HttpException(
          'No user with permission',
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        status: 'Successful',
        data: usersWithApproverPermission,
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

  async generateSerialNumber(prefix: string, module: string, userId: number) {
    const user = await this.findUserWithRelationships(userId);
    const adminId = user?.adminCompanyId?.adminID;
    const employeeId = user?.employeeId?.companyId;
    const companyId = adminId || employeeId;
    return this.serialNumberService.reserveSerialNumber(
      prefix,
      module,
      companyId,
    );
  }

  async generateBatchNumber(prefix: string, module: string, userId: number) {
    const user = await this.findUserWithRelationships(userId);
    const adminId = user?.adminCompanyId?.adminID;
    const employeeId = user?.employeeId?.companyId;
    const companyId = adminId || employeeId;
    return this.serialNumberService.generateBatchNumber(
      prefix,
      module,
      companyId,
    );
  }

  async forgotPassword(passwordRecoveryDto: PasswordRecoveryDto) {
    try {
      const user = await this.getUserByEmail(passwordRecoveryDto.companyEmail);

      await this.checkUserExistence(user);

      // Generate OTP
      const { otp, otpExpiryTime } = this.otpService.OTPGenerator(6);

      // Save OTP to database
      const newUser = await this.prismaService.user.update({
        where: { id: user.id },
        data: { otp, otpExpiryTime, passwordReset: false },
      });

      if (newUser) {
        // Send OTP via messaging service
        await this.mailService.forgotPassword(newUser);
      }
      return {
        message: 'Password reset initiated. Check your email for the OTP',
        ...newUser,
        otp: undefined,
        otpExpiryTime: undefined,
        password: undefined,
        companyId: undefined,
        resetTokenExpiresAt: undefined,
        resetToken: undefined,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException('An error occurred', HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  async sendOTP(passwordRecoveryDto: PasswordRecoveryDto) {
    try {
      const user = await this.getUserByEmail(passwordRecoveryDto.companyEmail);

      await this.checkUserExistence(user);

      // Generate OTP
      const { otp, otpExpiryTime } = this.otpService.OTPGenerator(6);
      //console.log(otp);

      // Save OTP to database
      const newUser = await this.prismaService.user.update({
        where: { id: user.id },
        data: { otp, otpExpiryTime, passwordReset: false },
      });

      if (newUser) {
        await this.mailService.forgotPassword(newUser);
      }

      return {
        message: 'OTP sent successfully',
        //otp: otp,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while sending OTP',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async verifyOTP(passwordRecoveryDto: PasswordRecoveryDto) {
    try {
      const user = await this.getUserByEmail(passwordRecoveryDto.companyEmail);

      await this.checkUserExistence(user);

      if (user.otp !== passwordRecoveryDto.otp) {
        throw new HttpException(`Invalid OTP`, HttpStatus.BAD_REQUEST);
      }

      if (user.otpExpiryTime < new Date()) {
        throw new HttpException('OTP Expired', HttpStatus.BAD_REQUEST);
      }

      if (user.passwordReset === true) {
        throw new HttpException('OTP already verified', HttpStatus.BAD_REQUEST);
      }

      await this.prismaService.user.update({
        where: { id: user.id },
        data: {
          passwordReset: true,
          otp: null,
          otpExpiryTime: null,
        },
      });

      // You might also want to return some information for the frontend (e.g., user ID)
      return {
        status: 'success',
        message: 'OTP verification successfull',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while verifying OTP',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async resetPassword(passwordRecoveryDto: PasswordRecoveryDto) {
    try {
      // Check if resetPassword flag is true
      const user = await this.getUserByEmail(passwordRecoveryDto.companyEmail);

      await this.checkUserExistence(user);

      if (!user.passwordReset) {
        throw new HttpException(
          'Please verify OTP to continue',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Check if passwords match
      await this.comparePassword(
        passwordRecoveryDto.newPassword,
        passwordRecoveryDto.confirmPassword,
      );

      // Hash the new password
      const hashedPassword = await bcrypt.hash(
        passwordRecoveryDto.newPassword,
        10,
      );

      // Update the user's password and resetPassword flag
      await this.prismaService.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          passwordReset: false,
        },
      });

      return {
        success: true,
        message: 'Password reset successful',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while resetting password',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async comparePassword(password: string, confirmPassword: string) {
    if (password !== confirmPassword) {
      throw new HttpException('Passwords must match', HttpStatus.BAD_REQUEST);
    }
  }

  async getUserByEmail(companyEmail: string) {
    return this.prismaService.user.findFirst({
      where: { companyEmail },
    });
  }

  async checkUserExistence(user: any) {
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
  }

  /****************** DATA MIGRATION TO PROD... *******************/
  async migrateData(email: string) {
    try {
      // Check if the user exists in the staging database
      const user = await this.prismaService.user.findFirst({
        where: { companyEmail: email },
        include: {
          adminCompanyId: true,
        },
      });

      const company = await this.prismaService.adminCompany.findFirst({
        where: { companyEmail: email, adminID: user.id },
        include: {
          products: true,
          customers: true,
          suppliers: true,
        },
      });
      if (!user || !company) {
        throw new HttpException('User details not found', HttpStatus.NOT_FOUND);
      }

      // Check if the user exists in the production database
      const prismaProduction = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL_PRODUCTION,
          },
        },
      });

      const userInProd = await prismaProduction.user.findFirst({
        where: { companyEmail: email },
        include: { adminCompanyId: true },
      });

      // Disconnect Prisma production instance
      await prismaProduction.$disconnect();

      if (!userInProd) {
        throw new HttpException('User details not found', HttpStatus.NOT_FOUND);
      }

      // Move user data to production if it exists in the production database
      let userData;
      if (userInProd) {
        userData = await this.moveUserDataToProduction(userInProd, company);
      }
      return userData;
    } catch (error) {
      console.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException('An error occurred', HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  private async moveUserDataToProduction(user: any, company: any) {
    try {
      // Access Prisma production instance
      const prismaProduction = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL_PRODUCTION,
          },
        },
      });

      // Move user-related data to production for each model
      await Promise.all([
        ...company.suppliers.map(async (supplier) => {
          // console.log(supplier);
          const existingSupplier = await prismaProduction.supplier.findUnique({
            where: { id: supplier.id, companyId: user.adminCompanyId.adminID },
          });

          if (existingSupplier) {
            console.log(existingSupplier);
            await prismaProduction.supplier.update({
              where: { id: supplier.id },
              data: {
                companyEmail: supplier.companyEmail,
                displayName: supplier.displayName,
                companyId: user.adminCompanyId.adminID,
              },
            });
          } else {
            const sup = await prismaProduction.supplier.create({
              data: {
                ...supplier,
                companyId: user.adminCompanyId.adminID,
              },
            });
            console.log('Created suppleirs', sup);
          }
        }),
        ...company.customers.map(async (customer) => {
          const existingCustomer = await prismaProduction.customer.findUnique({
            where: { id: customer.id, companyId: user.adminCompanyId.adminID },
          });

          if (existingCustomer) {
            console.log('existingCustomer');
            await prismaProduction.customer.update({
              where: { id: customer.id },
              data: {
                displayName: customer.displayName,
                companyId: user.adminCompanyId.adminID,
              },
            });
          } else {
            const cus = await prismaProduction.customer.create({
              data: {
                ...customer,
                companyId: user.adminCompanyId.adminID,
              },
            });
            console.log('Created Customers', cus);
          }
        }),
        ...company.products.map(async (product) => {
          const existingProduct = await prismaProduction.product.findUnique({
            where: { id: product.id, companyId: user.adminCompanyId.adminID },
          });

          if (existingProduct) {
            console.log('Existing Product');
            await prismaProduction.product.update({
              where: { id: product.id },
              data: {
                name: product.name,
                companyId: user.adminCompanyId.adminID,
              },
            });
          } else {
            const pro = await prismaProduction.product.create({
              data: {
                ...product,
                companyId: user.adminCompanyId.adminID,
              },
            });
          }
        }),
      ]);

      // Disconnect Prisma production instance
      await prismaProduction.$disconnect();

      return { message: 'Data migrated to production successfully' };
    } catch (error) {
      console.error('Error moving user data to production:', error);
      throw error;
    }
  }

  /****************** THIS IS NOT NEEDED AT THE MOMENT *******************/
}
