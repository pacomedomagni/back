import { Injectable, HttpStatus, HttpException, Logger } from '@nestjs/common';
import { ContactDto, CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { PrismaService, finaliseSerialNumber, paginate } from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import {
  Contacts,
  Customer,
  Prisma,
  RequestType,
  Status,
  UserType,
} from '@prisma/client';
import { DateTime } from 'luxon';
import { InvoiceService } from 'src/invoice/invoice.service';
import { PaginationDto } from 'src/common/dto';
import { GetAllResponse } from 'src/common/interface';
//import { Customer } from './entities/customer.entity';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private readonly invoice: InvoiceService,
    private readonly finaliseSerialNumber: finaliseSerialNumber,
    private readonly logger: Logger,
  ) {}
  async createCustomer(userId: number, createCustomerDto: CreateCustomerDto) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);

      const companyId =
        user?.adminCompanyId?.adminID || user.employeeId?.companyId;

      const existingCustomer = await this.prismaService.customer.findFirst({
        where: { serialNumber: createCustomerDto.serialNumber, companyId },
      });
      if (existingCustomer) {
        throw new HttpException(
          'Customer with serialNumber already exists',
          HttpStatus.CONFLICT,
        );
      }

      const existing = await this.prismaService.customer.findFirst({
        where: {
          companyName: {
            equals: createCustomerDto.companyName.trim(),
            mode: 'insensitive',
          },
          companyId,
        },
      });

      if (existing) {
        throw new HttpException(
          `Customer with name ${existing.companyName} already exist`,
          HttpStatus.CONFLICT,
        );
      }

      //console.log(createCustomerDto);
      if (createCustomerDto.companyEmail) {
        const existingEmail = await this.prismaService.customer.findFirst({
          where: { companyEmail: createCustomerDto.companyEmail, companyId },
        });

        if (existingEmail) {
          throw new HttpException(
            'Customer with email already exists',
            HttpStatus.CONFLICT,
          );
        }
      }

      const contacts = createCustomerDto.contacts || [];
      const customer = await this.prismaService.customer.create({
        data: {
          companyId,
          serialNumber: createCustomerDto.serialNumber,
          title: createCustomerDto.title,
          lastName: createCustomerDto.lastName,
          website: createCustomerDto.website,
          displayName: createCustomerDto.displayName,
          companyName: createCustomerDto.companyName,
          mobileNumber: createCustomerDto.mobileNumber,
          currency: createCustomerDto.currency,
          mediaLink: createCustomerDto.mediaLink,
          billAddress: createCustomerDto.billAddress,
          shippingAddress: createCustomerDto.shippingAddress,
          firstName: createCustomerDto.primaryContactName,
          registeredBy: user.primaryContactName,
          companyEmail: createCustomerDto.companyEmail,
          customerType: createCustomerDto.customerType,
          contacts: {
            create: contacts.map((item) => ({
              companyId,
              firstName: item.firstName,
              lastName: item.lastName,
              department: item.department,
              primary: item.primary,
              title: item.title,
              companyEmail: item.companyEmail,
              mobileNumber: item.mobileNumber,
              businessPhone: item.businessPhone,
              type: RequestType.CUSTOMER,
            })),
          },

          department: createCustomerDto.department,
        },
        include: { contacts: true },
      });

      if (customer) {
        await this.finaliseSerialNumber.markSerialNumber(
          createCustomerDto.serialNumber,
          companyId,
        );
      }

      return {
        status: 'successful',
        message: 'Successfully added customer',
        data: {
          customer,
        },
      };
    } catch (error) {
      this.logger.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating customer',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getCustomers(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<Customer>> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const company = await this.prismaService.adminCompany.findUnique({
        where: {
          adminID: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (!company) {
        throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
      }

      // Paginate customers in the company
      const paginatedCustomers = await paginate(
        this.prismaService.customer,
        paginationDto,
        {
          where: {
            companyId,
          },
          include: {
            contacts: { where: { type: 'CUSTOMER', companyId } },
            invoices: { where: { companyId } },
            payments: { where: { companyId } },
            requests: { where: { companyId } },
            salesOrder: { where: { companyId } },
            salesTransaction: { where: { companyId } },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      );

      return {
        status: 'Success',
        message: 'Customers retrieved successfully',
        data: paginatedCustomers.data as Customer[],
        totalItems: paginatedCustomers.totalItems,
        currentPage: paginatedCustomers.currentPage,
        totalPages: paginatedCustomers.totalPages,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while getting customers',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getCustomerById(userId: number, customerId: number): Promise<any> {
    try {
      // Check if the user exists with associated relationships
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const customer = await this.prismaService.customer.findUnique({
        where: { id: customerId, companyId },
        include: {
          contacts: { where: { type: 'CUSTOMER', companyId } },
          invoices: { where: { companyId } },
          payments: { where: { companyId } },
          requests: { where: { companyId } },
          salesOrder: { where: { companyId } },
          salesTransaction: { where: { companyId } },
        },
      });

      if (!customer) {
        throw new HttpException('Customer not found', HttpStatus.NOT_FOUND);
      }

      return {
        status: 'Success',
        data: customer,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while getting customer',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async createContact(userId: number, contactDto: ContactDto) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);

      const companyId =
        user?.adminCompanyId?.adminID || user.employeeId?.companyId;

      const customer = await this.prismaService.customer.findUnique({
        where: { id: contactDto.customerId, companyId },
      });
      if (!customer) {
        throw new HttpException(
          `Customer with name ${contactDto.customerName} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      //console.log(createCustomerDto);
      if (contactDto.companyEmail) {
        const existingEmail = await this.prismaService.contacts.findFirst({
          where: { companyEmail: contactDto.companyEmail, companyId },
        });

        if (existingEmail) {
          throw new HttpException(
            'Customer with email already exists',
            HttpStatus.CONFLICT,
          );
        }
      }

      const contact = await this.prismaService.contacts.create({
        data: {
          companyId,
          title: contactDto.title,
          lastName: contactDto.lastName,
          firstName: contactDto.firstName,
          companyEmail: contactDto.companyEmail,
          department: contactDto.department,
          primary: contactDto.primary,
          mobileNumber: contactDto.mobileNumber,
          businessPhone: contactDto.businessPhone,
          type: RequestType.CUSTOMER,
          customers: {
            connect: { id: contactDto.customerId },
          },
        },
      });

      return {
        status: 'successful',
        message: 'Successfully added contact',
        data: {
          contact,
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating conatact',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getContacts(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<Contacts>> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the company exists
      const company = await this.prismaService.adminCompany.findUnique({
        where: {
          adminID: user.adminCompanyId?.adminID || user.employeeId?.companyId,
        },
      });

      if (!company) {
        throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
      }

      const contacts = await paginate(
        this.prismaService.contacts,
        paginationDto,
        {
          where: {
            companyId,
            type: RequestType.CUSTOMER,
          },
          include: {
            customers: { where: { companyId } },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      );

      return {
        status: 'Success',
        message: 'Contacts retrieved successfully',
        data: contacts.data as Contacts[],
        totalItems: contacts.totalItems,
        currentPage: contacts.currentPage,
        totalPages: contacts.totalPages,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while getting conatacts',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async editCustomer(
    userId: number,
    customerId: number,
    updateCustomerDto: UpdateCustomerDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the request exists
      const existingCustomer = await this.prismaService.customer.findUnique({
        where: { id: customerId, companyId },
        include: { contacts: { where: { companyId } } },
      });

      if (!existingCustomer) {
        throw new HttpException(
          `Customer with id ${customerId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Check if data is provided for update
      if (!Object.keys(updateCustomerDto).length) {
        return {
          status: 'No Updates',
          data: [],
        };
      }

      // Extract contact IDs from existingSupplier
      const contactIds = existingCustomer.contacts.map((contact) => contact.id);

      // Update the customer fields
      const contacts = updateCustomerDto.contacts || [];
      const updatedCustomer = await this.prismaService.customer.update({
        where: { id: customerId, companyId },
        data: {
          companyId,
          serialNumber: updateCustomerDto.serialNumber,
          title: updateCustomerDto.title,
          lastName: updateCustomerDto.lastName,
          website: updateCustomerDto.website,
          displayName: updateCustomerDto.displayName,
          companyName: updateCustomerDto.companyName,
          mobileNumber: updateCustomerDto.mobileNumber,
          currency: updateCustomerDto.currency,
          mediaLink: updateCustomerDto.mediaLink,
          billAddress: updateCustomerDto.billAddress,
          shippingAddress: updateCustomerDto.shippingAddress,
          firstName: updateCustomerDto.primaryContactName,
          registeredBy: user.primaryContactName,
          companyEmail: updateCustomerDto.companyEmail,
          customerType: updateCustomerDto.customerType,
          contacts: {
            // Update operation for each contact
            updateMany: updateCustomerDto.contacts.map((contact, index) => ({
              where: { id: contactIds[index], companyId },
              data: {
                companyId,
                firstName: contact.firstName,
                lastName: contact.lastName,
                department: contact.department,
                primary: contact.primary,
                title: contact.title,
                companyEmail: contact.companyEmail,
                mobileNumber: contact.mobileNumber,
                businessPhone: contact.businessPhone,
                type: RequestType.CUSTOMER,
              },
            })),
          },
          department: updateCustomerDto.department,
        },
        include: { contacts: true },
      });

      return {
        status: 'Updated Sucessfully',
        data: updatedCustomer,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating records',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async uploadCustomers(
    userId: number,
    createCustomerDto: CreateCustomerDto[],
  ) {
    const batchSize = 10;

    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user?.adminCompanyId?.adminID || user.employeeId?.companyId;

      const results = [];
      let newCustomersCreated = false;

      // Convert customer data to array of entries
      const customerEntries = createCustomerDto;

      for (let i = 0; i < customerEntries.length; i += batchSize) {
        const batch = customerEntries.slice(i, i + batchSize);

        // Log batch processing start
        this.logger.log(`Processing batch ${Math.ceil(i / batchSize) + 1}...`);

        for (const customerData of batch) {
          const existingCompanyName =
            await this.prismaService.customer.findFirst({
              where: {
                companyName: {
                  equals: customerData.companyName.trim(),
                  mode: 'insensitive',
                },
                companyId,
              },
            });

          if (!existingCompanyName) {
            let existingEmail = null;

            if (customerData.companyEmail) {
              existingEmail = await this.prismaService.customer.findFirst({
                where: {
                  companyEmail: {
                    equals: customerData.companyEmail.trim(),
                    mode: 'insensitive',
                  },
                  companyId,
                },
              });
            }

            if (!existingEmail) {
              if (!customerData.serialNumber) {
                customerData.serialNumber =
                  await this.generateUniqueSerialNumber(companyId, userId);
              }

              const contacts = customerData.contacts || [];
              const customer = await this.prismaService.customer.create({
                data: {
                  companyId,
                  serialNumber: customerData.serialNumber,
                  displayName: customerData.displayName,
                  companyName: customerData.companyName,
                  mobileNumber: customerData.mobileNumber,
                  primaryContactName: customerData.primaryContactName,
                  shippingAddress: customerData.shippingAddress,
                  billAddress: customerData.billAddress,
                  firstName: customerData.primaryContactName,
                  channel: customerData.channel,
                  registeredBy: customerData.registeredBy,
                  companyEmail: customerData.companyEmail,
                  type: customerData.type,
                  customerCategory: customerData.customerCategory,
                  manager: customerData.manager,
                  customerType: customerData.customerType,
                  contacts: {
                    create: contacts.map((item) => ({
                      companyId,
                      firstName: item.firstName,
                      lastName: item.lastName,
                      department: item.department,
                      primary: item.primary,
                      title: item.title,
                      companyEmail: item.companyEmail,
                      mobileNumber: item.mobileNumber,
                      businessPhone: item.businessPhone,
                      type: RequestType.CUSTOMER,
                    })),
                  },
                },
                include: { contacts: true },
              });

              if (customer) {
                await this.finaliseSerialNumber.markSerialNumber(
                  customerData.serialNumber,
                  companyId,
                );
              }

              results.push(customer);
              newCustomersCreated = true;
            }
          }
        }
      }

      if (!newCustomersCreated) {
        return {
          status: 'successful',
          message: 'No new customers were created',
          data: [],
        };
      }

      return {
        status: 'successful',
        message: `${results.length} customer(s) uploaded successfully`,
        data: results,
      };
    } catch (error) {
      console.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while uploading customers',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  // async uploadCustomers(
  //   userId: number,
  //   createCustomerDto: CreateCustomerDto[],
  // ) {
  //   const batchSize = 10;

  //   try {
  //     const user = await this.usersService.findUserWithRelationships(userId);
  //     const companyId =
  //       user?.adminCompanyId?.adminID || user.employeeId?.companyId;

  //     const results = [];
  //     let newCustomersCreated = false;

  //     // Convert supplier data to array of entries
  //     const customerEntries = createCustomerDto;

  //     for (let i = 0; i < customerEntries.length; i += batchSize) {
  //       const batch = customerEntries.slice(i, i + batchSize);

  //       // Log batch processing start
  //       this.logger.log(`Processing batch ${Math.ceil(i / batchSize) + 1}...`);

  //       for (const customerData of batch) {
  //         console.log('Processing customerData...');
  //         const existingCompanyName =
  //           await this.prismaService.customer.findFirst({
  //             where: {
  //               companyName: {
  //                 equals: customerData.companyName.trim(),
  //                 mode: 'insensitive',
  //               },
  //               companyId,
  //             },
  //           });

  //         console.log('Processing existingCompanyName...', existingCompanyName);

  //         if (!existingCompanyName) {
  //           console.log(
  //             'Processing existingCompanyName finished...',
  //             existingCompanyName,
  //           );
  //           let existingEmail = null;

  //           if (customerData.companyEmail) {
  //             existingEmail = await this.prismaService.customer.findFirst({
  //               where: {
  //                 companyEmail: {
  //                   equals: customerData.companyEmail.trim(),
  //                   mode: 'insensitive',
  //                 },
  //                 companyId,
  //               },
  //             });
  //           }

  //           if (!existingEmail) {
  //             console.log('Email not found about  to create...');
  //             if (!customerData.serialNumber) {
  //               console.log('No serial number creating create...');
  //               customerData.serialNumber =
  //                 await this.generateUniqueSerialNumber(userId);
  //             }
  //             console.log(
  //               'Creating serial number...',
  //               customerData.serialNumber,
  //             );
  //             const contacts = customerData.contacts || [];
  //             console.log('Creating contacts...', contacts);
  //             const customer = await this.prismaService.customer.create({
  //               data: {
  //                 companyId,
  //                 serialNumber: customerData.serialNumber,
  //                 displayName: customerData.displayName,
  //                 companyName: customerData.companyName,
  //                 mobileNumber: customerData.mobileNumber,
  //                 primaryContactName: customerData.primaryContactName,
  //                 shippingAddress: customerData.shippingAddress,
  //                 billAddress: customerData.billAddress,
  //                 firstName: customerData.primaryContactName,
  //                 channel: customerData.channel,
  //                 registeredBy: customerData.registeredBy,
  //                 companyEmail: customerData.companyEmail,
  //                 type: customerData.type,
  //                 customerCategory: customerData.customerCategory,
  //                 manager: customerData.manager,
  //                 customerType: customerData.customerType,
  //                 contacts: {
  //                   create: contacts.map((item) => ({
  //                     companyId,
  //                     firstName: item.firstName,
  //                     lastName: item.lastName,
  //                     department: item.department,
  //                     primary: item.primary,
  //                     title: item.title,
  //                     companyEmail: item.companyEmail,
  //                     mobileNumber: item.mobileNumber,
  //                     businessPhone: item.businessPhone,
  //                     type: RequestType.CUSTOMER,
  //                   })),
  //                 },
  //               },
  //               include: { contacts: true },
  //             });
  //             console.log('Creating customer...', customer);

  //             if (customer) {
  //               await this.finaliseSerialNumber.markSerialNumber(
  //                 customerData.serialNumber,
  //                 companyId,
  //               );
  //             }

  //             results.push(customer);
  //             newCustomersCreated = true;
  //           }
  //         }
  //       }
  //     }

  //     if (!newCustomersCreated) {
  //       return {
  //         status: 'successful',
  //         message: 'No new customers were created',
  //         data: [],
  //       };
  //     }

  //     return {
  //       status: 'successful',
  //       message: `${results.length} customers uploaded successfully`,
  //       data: results,
  //     };
  //   } catch (error) {
  //     console.log(error);
  //     if (error instanceof Prisma.PrismaClientValidationError) {
  //       throw new HttpException(
  //         'An error occurred while uploading customers',
  //         HttpStatus.BAD_REQUEST,
  //       );
  //     }
  //     throw error;
  //   }
  // }

  private async generateUniqueSerialNumber(
    companyId: number,
    userId: number,
  ): Promise<string> {
    const serialNumber = await this.usersService.generateSerialNumber(
      'CSN',
      'customer',
      userId,
    );

    const existingNumber = await this.prismaService.customer.findFirst({
      where: { serialNumber, companyId },
    });

    if (existingNumber) {
      return this.generateUniqueSerialNumber(companyId, userId);
    }

    return serialNumber;
  }

  async deleteAllCustomers(userId: number) {
    try {
      // Check if the user exists with associated relationships
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const { count } = await this.prismaService.customer.deleteMany({
        where: {
          companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Customers deleted successfully',
        count,
      };
    } catch (error) {
      // if (error instanceof Prisma.PrismaClientValidationError) {
      //   throw new HttpException(
      //     'An error occurred while deleting customers',
      //     HttpStatus.BAD_REQUEST,
      //   );
      // }
      throw error;
    }
  }

  async deleteCustomer(userId: number, customerId: number) {
    try {
      // Check if the user exists with associated relationships
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const customer = await this.prismaService.customer.findUnique({
        where: { id: customerId, companyId },
      });

      if (!customer) {
        throw new HttpException('Customer not found', HttpStatus.NOT_FOUND);
      }

      const del = await this.prismaService.customer.delete({
        where: {
          id: customer.id,
          companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Customer deleted successfully',
      };
    } catch (error) {
      console.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while deleting Customer',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getBestCustomers(
    userId: number,
    startDate: DateTime,
    endDate: DateTime,
    limit: number,
  ) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Calculate the start of the day (00:00:00) in the appropriate time zone
      const startOfDay = startDate.startOf('day');

      // Calculate the end of the day (23:59:59.999) in the appropriate time zone
      const endOfDay = endDate.endOf('day');

      const salesByCustomer = await this.prismaService.salesTransaction.groupBy(
        {
          by: ['customerId'],
          _sum: {
            quantity: true,
            amount: true,
          },
          where: {
            companyId,
            AND: [
              { createdAt: { gte: startOfDay.toJSDate() } },
              { createdAt: { lt: endOfDay.toJSDate() } },
            ],
          },
          orderBy: {
            _sum: {
              amount: 'desc',
              //quantity: 'desc',
            },
          },
          take: limit,
        },
      );

      // Get customer details for each sale group
      const bestCustomers = await Promise.all(
        salesByCustomer.map(async (customerSale) => {
          const customerId = customerSale.customerId;
          const customer = await this.prismaService.customer?.findUnique({
            where: {
              id: customerId,
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
              companyEmail: true,
              createdAt: true,
            },
          });

          return {
            ...customer,
            totalSalesAmount: customerSale._sum.amount,
            totalQuantity: customerSale._sum.quantity,
          };
        }),
      );

      return {
        status: 'Successfully retrieved best customers',
        bestCustomers,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching records',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  // async uploadCustomers(
  //   userId: number,
  //   createCustomerDto: CreateCustomerDto[],
  // ) {
  //   const batchSize = 100;

  //   try {
  //     const user = await this.usersService.findUserWithRelationships(userId);
  //     const companyId =
  //       user?.adminCompanyId?.adminID || user.employeeId?.companyId;

  //     const results = [];
  //     let newCustomersCreated = false;

  //     // Convert customer data to array of entries
  //     const customerEntries = createCustomerDto;

  //     for (let i = 0; i < customerEntries.length; i += batchSize) {
  //       const batch = customerEntries.slice(i, i + batchSize);

  //       // Log batch processing start
  //       this.logger.log(`Processing batch ${Math.ceil(i / batchSize) + 1}...`);

  //       await this.prismaService.$transaction(
  //         async (prisma) => {
  //           for (const customerData of batch) {
  //             const existingCompanyName = await prisma.customer.findFirst({
  //               where: {
  //                 companyName: {
  //                   equals: customerData.companyName.trim(),
  //                   mode: 'insensitive',
  //                 },
  //                 companyId,
  //               },
  //             });

  //             if (!existingCompanyName) {
  //               let existingEmail = null;

  //               if (customerData.companyEmail) {
  //                 existingEmail = await prisma.customer.findFirst({
  //                   where: {
  //                     companyEmail: {
  //                       equals: customerData.companyEmail.trim(),
  //                       mode: 'insensitive',
  //                     },
  //                     companyId,
  //                   },
  //                 });
  //               }

  //               if (!existingEmail) {
  //                 if (!customerData.serialNumber) {
  //                   customerData.serialNumber =
  //                     await this.generateUniqueSerialNumber(userId);
  //                 }

  //                 const contacts = customerData.contacts || [];
  //                 const customer = await prisma.customer.create({
  //                   data: {
  //                     companyId,
  //                     serialNumber: customerData.serialNumber,
  //                     displayName: customerData.displayName,
  //                     companyName: customerData.companyName,
  //                     mobileNumber: customerData.mobileNumber,
  //                     primaryContactName: customerData.primaryContactName,
  //                     shippingAddress: customerData.shippingAddress,
  //                     billAddress: customerData.billAddress,
  //                     firstName: customerData.primaryContactName,
  //                     channel: customerData.channel,
  //                     registeredBy: customerData.registeredBy,
  //                     companyEmail: customerData.companyEmail,
  //                     type: customerData.type,
  //                     customerCategory: customerData.customerCategory,
  //                     manager: customerData.manager,
  //                     customerType: customerData.customerType,
  //                     contacts: {
  //                       create: contacts.map((item) => ({
  //                         companyId,
  //                         firstName: item.firstName,
  //                         lastName: item.lastName,
  //                         department: item.department,
  //                         primary: item.primary,
  //                         title: item.title,
  //                         companyEmail: item.companyEmail,
  //                         mobileNumber: item.mobileNumber,
  //                         businessPhone: item.businessPhone,
  //                         type: RequestType.CUSTOMER,
  //                       })),
  //                     },
  //                   },
  //                   include: { contacts: true },
  //                 });

  //                 if (customer) {
  //                   await this.finaliseSerialNumber.markSerialNumber(
  //                     customerData.serialNumber,
  //                     companyId,
  //                   );
  //                 }

  //                 results.push(customer);
  //                 newCustomersCreated = true;
  //               }
  //             }
  //           }
  //         },
  //         { isolationLevel: 'Serializable' },
  //       );
  //     }

  //     if (!newCustomersCreated) {
  //       return {
  //         status: 'successful',
  //         message: 'No new customers were created',
  //         data: [],
  //       };
  //     }

  //     return {
  //       status: 'successful',
  //       message: `${results.length} customers uploaded successfully`,
  //       data: results,
  //     };
  //   } catch (error) {
  //     console.log(error);
  //     if (error instanceof Prisma.PrismaClientValidationError) {
  //       throw new HttpException(
  //         'An error occurred while uploading customers',
  //         HttpStatus.BAD_REQUEST,
  //       );
  //     }
  //     throw error;
  //   }
  // }
}
