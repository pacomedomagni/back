import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PrismaService } from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import {
  LoanRequest,
  PaymentMode,
  PaymentModeStatus,
  PaymentStatus,
  Prisma,
  RequestState,
  SalesOrder,
} from '@prisma/client';
import { InvoiceService } from 'src/invoice/invoice.service';
import { error } from 'console';

@Injectable()
export class PaymentService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersservice: UsersService,
    private readonly invoice: InvoiceService,
  ) {}

  /******************/
  async createPayment(userId: number, createPaymentDto: CreatePaymentDto) {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const customer = await this.prismaService.customer.findUnique({
        where: { id: createPaymentDto.customerId, companyId },
      });
      if (!customer) {
        throw new HttpException(
          `Customer with ID ${createPaymentDto.customerId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      let sales: any | null = null;
      let loanRequest: LoanRequest | null = null;

      const invoice = await this.prismaService.invoice.findFirst({
        where: { id: createPaymentDto.invoiceId, companyId },
        include: { product: true },
      });
      if (!invoice) {
        throw new HttpException(
          `Invalid invoice ID ${createPaymentDto.invoiceId}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (invoice.saleOrderId) {
        sales = await this.createSalesPayment(
          invoice.saleOrderId,
          companyId,
          this.prismaService,
        );
      } else if (invoice.loanRequestId) {
        loanRequest = await this.createLoanPayment(
          invoice.loanRequestId,
          companyId,
          this.prismaService,
        );
      }

      if (
        invoice.paymentStatus &&
        invoice.paymentStatus === PaymentStatus.PAID
      ) {
        throw new HttpException(
          `Payment already completed for invoice`,
          HttpStatus.BAD_REQUEST,
        );
      }

      return await this.prismaService.$transaction(
        async (prisma) => {
          let createdPayments = [];
          if (
            createPaymentDto.useCustomerBalance &&
            Number(createPaymentDto.amountPaid) > 0
          ) {
            console.log('Starting 1');
            const items = await this.items(invoice.itemDetails);
            const balPayment = await prisma.payment.create({
              data: {
                customerName: createPaymentDto.customerName,
                customerId: customer.id,
                orderNumber: sales?.SN,
                loanRequestId: loanRequest ? loanRequest.id : null,
                salesOrderId: sales ? sales.id : null,
                invoiceNumber: invoice.invoiceSN,
                invoiceAmount: createPaymentDto.invoiceAmount,
                amountPaid: createPaymentDto.customerBalanceAmount,
                paymentDate: createPaymentDto.paymentDate,
                paymentMode: PaymentMode.BALANCE,
                paymentStatus: createPaymentDto.paymentStatus,
                invoiceId: invoice.id,
                companyId,
                product: {
                  connect: items.map((p) => ({ id: p.productId })),
                },
              },
              include: { invoice: true },
            });

            const amountPayment = await prisma.payment.create({
              data: {
                customerName: createPaymentDto.customerName,
                customerId: customer.id,
                orderNumber: sales?.SN,
                loanRequestId: loanRequest ? loanRequest.id : null,
                salesOrderId: sales ? sales.id : null,
                invoiceNumber: invoice.invoiceSN,
                invoiceAmount: createPaymentDto.invoiceAmount,
                amountPaid: createPaymentDto.amountPaid,
                paymentDate: createPaymentDto.paymentDate,
                paymentMode: createPaymentDto.paymentMode,
                paymentStatus: createPaymentDto.paymentStatus,
                invoiceId: invoice.id,
                companyId,
                product: {
                  connect: items.map((p) => ({ id: p.productId })),
                },
              },
              include: { invoice: true },
            });

            createdPayments = [amountPayment, balPayment];
          } else if (
            createPaymentDto.useCustomerBalance &&
            Number(createPaymentDto.amountPaid) === 0
          ) {
            const items = await this.items(invoice.itemDetails);
            const balPayment = await prisma.payment.create({
              data: {
                customerName: createPaymentDto.customerName,
                customerId: customer.id,
                orderNumber: sales?.SN,
                loanRequestId: loanRequest ? loanRequest.id : null,
                salesOrderId: sales ? sales.id : null,
                invoiceNumber: invoice.invoiceSN,
                invoiceAmount: createPaymentDto.invoiceAmount,
                amountPaid: createPaymentDto.customerBalanceAmount,
                paymentDate: createPaymentDto.paymentDate,
                paymentMode: PaymentMode.BALANCE,
                paymentStatus: createPaymentDto.paymentStatus,
                invoiceId: invoice.id,
                companyId,
                product: {
                  connect: items.map((p) => ({ id: p.productId })),
                },
              },
              include: { invoice: true },
            });

            createdPayments = [balPayment];
          } else {
            const items = await this.items(invoice.itemDetails);
            const amountPayment = await prisma.payment.create({
              data: {
                customerName: createPaymentDto.customerName,
                customerId: customer.id,
                orderNumber: sales?.SN,
                loanRequestId: loanRequest ? loanRequest.id : null,
                salesOrderId: sales ? sales.id : null,
                invoiceNumber: invoice.invoiceSN,
                invoiceAmount: createPaymentDto.invoiceAmount,
                amountPaid: createPaymentDto.amountPaid,
                paymentDate: createPaymentDto.paymentDate,
                paymentMode: createPaymentDto.paymentMode,
                paymentStatus: createPaymentDto.paymentStatus,
                invoiceId: invoice.id,
                companyId,
                product: {
                  connect: items.map((p) => ({ id: p.productId })),
                },
              },
              include: { invoice: true, product: true },
            });

            createdPayments = [amountPayment];
          }

          if (!createdPayments.length) {
            throw new Error('No payments created.');
          }

          const items = await this.items(invoice.itemDetails);

          for (const payment of createdPayments) {
            const salesTransactionData = {
              status: payment.paymentStatus,
              saleOrderId: sales ? sales.id : null,
              loanRequestId: loanRequest ? loanRequest.id : null,
              invoiceId: invoice.id,
              customerId: customer.id,
              salesPersonId: invoice.salesPersonId,
              paymentId: payment.id,
              companyId,
              salesRequestId: sales ? sales.request.id : null,
            };

            for (const item of items) {
              // Find warehouse for this item
              const existingWarehouse = await prisma.wareHouse.findFirst({
                where: {
                  name: {
                    equals: item.warehouseName.trim(),
                    mode: 'insensitive',
                  },
                  companyId,
                },
              });

              // Check if a transaction exists with specific product, invoice, and warehouse
              // Mostly for part payments
              const existingTransaction =
                await prisma.salesTransaction.findFirst({
                  where: {
                    invoiceId: invoice.id,
                    companyId,
                    productId: item.productId,
                    warehouseId: existingWarehouse.id,
                  },
                });

              if (existingTransaction) {
                // Update the existing transaction.
                await prisma.salesTransaction.update({
                  where: { id: existingTransaction.id },
                  data: {
                    amount: parseFloat(item.amount.replace(/,/g, '')),
                    quantity: Number(item.quantity),
                    rate: Number(item.rate),
                    productName: item.productName,
                    warehouseName: item.warehouseName,
                    productId: item.productId,
                    warehouseId: existingWarehouse.id,
                  },
                });
              } else {
                // Create a new sales transaction
                await prisma.salesTransaction.create({
                  data: {
                    ...salesTransactionData,
                    amount: parseFloat(item.amount.replace(/,/g, '')),
                    quantity: Number(item.quantity),
                    rate: Number(item.rate),
                    productName: item.productName,
                    warehouseName: item.warehouseName,
                    productId: item.productId,
                    warehouseId: existingWarehouse.id,
                  },
                });
              }
            }

            await prisma.batchLog.updateMany({
              where: {
                invoiceId: invoice.id,
                companyId,
                OR: [
                  { saleOrderId: sales ? sales.id : null },
                  { loanRequestId: loanRequest ? loanRequest.id : null },
                ],
              },
              data: {
                status: 'COMPLETED',
                paymentId: payment.id,
              },
            });
          }

          // Update the invoice's payment status
          if (
            createPaymentDto.paymentStatus === PaymentModeStatus.PART_PAYMENT
          ) {
            await prisma.invoice.update({
              where: { id: createPaymentDto.invoiceId },
              data: {
                paymentStatus: PaymentStatus.PART,
              },
            });
          } else {
            await prisma.invoice.update({
              where: { id: createPaymentDto.invoiceId },
              data: {
                paymentStatus: PaymentStatus.PAID,
              },
            });
          }

          // Delete active stocks for the specific item
          // await prisma.stock.deleteMany({
          //   where: {
          //     companyId,
          //     active: true,
          //     openingStock: { lte: '0' },
          //     committedQuantity: { lte: 0 },
          //     product: {
          //       some: {
          //         id: { in: items.map((item) => item.productId) },
          //       },
          //     },
          //   },
          // });

          // Update customer balance with the latest data
          await this.invoice.updateCustomerBalance(
            customer.id,
            companyId,
            prisma,
          );

          return {
            status: 'Success',
            message: 'Payment created successfully',
            data: createdPayments,
          };
        },
        { isolationLevel: 'Serializable', timeout: 60000 },
      );
    } catch (error) {
      console.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while recording Payment',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async createLoanPayment(
    loanRequestId: number,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    const loanRequest = await prisma.loanRequest.findUnique({
      where: { id: loanRequestId, companyId },
    });

    if (!loanRequest) {
      throw new HttpException(
        `Invalid loan request number`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return loanRequest;
  }

  private async createSalesPayment(
    salesOrderId: number,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    const salesOrder = await prisma.salesOrder.findUnique({
      where: { id: salesOrderId, companyId },
      include: { request: { where: { companyId } } },
    });
    if (!salesOrder) {
      throw new HttpException(`Invalid sales number`, HttpStatus.BAD_REQUEST);
    }

    return salesOrder;
  }

  async cancelPayment(userId: number, paymentId: number, comment: string) {
    try {
      await this.prismaService.$transaction(async (prisma) => {
        const user = await this.usersservice.findUserWithRelationships(userId);
        const companyId =
          user.adminCompanyId?.adminID || user.employeeId?.companyId;

        const payment = await prisma.payment.findUnique({
          where: { id: paymentId, companyId },
          include: { invoice: true, salesTransaction: true },
        });

        if (!payment) {
          throw new HttpException('Payment not found', HttpStatus.NOT_FOUND);
        }

        if (payment.paymentStatus === PaymentStatus.CANCELLED) {
          throw new HttpException(
            'Payment already cancelled',
            HttpStatus.BAD_REQUEST,
          );
        }

        // Restore the customer balance based on the payment method
        const customer = await prisma.customer.findUnique({
          where: { id: payment.customerId, companyId },
        });

        if (!customer) {
          throw new HttpException('customer not found', HttpStatus.NOT_FOUND);
        }

        if (payment.paymentStatus) {
          await this.updateCustomerCanceledPaymentBal(
            customer.id,
            companyId,
            paymentId,
            prisma,
          );
        }

        await this.invoice.updateCustomerBalance(
          customer.id,
          companyId,
          prisma,
        );
      });
      return {
        status: 'Success',
        message: 'Payment canceled successfully',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while canceling the payment',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      throw error;
    }
  }

  public async updateCustomerCanceledPaymentBal(
    customerId: number,
    companyId: number,
    paymentId: number,
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

      const payment = await prisma.payment.findUnique({
        where: {
          id: paymentId,
          companyId,
          customerId: customerId,
        },
      });

      if (!payment) {
        throw new HttpException('payment not found', HttpStatus.NOT_FOUND);
      }

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
        console.log('Updating....', payment.paymentMode);
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
        },
        data: {
          paymentStatus: PaymentModeStatus.CANCELLED,
        },
      });

      //Delete the associated sales transactions
      const c = await prisma.salesTransaction.deleteMany({
        where: {
          paymentId: payment.id,
          companyId,
        },
      });

      console.log(c);
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

  async getAllPayments(userId: number) {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Fetch all payments for the given company
      const payments = await this.prismaService.payment.findMany({
        where: { companyId },
        include: {
          invoice: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        status: 'Success',
        message: 'Payments retrieved successfully',
        data: payments,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating purchase order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getPaymentById(userId: number, paymentId: number) {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const Payment = await this.prismaService.payment.findUnique({
        where: { id: paymentId, companyId },
        include: {
          invoice: true,
        },
      });

      if (!Payment) {
        throw new HttpException('Payment not found', HttpStatus.NOT_FOUND);
      }

      return {
        status: 'Success',
        data: Payment,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating purchase order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async items(itemDetails: any) {
    try {
      const itemsArray = [];
      for (const item of itemDetails) {
        const product = await this.prismaService.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) {
          throw new HttpException(
            `Invalid product ID number ${item.productId}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        itemsArray.push(item);
      }
      return itemsArray;
    } catch (error) {
      throw error;
    }
  }
}
