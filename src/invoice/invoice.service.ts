import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { PrismaService, finaliseSerialNumber, paginate } from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import { DateTime } from 'luxon';
import {
  Invoice,
  LoanRequest,
  PaymentMode,
  PaymentModeStatus,
  PaymentStatus,
  Prisma,
  RequestState,
  SalesOrder,
  User,
} from '@prisma/client';
//import { zeroStocks } from 'src/common/utils/zeroStocks';
import { PaginationDto } from 'src/common/dto';
import { GetAllResponse, GetResponse } from 'src/common/interface';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersservice: UsersService,
    private readonly finaliseSerialNumber: finaliseSerialNumber,
    //private readonly zeroStocks: zeroStocks,
    private readonly logger: Logger,
  ) {}

  async createInvoice(userId: number, createInvoiceDto: CreateInvoiceDto) {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const customer = await this.prismaService.customer.findUnique({
        where: { id: createInvoiceDto.customerId, companyId },
      });

      if (!customer) {
        throw new HttpException(
          `Customer with name ${createInvoiceDto.customerName} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const salesPerson = await this.prismaService.user.findUnique({
        where: { id: createInvoiceDto.salesPersonId, companyId },
      });

      if (!salesPerson) {
        throw new HttpException(`Sales person not found`, HttpStatus.NOT_FOUND);
      }

      let sales: SalesOrder | null = null;
      let loanRequest: LoanRequest | null = null;

      if (createInvoiceDto.salesId && createInvoiceDto.orderSN) {
        sales = await this.createSalesInvoice(
          createInvoiceDto,
          companyId,
          this.prismaService,
        );
      } else {
        loanRequest = await this.createLoanInvoice(
          createInvoiceDto,
          companyId,
          this.prismaService,
        );
      }

      const invoice = await this.prismaService.$transaction(
        async (prisma) => {
          const invoiceData = {
            orderSN: createInvoiceDto.orderSN,
            invoiceSN: createInvoiceDto.invoiceSN,
            salesDate: createInvoiceDto.salesDate,
            invoiceDate: createInvoiceDto.invoiceDate,
            dueDate: createInvoiceDto.dueDate,
            priceListName: createInvoiceDto.priceListName,
            salesPersonId: salesPerson.id,
            salesPerson: salesPerson.primaryContactName,
            discount: createInvoiceDto.discount,
            shippingCharges: createInvoiceDto.shippingCharges,
            notes: createInvoiceDto.notes,
            totalPrice: createInvoiceDto.totalPrice,
            saleOrderId: createInvoiceDto.salesId,
            loanRequestId: createInvoiceDto.loanRequestId,
            customerId: createInvoiceDto.customerId,
            product: {
              connect: createInvoiceDto.itemDetails.map((p) => ({
                id: p.productId,
              })),
            },
            itemDetails: createInvoiceDto.itemDetails.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              unitType: item.unitType,
              quantity: item.quantity,
              warehouseName: item.warehouseName,
              amount: item.amount,
              rate: item.rate,
              unit: item.unit,
              baseQty: item.baseQty,
            })),
            companyId,
          };

          const createdInvoice = await prisma.invoice.create({
            data: invoiceData,
          });

          await this.updateInventory(
            createdInvoice.itemDetails,
            companyId,
            prisma,
          );

          if (sales) {
            await prisma.salesOrder.update({
              where: { id: createInvoiceDto.salesId, companyId },
              data: { status: RequestState.COMPLETED },
            });

            if (createdInvoice) {
              await this.finaliseSerialNumber.markSerialNumber(
                createInvoiceDto.invoiceSN,
                companyId,
              );

              await prisma.batchLog.updateMany({
                where: {
                  companyId,
                  status: 'PENDING',
                  OR: [
                    { saleOrderId: sales ? sales.id : null },
                    { loanRequestId: loanRequest ? loanRequest.id : null },
                  ],
                },
                data: {
                  invoiceId: createdInvoice.id,
                },
              });
            }
          }

          if (loanRequest) {
            await this.updateLoanForInvoice(
              createdInvoice.itemDetails,
              loanRequest.id,
              companyId,
              prisma,
            );

            if (createdInvoice) {
              await this.finaliseSerialNumber.markSerialNumber(
                createInvoiceDto.invoiceSN,
                companyId,
              );

              // await prisma.batchLog.updateMany({
              //   where: { loanRequestId: loanRequest.id, companyId },
              //   data: {
              //     invoiceId: createdInvoice.id,
              //   },
              // });
              const itemDetails = createInvoiceDto.itemDetails.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                //amount: item.amount,
                rate: item.rate,
              }));

              // Iterate over each item to update the batch log
              for (const item of itemDetails) {
                await prisma.batchLog.updateMany({
                  where: {
                    companyId,
                    status: 'PENDING',
                    productId: item.productId,
                    OR: [
                      { saleOrderId: sales ? sales.id : null },
                      { loanRequestId: loanRequest ? loanRequest.id : null },
                    ],
                  },
                  data: {
                    invoiceId: createdInvoice.id,
                    quantity: Number(item.quantity),
                    sellingPrice: Number(item.rate),
                  },
                });
              }
            }
          }

          return {
            status: 'Success',
            message: 'Invoice created successfully',
            data: createdInvoice,
          };
        },
        { isolationLevel: 'Serializable', timeout: 60000 },
      );

      return invoice;
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  private async updateLoanForInvoice(
    itemDetails: any,
    loanRequestId: number,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    const loanRequest = await prisma.loanRequest.findUnique({
      where: { id: loanRequestId, companyId },
    });

    if (!loanRequest) {
      throw new HttpException('Loan request not found', HttpStatus.NOT_FOUND);
    }

    // requestDetails
    const requestDetails = loanRequest.itemDetails as {
      productId: number;
      balanceQty: number;
      qtyToBeReturned: number;
    }[];

    // Update loan item details after invoicing
    await Promise.all(
      itemDetails.map(async (item) => {
        const loanItem = requestDetails.find(
          (loanItem) => loanItem.productId === item.productId,
        );

        if (!loanItem) {
          throw new HttpException(
            `Product not part of the loan request: ${item.productName}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        // Update qtyToBeReturned and balanceQty based on the invoice
        loanItem.qtyToBeReturned -= Number(item.quantity);

        if (loanItem.balanceQty === 0) {
          loanItem.balanceQty = loanItem.qtyToBeReturned;
        } else {
          loanItem.balanceQty -= Number(item.quantity);
        }

        // console.log('loanItem:', loanItem);

        // If invoiced quantity exceeds remaining, throw an error
        if (loanItem.qtyToBeReturned < 0) {
          throw new HttpException(
            `Cannot invoice more than borrowed for product: ${item.productName}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        // Update the loan request details
        await prisma.loanRequest.update({
          where: { id: loanRequestId, companyId },
          data: {
            status: RequestState.CLOSED,
            itemDetails: requestDetails.map((i) =>
              i.productId === Number(item.productId) ? loanItem : i,
            ),
          },
        });
      }),
    );
  }

  private async createLoanInvoice(
    createInvoiceDto: CreateInvoiceDto,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    const loanRequest = await prisma.loanRequest.findFirst({
      where: { requestNumber: createInvoiceDto.requestNumber, companyId },
    });

    if (!loanRequest) {
      throw new HttpException(
        `Invalid loan request serial number ${createInvoiceDto.requestNumber} `,
        HttpStatus.BAD_REQUEST,
      );
    }

    const loan = await prisma.loanRequest.findUnique({
      where: { id: createInvoiceDto.loanRequestId, companyId },
    });

    if (!loan) {
      throw new HttpException(
        `Invalid loanRequest number ${createInvoiceDto.loanRequestId} `,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (loan.status === RequestState.CLOSED) {
      throw new HttpException(
        'Loan request already completed',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.validateProducts(createInvoiceDto.itemDetails, prisma);

    return loan;
  }

  private async createSalesInvoice(
    createInvoiceDto: CreateInvoiceDto,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    const salesOrder = await prisma.salesOrder.findFirst({
      where: { SN: createInvoiceDto.orderSN, companyId },
    });

    if (!salesOrder) {
      throw new HttpException(
        `Invalid sales serial number ${createInvoiceDto.orderSN} `,
        HttpStatus.BAD_REQUEST,
      );
    }

    const sales = await prisma.salesOrder.findUnique({
      where: { id: createInvoiceDto.salesId, companyId },
    });

    if (!sales) {
      throw new HttpException(
        `Invalid sales number ${createInvoiceDto.salesId} `,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (sales.status === RequestState.COMPLETED) {
      throw new HttpException(
        'SalesOrder already completed',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (sales.status !== RequestState.APPROVED) {
      throw new HttpException(
        'SalesOrder not approved',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.validateProducts(createInvoiceDto.itemDetails, prisma);

    return sales;
  }

  private async validateProducts(
    itemDetails: any[],
    prisma: Prisma.TransactionClient,
  ) {
    const uniqueProducts = new Set();

    await Promise.all(
      itemDetails.map(async (item) => {
        if (uniqueProducts.has(item.productId)) {
          throw new HttpException(
            `Duplicate product Details: ${item.productName}`,
            HttpStatus.BAD_REQUEST,
          );
        }
        uniqueProducts.add(item.productId);

        const product = await prisma.product.findUnique({
          where: { id: Number(item.productId) },
          include: { stocks: true },
        });

        if (!product) {
          throw new HttpException(
            `Invalid product ID: ${item.productId}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        const stock = product.stocks.find(
          (stock) => stock.warehouseName === item.warehouseName,
        );

        if (!stock) {
          throw new Error(
            `Stock not found for product ${product.name} and warehouse name ${item.warehouseName}`,
          );
        }

        const totalCommittedQuantity = product.stocks.reduce(
          (acc, curr) => acc + Number(curr.committedQuantity),
          0,
        );

        if (Number(item.quantity) > totalCommittedQuantity) {
          throw new HttpException(
            `Insufficient committed quantity for product ${product.name}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        if (Number(item.quantity) > Number(product.totalStock)) {
          throw new Error(
            `Insufficient committed quantity for product ${product.name}`,
          );
        }
      }),
    );
  }

  async getAllInvoices(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<Invoice>> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const invoices = await paginate(
        this.prismaService.invoice,
        paginationDto,
        {
          where: { companyId },
          include: {
            product: { where: { companyId } },
            payments: { where: { companyId } },
            salesOrder: { where: { companyId } },
            loanRequest: { where: { companyId } },
            customer: { where: { companyId } },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      );

      return {
        status: 'Success',
        message: 'Invoices retrieved successfully',
        data: invoices.data as Invoice[],
        totalItems: invoices.totalItems,
        currentPage: invoices.currentPage,
        totalPages: invoices.totalPages,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating invoice',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getInvoiceById(
    userId: number,
    invoiceId: number,
  ): Promise<GetResponse<Invoice>> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const invoice = await this.prismaService.invoice.findUnique({
        where: { id: invoiceId, companyId },
        include: {
          product: { where: { companyId } },
          payments: { where: { companyId } },
          salesOrder: { where: { companyId } },
          loanRequest: { where: { companyId } },
          customer: { where: { companyId } },
        },
      });

      if (!invoice) {
        throw new HttpException('Invoice not found', HttpStatus.NOT_FOUND);
      }

      return {
        status: 'Success',
        data: invoice,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating invoice',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async updateInventory(
    itemDetails: any,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    try {
      for (const item of itemDetails) {
        const product = await prisma.product.findUnique({
          where: { id: Number(item.productId), companyId },
          include: {
            stocks: {
              where: { warehouseName: item.warehouseName },
              orderBy: { createdAt: 'asc' },
            },
          },
        });

        if (!product) {
          throw new Error(`Product not found for ID ${item.productId}`);
        }

        let remainingQuantity = Number(item.quantity);

        for (const stock of product.stocks) {
          if (remainingQuantity <= 0) {
            break;
          }

          // Calculate available quantity in the current batch
          const availableQuantity = Math.min(
            Number(stock.committedQuantity),
            remainingQuantity,
          );

          // Update committed quantity for the current batch
          const updatedCommittedQuantity =
            Number(stock.committedQuantity) - availableQuantity;

          // Update stock in the database
          await prisma.stock.update({
            where: { id: stock.id },
            data: { committedQuantity: updatedCommittedQuantity },
          });

          // Update remaining quantity for the next batch
          remainingQuantity -= availableQuantity;
        }

        // If remainingQuantity is still greater than 0, it means insufficient stock
        if (remainingQuantity > 0) {
          throw new Error(`Insufficient quantity for product ${product.name}`);
        }

        // Calculate and update totalStock
        const totalStock = product.stocks.reduce(
          (total, stock) => total + Number(stock.openingStock),
          0,
        );

        // Update totalStock for the product
        await prisma.product.update({
          where: { id: product.id },
          data: { totalStock },
        });

        // Update zero stocks to active
        // await this.zeroStocks.updateActiveZeroStock(
        //   prisma,
        //   item.productId,
        //   companyId,
        //   true,
        // );
      }
    } catch (error) {
      throw error;
    }
  }

  public async updateCustomerBalance(
    customerId: number,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    try {
      // Find all invoice that isnt cancelled
      const invoices = await prisma.invoice.findMany({
        where: {
          customerId,
          companyId,
          NOT: { paymentStatus: PaymentStatus.CANCELLED },
        },
      });

      const totalInvoiceAmount = invoices.reduce(
        (total, invoice) =>
          total + parseFloat(invoice.totalPrice.replace(/,/g, '')),
        0,
      );

      // Find all payment that payment mode isnt bal
      // Bal isnt money paid but owned
      const payments = await prisma.payment.findMany({
        where: {
          customerId,
          companyId,
          OR: [
            { paymentMode: PaymentMode.CASH },
            { paymentMode: PaymentMode.TRANSFER },
          ],
          NOT: { paymentStatus: PaymentStatus.CANCELLED },
        },
      });

      const totalPaymentAmount = payments.reduce(
        (total, payment) =>
          total + parseFloat(payment.amountPaid.replace(/,/g, '')),
        0,
      );

      const balance = totalPaymentAmount - totalInvoiceAmount;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new HttpException(`Customer not found`, HttpStatus.NOT_FOUND);
      }

      const updatedCustomer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          balance,
          totalInvoiceAmount,
          totalPaymentAmount,
        },
      });

      return {
        updatedCustomer,
        totalInvoiceAmount,
        totalPaymentAmount,
        balance,
      };
    } catch (error) {
      console.error(error);
      throw new HttpException(
        'An error occurred while updating customer balance',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // async cancelInvoice(userId: number, invoiceId: number, comment: string) {
  //   try {
  //     const user = await this.usersservice.findUserWithRelationships(userId);
  //     const companyId =
  //       user.adminCompanyId?.adminID || user.employeeId?.companyId;

  //     const invoice = await this.prismaService.invoice.findUnique({
  //       where: { id: invoiceId, companyId },
  //     });

  //     if (!invoice) {
  //       throw new HttpException('Invoice not found', HttpStatus.NOT_FOUND);
  //     }

  //     // If the invoice is part payment, update customer balance
  //     if (invoice.paymentStatus === PaymentStatus.PART) {
  //       await this.updateCustomerCanceledBal(
  //         invoice.customerId,
  //         invoice.companyId,
  //       );
  //     }

  //     // Restore the inventory by adding back the quantities of items sold
  //     await this.updateInventoryForInvoice(invoice.itemDetails);

  //     await this.prismaService.invoice.update({
  //       where: { id: invoiceId, companyId },
  //       data: {
  //         comment,
  //         paymentStatus: 'CANCELLED',
  //       },
  //     });

  //     // Update customer balance with the latest data
  //     await this.updateCustomerBalance(invoice.customerId, companyId);

  //     return {
  //       status: 'Success',
  //       message: 'Invoice canceled successfully',
  //     };
  //   } catch (error) {
  //     if (error instanceof Prisma.PrismaClientValidationError) {
  //       throw new HttpException(
  //         'An error occurred while canceling the invoice',
  //         HttpStatus.INTERNAL_SERVER_ERROR,
  //       );
  //     }
  //     throw error;
  //   }
  // }

  // private async updateInventoryForInvoice(itemDetails: any) {
  //   try {
  //     // Retrieve product IDs from itemDetails
  //     const productIds = itemDetails.map((item) => item.productId);

  //     // Retrieve products with associated stocks
  //     const products = await this.prismaService.product.findMany({
  //       where: { id: { in: productIds } },
  //       include: { stocks: true },
  //     });

  //     for (const item of itemDetails) {
  //       const product = products.find((p) => p.id === item.productId);

  //       if (!product) {
  //         throw new Error(`Product not found for ID ${item.productId}`);
  //       }

  //       const stock = product.stocks.find(
  //         (stock) => stock.warehouseName === item.warehouseName,
  //       );

  //       if (!stock) {
  //         throw new Error(
  //           `Stock not found for product ${product.name} and warehouse ${item.warehouseName}`,
  //         );
  //       }

  //       // Update the inventory quantities
  //       const updatedQuantity =
  //         Number(stock.openingStock) + Number(item.quantity);
  //       const totalStock = product.totalStock + Number(item.quantity);

  //       // Update the stock record
  //       await this.prismaService.stock.update({
  //         where: { id: stock.id },
  //         data: { openingStock: String(updatedQuantity) },
  //       });

  //       // Update the product's total stock
  //       await this.prismaService.product.update({
  //         where: { id: product.id },
  //         data: { totalStock },
  //       });
  //     }
  //   } catch (error) {
  //     if (error instanceof Prisma.PrismaClientValidationError) {
  //       throw new HttpException(
  //         'An error occurred while canceling the invoice',
  //         HttpStatus.INTERNAL_SERVER_ERROR,
  //       );
  //     }
  //     throw error;
  //   }
  // }

  async cancelInvoice(userId: number, invoiceId: number, comment: string) {
    try {
      await this.prismaService.$transaction(async (prisma) => {
        const user = await this.usersservice.findUserWithRelationships(userId);
        const companyId =
          user.adminCompanyId?.adminID || user.employeeId?.companyId;

        const invoice = await prisma.invoice.findUnique({
          where: { id: invoiceId, companyId },
        });

        if (!invoice) {
          throw new HttpException('Invoice not found', HttpStatus.NOT_FOUND);
        }

        if (invoice.paymentStatus === PaymentStatus.CANCELLED) {
          throw new HttpException(
            'Invoice already cancelled',
            HttpStatus.BAD_REQUEST,
          );
        }

        //Restore the inventory by adding back the quantities of items sold
        await this.updateInventoryForInvoice(
          invoice.itemDetails,
          companyId,
          user,
          prisma,
        );

        // If the invoice is part payment, update customer balance
        // If the invoice status is completely paid, this cant be cancelled
        // We checked for this probably the user might have made a payment initially
        if (
          invoice.paymentStatus === PaymentStatus.PART ||
          invoice.paymentStatus === PaymentStatus.PAID
        ) {
          await this.updateCustomerCanceledBal(
            invoice.customerId,
            invoice.companyId,
            invoice.id,
            prisma,
          );
        }

        await prisma.invoice.update({
          where: { id: invoiceId, companyId },
          data: {
            comment,
            paymentStatus: 'CANCELLED',
          },
        });

        // Update customer balance with the latest data
        await this.updateCustomerBalance(invoice.customerId, companyId, prisma);

        // Delete batch logs associated with the sales order
        await prisma.batchLog.deleteMany({
          where: {
            invoiceId,
            companyId,
            status: 'PENDING',
          },
        });
      });
      return {
        status: 'Success',
        message: 'Invoice canceled successfully',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while canceling the invoice',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      throw error;
    }
  }

  private async updateInventoryForInvoice(
    itemDetails: any,
    companyId: number,
    user: User,
    prisma: Prisma.TransactionClient,
  ) {
    try {
      // Retrieve product IDs from itemDetails
      const productIds = itemDetails.map((item) => item.productId);

      // Retrieve products with associated stocks for the given company
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, companyId },
        include: {
          stocks: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      for (const item of itemDetails) {
        const product = products.find((p) => p.id === item.productId);

        if (!product) {
          throw new Error(`Product not found for ID ${item.productId}`);
        }

        let stock = product.stocks.find(
          (stock) => stock.warehouseName === item.warehouseName,
        );

        if (!stock) {
          //create and return the stock
          stock = await this.createStock(companyId, item, user, prisma);
        }

        // Update the inventory quantities
        const updatedQuantity =
          Number(stock.openingStock) + Number(item.quantity);
        const totalStock = product.totalStock + Number(item.quantity);

        // Update the stock record
        await prisma.stock.update({
          where: { id: stock.id },
          data: { openingStock: String(updatedQuantity) },
        });

        // Update the product's total stock
        await prisma.product.update({
          where: { id: product.id },
          data: { totalStock },
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating inventory',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      throw error;
    }
  }

  public async updateCustomerCanceledBal(
    customerId: number,
    companyId: number,
    invoiceId: number,
    prisma: Prisma.TransactionClient,
  ) {
    try {
      const canceledInvoices = await prisma.invoice.findMany({
        where: { customerId, companyId, paymentStatus: RequestState.CANCELLED },
      });

      const canceledPayments = await prisma.payment.findMany({
        where: {
          customerId,
          companyId,
          paymentStatus: PaymentModeStatus.CANCELLED,
          OR: [
            { paymentMode: PaymentMode.CASH },
            { paymentMode: PaymentMode.TRANSFER },
          ],
        },
      });

      const totalCanceledInvoiceAmount = canceledInvoices.reduce(
        (total, invoice) =>
          total + parseFloat(invoice.totalPrice.replace(/,/g, '')),
        0,
      );

      const totalCanceledPaymentsAmount = canceledPayments.reduce(
        (total, invoice) =>
          total + parseFloat(invoice.amountPaid.replace(/,/g, '')),
        0,
      );

      // Retrieve the customer's current balance
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new HttpException('Customer not found', HttpStatus.NOT_FOUND);
      }

      const payments = await prisma.payment.findMany({
        where: {
          companyId,
          invoiceId,
          customerId: customerId,
          OR: [
            { paymentStatus: PaymentModeStatus.FULL_PAYMENT },
            { paymentStatus: PaymentModeStatus.PART_PAYMENT },
          ],
        },
      });

      if (!payments) {
        throw new HttpException('payment not found', HttpStatus.NOT_FOUND);
      }

      for (const payment of payments) {
        // Deduct the canceled invoice amount from the total invoice amount
        const updatedTotalInvoiceAmount =
          customer.totalInvoiceAmount - totalCanceledInvoiceAmount;

        // Deduct the canceled invoice amount from the total invoice amount
        const updatedTotalPaymentAmount =
          customer.totalPaymentAmount - totalCanceledPaymentsAmount;

        // Calculate the new balance
        const balance = updatedTotalPaymentAmount - updatedTotalInvoiceAmount;

        // Update the customer's balance in the database
        if (payment.paymentMode !== PaymentMode.BALANCE) {
          await prisma.customer.update({
            where: { id: customerId },
            data: {
              balance,
              totalPaymentAmount: updatedTotalPaymentAmount,
              totalInvoiceAmount: updatedTotalInvoiceAmount,
            },
          });
        }

        await prisma.payment.update({
          where: {
            id: payment.id,
            companyId,
            invoiceId,
          },
          data: {
            paymentStatus: PaymentModeStatus.CANCELLED,
          },
        });

        //Delete the associated sales transactions
        await prisma.salesTransaction.deleteMany({
          where: {
            paymentId: payment.id,
            companyId,
          },
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating customer balance',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      throw error;
    }
  }

  async deleteInvoice(userId: number, invoiceId: number) {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Retrieve the invoice details including the items sold
      const invoice = await this.prismaService.invoice.findUnique({
        where: { id: invoiceId, companyId },
      });

      if (!invoice) {
        throw new HttpException('Invoice not found', HttpStatus.NOT_FOUND);
      }

      await this.prismaService.invoice.delete({
        where: { id: invoiceId, companyId },
      });

      return {
        status: 'Success',
        message: 'Invoice deleted successfully',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while deleting the invoice',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      throw error;
    }
  }

  private async createStock(
    companyId: number,
    item: any,
    user: User,
    prisma: Prisma.TransactionClient,
  ) {
    try {
      const warehouse = await prisma.wareHouse.findFirst({
        where: {
          name: {
            equals: item.warehouseName.trim(),
            mode: 'insensitive',
          },
          companyId,
        },
      });

      if (!warehouse) {
        const errorMsg = `Warehouse not found for stock with warehouseName: ${item.warehouseName} for item ${item.productId}`;
        console.error(errorMsg);
        throw new HttpException(errorMsg, HttpStatus.NOT_FOUND);
      }

      const batchNumber = await this.generateUniqueBatchNumber(
        companyId,
        warehouse.name,
        user.id,
      );

      const openingStockValue: number = item.quantity * item.rate;

      const stock = await prisma.stock.create({
        data: {
          companyId,
          // openingStock: String(item.quantity),
          itemName: item.productName,
          warehouseName: warehouse.name.trim(),
          batchNumber,
          purchase: {
            costPrice: item.rate,
          },
          openingStockValue: String(openingStockValue),
          createdBy: user.primaryContactName,
          product: { connect: { id: item.productId } },
          warehouses: { connect: { id: warehouse.id } },
        },
        include: { warehouses: true, product: true },
      });

      return stock;
    } catch (error) {
      console.error(`Error creating stock for item ${item.productId}:`, error);
      throw error;
    }
  }

  private async generateUniqueBatchNumber(
    companyId: number,
    warehouseName: string,
    userId: number,
    attempts = 0,
  ): Promise<string> {
    try {
      if (attempts > 10) {
        throw new Error(
          'Exceeded maximum attempts to generate unique batch number',
        );
      }

      const prefix = warehouseName.slice(0, 3).toUpperCase();
      const formattedDate = DateTime.local().toFormat('yyyyLLdd');
      const concatenated = prefix + formattedDate.replace(/-/g, '');

      const batchNumber = await this.usersservice.generateBatchNumber(
        concatenated,
        'batch',
        userId,
      );

      const existingStock = await this.prismaService.stock.findFirst({
        where: { batchNumber, companyId },
      });

      if (existingStock) {
        return this.generateUniqueBatchNumber(
          companyId,
          warehouseName,
          userId,
          attempts + 1,
        );
      }

      return batchNumber;
    } catch (error) {
      console.error('Error generating unique batch number:', error);
      throw error;
    }
  }
}
