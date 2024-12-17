import { Injectable, HttpStatus, HttpException, Logger } from '@nestjs/common';
import { CreateSalesRequestDto } from './dto/create-sales-request.dto';
import { UsersService } from 'src/auth/users/users.service';
import {
  MailService,
  PrismaService,
  finaliseSerialNumber,
  paginate,
} from 'src/common';
import {
  LoanRequest,
  LoanReturn,
  Prisma,
  Request,
  RequestState,
  RequestType,
  WareHouse,
} from '@prisma/client';
import { UpdateSalesRequestDto } from './dto/update-sales-request.dto';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto';
import { EventsGateway } from 'src/events/events.gateway';
import { GetAllResponse, GetResponse } from 'src/common/interface';
import { PaginationDto } from 'src/common/dto';
import { CreateLoanRequestDto } from './dto/create-loan-request.dto';
import { UpdateLoanRequestDto } from './dto/update-loan-request.dto';
import { PurchaseDetails } from 'src/orders/dto/create-sales-order.dto';
import { ReturnLoanDto } from './dto/return-loan-request.dto';

@Injectable()
export class RequestsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly eventsGateway: EventsGateway,
    private readonly logger: Logger,
    private readonly finaliseSerialNumber: finaliseSerialNumber,
  ) {}

  /************************ SALES REQUEST STARTS *****************************/

  async createSalesRequest(
    userId: number,
    createRequestDto: CreateSalesRequestDto,
  ): Promise<any> {
    try {
      return await this.prismaService.$transaction(
        async (prisma) => {
          const user =
            await this.usersService.findUserWithRelationships(userId);
          const companyId =
            user.adminCompanyId?.adminID || user.employeeId?.companyId;

          const requestExist = await prisma.request.findFirst({
            where: { REQ: createRequestDto.REQ, companyId },
          });

          if (requestExist) {
            throw new HttpException(
              `Request with serial number ${createRequestDto.REQ} already exist`,
              HttpStatus.CONFLICT,
            );
          }

          const customer = await prisma.customer.findUnique({
            where: { id: createRequestDto.customerId, companyId },
          });

          if (!customer) {
            throw new HttpException('Customer not found', HttpStatus.NOT_FOUND);
          }

          // Check if any item quantity requires approval
          const totalQuantity = createRequestDto.itemDetails.reduce(
            (total, item) => total + Number(item.quantity),
            0,
          );

          // Check for valid product IDs and availability
          const uniqueProducts = new Set();
          await Promise.all(
            createRequestDto.itemDetails.map(async (item) => {
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
                  `Stock not found for product ${product.name} and warehouse ${item.warehouseName}`,
                );
              }

              // if (Number(stock.openingStock) === 0) {
              //   await this.zeroStocks.delete(prisma, companyId);
              // }

              // Check if available quantity is sufficient
              // const totalOpeningStock = product.stocks.reduce(
              //   (acc, curr) => acc + Number(curr.openingStock),
              //   0,
              // );

              // if (Number(item.quantity) > totalOpeningStock) {
              //   throw new Error(
              //     `Insufficient quantity for product ${product.name}`,
              //   );
              // }
            }),
          );

          if (createRequestDto.priceListId) {
            const priceList = await prisma.priceList.findUnique({
              where: { id: createRequestDto.priceListId, companyId },
              include: { products: { where: { companyId } } },
            });

            if (!priceList) {
              throw new HttpException(
                `PriceList not found`,
                HttpStatus.NOT_FOUND,
              );
            }

            if (priceList.customerType !== customer.customerType) {
              throw new HttpException(
                `PriceList can only be applied to same customer Type`,
                HttpStatus.NOT_FOUND,
              );
            }

            // Compare productIds in the dto with the productIds in the priceList
            const missingProductIds = createRequestDto.productIds?.filter(
              (productId) =>
                !priceList.products.some((product) => product.id === productId),
            );

            if (missingProductIds.length > 0) {
              throw new HttpException(
                `Products with IDs ${missingProductIds.join(
                  ', ',
                )} not found in the PriceList`,
                HttpStatus.NOT_FOUND,
              );
            }
          }

          let request;
          if (totalQuantity && totalQuantity > 1000) {
            if (createRequestDto.approverId) {
              const approver = await prisma.user.findUnique({
                where: { id: createRequestDto.approverId, companyId },
              });

              if (!approver) {
                throw new HttpException(
                  'Assigned approver not found',
                  HttpStatus.NOT_FOUND,
                );
              }

              // Create sales request
              request = await prisma.request.create({
                data: {
                  REQ: createRequestDto.REQ,
                  name: createRequestDto.customerName,
                  type: createRequestDto.type,
                  location: createRequestDto.location,
                  openedBy: createRequestDto.openedBy,
                  opened: createRequestDto.opened,
                  dueDate: createRequestDto.dueDate,
                  totalPrice: createRequestDto.totalPrice,
                  approverName: createRequestDto.approverName,
                  approverId: approver.id,
                  priceListName: createRequestDto.priceListName,
                  salesRequest: {
                    connect: createRequestDto?.itemDetails?.map((p) => ({
                      id: Number(p.productId),
                    })),
                  },
                  itemDetails: createRequestDto?.itemDetails.map((item) => ({
                    productId: item?.productId,
                    productName: item.productName,
                    unitType: item.unitType,
                    quantity: item.quantity,
                    warehouseName: item.warehouseName,
                    amount: item.amount,
                    rate: item.rate,
                    unit: item.unit,
                    baseQty: item.baseQty,
                  })),
                  customerId: customer.id,
                  companyId,
                },
                include: { salesRequest: true },
              });

              // Create notification
              const notification = await prisma.approvalNotifications.create({
                data: {
                  message: `New sales request ${request.REQ} needs approval.`,
                  companyId,
                  userId: user.id,
                  approverId: approver.id,
                  requestId: request.id,
                  notifierId: createRequestDto.approverId,
                  type: 'SalesRequestApproval',
                },
                include: { request: true },
              });

              const appNotification = await prisma.inAppNotifications.create({
                data: {
                  message: `New sales request ${request.REQ} needs approval.`,
                  companyId,
                  requestId: request.id,
                  receiverId: approver.id,
                  senderId: user.id,
                  type: 'SalesRequestApproval',
                },
                include: { request: true },
              });

              await this.eventsGateway.sendNotificationToUser(
                approver.id,
                appNotification,
                prisma,
              );

              // Send notification
              await this.mailService.salesRequestNotifications(
                notification,
                approver,
                user,
                request,
              );

              if (request) {
                await this.finaliseSerialNumber.markSerialNumber(
                  createRequestDto.REQ,
                  companyId,
                );
              }

              return {
                status: 'Success',
                message: 'Request successfully created',
                data: request,
              };
            }
          }

          request = await this.createSalesRequestWithoutApproval(
            companyId,
            customer.id,
            createRequestDto,
            prisma,
          );

          if (request) {
            await this.finaliseSerialNumber.markSerialNumber(
              createRequestDto.REQ,
              companyId,
            );
          }

          return {
            status: 'Success',
            message: 'Request successfully created',
            data: request,
          };
        },
        { isolationLevel: 'Serializable', timeout: 60000 },
      );
    } catch (error) {
      this.logger.error(error);
      if (error.code === 'P2034') {
        throw new HttpException(
          'Duplicate transaction, try again later',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async createSalesRequestWithoutApproval(
    companyId: number,
    customerId: number,
    createRequestDto,
    prisma: Prisma.TransactionClient,
  ) {
    const request = await prisma.request.create({
      data: {
        REQ: createRequestDto.REQ,
        name: createRequestDto.customerName,
        type: createRequestDto.type,
        location: createRequestDto.location,
        openedBy: createRequestDto.openedBy,
        opened: createRequestDto.opened,
        dueDate: createRequestDto.dueDate,
        totalPrice: createRequestDto.totalPrice,
        priceListName: createRequestDto.priceListName,
        state: RequestState.APPROVED,
        approverName: createRequestDto.approverName,
        salesRequest: {
          connect: createRequestDto?.itemDetails?.map((p) => ({
            id: Number(p.productId),
          })),
        },
        itemDetails: createRequestDto?.itemDetails.map((item) => ({
          productId: item?.productId,
          productName: item.productName,
          unitType: item.unitType,
          quantity: item.quantity,
          warehouseName: item.warehouseName,
          amount: item.amount,
          rate: item.rate,
          unit: item.unit,
          baseQty: item.baseQty,
        })),
        customerId: customerId,
        companyId,
      },
    });

    return request;
  }

  async updateSalesApprovalRequest(
    userId: number,
    requestId: number,
    UpdateSalesRequestDto: UpdateSalesRequestDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the request exists
      const existingRequest = await this.prismaService.request.findUnique({
        where: { id: requestId, companyId },
      });

      if (!existingRequest) {
        throw new HttpException(
          `Request with id number ${requestId} does not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const getNotification =
        await this.prismaService.approvalNotifications.findFirst({
          where: {
            approverId: userId,
            companyId,
            requestId: existingRequest.id,
          },
        });

      if (!getNotification) {
        // Handle the case when no notification is found
        throw new HttpException('No notification found', HttpStatus.NOT_FOUND);
      }
      //console.log(getNotification);
      const requestedUser = await this.prismaService.user.findUnique({
        where: { id: getNotification.userId, companyId },
      });
      // Save the updated request
      const updatedRequest = await this.prismaService.request.update({
        where: { id: requestId, companyId },
        data: {
          state: UpdateSalesRequestDto.state,
        },
      });

      if (UpdateSalesRequestDto.state === RequestState.APPROVED) {
        const notification =
          await this.prismaService.approvalNotifications.update({
            where: { id: getNotification.id },
            data: {
              message: `Request with serial number: ${updatedRequest.REQ} has been approved.`,
              companyId,
              comment: null,
              read: false,
              userId: requestedUser.id,
              approverId: user.id,
              requestId: existingRequest.id,
              notifierId: requestedUser.id,
              type: 'ApprovedSalesRequest',
            },
            include: { request: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Request with serial number: ${updatedRequest.REQ} has been approved.`,
              companyId,
              requestId: existingRequest.id,
              receiverId: requestedUser.id,
              senderId: user.id,
              type: 'ApprovedSalesRequest',
            },
            include: { request: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          requestedUser.id,
          appNotification,
        );
        //console.log(notification);
        await this.mailService.requestApprovalNotifications(
          notification,
          requestedUser,
          user,
          updatedRequest,
        );
      } else if (UpdateSalesRequestDto.state === RequestState.REJECT) {
        const notification =
          await this.prismaService.approvalNotifications.update({
            where: {
              id: getNotification.id,
              companyId,
            },
            data: {
              message: `Request with serial number: ${updatedRequest.REQ} was rejected.`,
              comment: UpdateSalesRequestDto.comment,
              companyId,
              userId: requestedUser.id,
              approverId: user.id,
              requestId: existingRequest.id,
              notifierId: requestedUser.id,
              read: false,
              type: 'RejectedSalesRequest',
            },
            include: { request: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Request with serial number: ${updatedRequest.REQ} was rejected.`,
              companyId,
              requestId: existingRequest.id,
              receiverId: requestedUser.id,
              senderId: user.id,
              type: 'RejectedSalesRequest',
            },
            include: { request: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          requestedUser.id,
          appNotification,
        );
        await this.mailService.requestRejectionNotifications(
          notification,
          requestedUser,
          user,
          updatedRequest,
        );
      }

      return {
        status: 'Success',
        data: updatedRequest,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async editSalesRequest(
    userId: number,
    requestId: number,
    updateRequestDto: UpdateSalesRequestDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the request exists
      const existingRequest = await this.prismaService.request.findUnique({
        where: { id: requestId, companyId },
      });

      if (!existingRequest) {
        throw new HttpException(
          `Sales request with id ${requestId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Check if data is provided for update
      if (!Object.keys(updateRequestDto).length) {
        return {
          status: 'No Updates',
          data: [],
        };
      }

      // Notify approver about the update
      const approver = await this.prismaService.user.findUnique({
        where: { id: updateRequestDto.approverId, companyId },
      });

      if (!approver) {
        throw new HttpException(
          `Approver with id ${updateRequestDto.approverId} does not exist`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // Update the request fields
      const updatedRequest = await this.prismaService.request.update({
        where: { id: requestId, companyId },
        data: {
          name: updateRequestDto.customerName,
          type: updateRequestDto.type,
          location: updateRequestDto.location,
          openedBy: updateRequestDto.openedBy,
          opened: updateRequestDto.opened,
          dueDate: updateRequestDto.dueDate,
          totalPrice: updateRequestDto.totalPrice,
          state: RequestState.PENDING,
          approverName: updateRequestDto.approverName,
          itemDetails: updateRequestDto?.itemDetails?.map((item) => ({
            productId: item?.productId,
            productName: item.productName,
            unitType: item.unitType,
            quantity: item.quantity,
            warehouseName: item.warehouseName,
            amount: item.amount,
            rate: item.rate,
            unit: item.unit,
            baseQty: item.baseQty,
          })),
        },
      });

      // Retrieve existing notification for the given approver and sales order
      const existingNotification =
        await this.prismaService.approvalNotifications.findFirst({
          where: {
            approverId: approver.id,
            requestId: updatedRequest.id,
          },
        });
      //console.log(existingNotification);

      // If notification doesn't exist, create one
      if (!existingNotification) {
        const notification =
          await this.prismaService.approvalNotifications.create({
            data: {
              message: `Sales request ${updatedRequest.REQ} needs approval.`,
              companyId,
              userId: user.id,
              approverId: approver.id,
              requestId: updatedRequest.id,
              notifierId: approver.id,
              type: 'SalesRequestApproval',
            },
            include: { request: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Sales request ${updatedRequest.REQ} needs approval.`,
              companyId,
              requestId: updatedRequest.id,
              receiverId: approver.id,
              senderId: user.id,
              type: 'SalesRequestApproval',
            },
            include: { request: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          approver.id,
          appNotification,
        );
        await this.mailService.salesRequestNotifications(
          notification,
          approver,
          user,
          updatedRequest,
        );
      }
      return {
        status: 'Success',
        data: updatedRequest,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getApprovedSalesRequests(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<Request>> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const requests = await paginate(
        this.prismaService.request,
        paginationDto,
        {
          where: {
            state: RequestState.APPROVED,
            companyId,
            type: RequestType.CUSTOMER,
          },
          include: {
            customer: { where: { companyId } },
            approvalNotifications: { where: { companyId } },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      );

      return {
        status: 'Success',
        message: 'Requests retrieved successfully',
        data: requests.data as Request[],
        totalItems: requests.totalItems,
        currentPage: requests.currentPage,
        totalPages: requests.totalPages,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getSalesRequests(userId: number): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const requests = await this.prismaService.request.findMany({
        where: { companyId, type: RequestType.CUSTOMER },
        include: {
          customer: { where: { companyId } },
          approvalNotifications: { where: { companyId } },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        status: 'Success',
        message: 'Requests retrieved successfully',
        data: requests,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async cancelSalesRequest(
    userId: number,
    requestId: number,
    comment?: string,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const requestExist = await this.prismaService.request.findFirst({
        where: { id: requestId, companyId },
      });

      if (!requestExist) {
        throw new HttpException(
          `Request with id number ${requestId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const request = await this.prismaService.request.update({
        where: { id: requestId },
        data: { state: RequestState.CANCELLED, comment },
      });

      let notification =
        await this.prismaService.approvalNotifications.findFirst({
          where: {
            // approverId: request.approverId,
            companyId,
            requestId: request.id,
          },
        });

      if (notification) {
        const approver = await this.prismaService.user.findUnique({
          where: { id: notification.approverId, companyId },
        });
        notification = await this.prismaService.approvalNotifications.update({
          where: {
            id: notification.id,
            companyId,
          },
          data: {
            message: `Request with serial number: ${request.REQ} was Cancelled.`,
            comment: request.comment,
            companyId,
            userId: user.id,
            approverId: approver.id,
            requestId: request.id,
            notifierId: user.id,
            read: false,
            type: 'CancelledSalesRequest',
          },
          include: { request: true },
        });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Request with serial number: ${request.REQ} was Cancelled.`,
              companyId,
              requestId: request.id,
              receiverId: approver.id,
              senderId: user.id,
              type: 'CancelledSalesRequest',
            },
            include: { request: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          approver.id,
          appNotification,
        );
        await this.mailService.requestRejectionNotifications(
          notification,
          approver,
          user,
          request,
        );
      }

      return {
        status: 'Success',
        message: 'Request successfully cancelled',
        data: request,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while canceling request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  /************************ SALES REQUEST ENDS *****************************/

  /************************ PURCHASE REQUEST STARTS *****************************/
  // async createPurchaseRequest(
  //   userId: number,
  //   createRequestDto: CreatePurchaseRequestDto,
  // ): Promise<any> {
  //   try {
  //     return await this.prismaService.$transaction(
  //       async (prisma) => {
  //         const user =
  //           await this.usersService.findUserWithRelationships(userId);
  //         const companyId =
  //           user.adminCompanyId?.adminID || user.employeeId?.companyId;

  //         const supplier = await prisma.supplier.findUnique({
  //           where: { id: createRequestDto.supplierId, companyId },
  //         });

  //         if (!supplier) {
  //           throw new HttpException('Supplier not found', HttpStatus.NOT_FOUND);
  //         }

  //         await Promise.all(
  //           createRequestDto.itemDetails.map(async (item) => {
  //             const product = await prisma.product.findUnique({
  //               where: { id: Number(item.productId) },
  //               include: { stocks: true },
  //             });

  //             if (!product) {
  //               throw new HttpException(
  //                 `Invalid product ID: ${item.productId}`,
  //                 HttpStatus.BAD_REQUEST,
  //               );
  //             }
  //           }),
  //         );

  //         const warehousePromises = (createRequestDto.itemDetails || []).map(
  //           async (item) => {
  //             const warehouse = await prisma.wareHouse.findFirst({
  //               where: {
  //                 name: {
  //                   equals: item.warehouseName.trim(),
  //                   mode: 'insensitive',
  //                 },
  //                 companyId,
  //               },
  //               include: {
  //                 products: { where: { name: item.productName } },
  //               },
  //             });
  //             if (!warehouse) {
  //               throw new HttpException(
  //                 `Warehouse not found for request with warehouseName: ${item.warehouseName}`,
  //                 HttpStatus.NOT_FOUND,
  //               );
  //             }

  //             return warehouse;
  //           },
  //         );

  //         const warehouses = await Promise.all(warehousePromises);

  //         // const hasProductsInAnyWarehouse = warehouses.map((warehouse) => {
  //         //   if (!warehouse.products || warehouse.products.length === 0) {
  //         //     throw new HttpException(
  //         //       `Product name does not exist in warehouse ${warehouse.name}`,
  //         //       HttpStatus.NOT_FOUND,
  //         //     );
  //         //   }
  //         //   return true;
  //         // });

  //         if (warehouses.every((hasProducts) => !hasProducts)) {
  //           throw new HttpException(
  //             'Product not found in any warehouse',
  //             HttpStatus.NOT_FOUND,
  //           );
  //         }

  //         const existingRequest = await prisma.request.findFirst({
  //           where: { REQ: createRequestDto.REQ, companyId },
  //         });

  //         if (existingRequest) {
  //           throw new HttpException(
  //             `Request already created with this request serial number ${createRequestDto.REQ} `,
  //             HttpStatus.BAD_REQUEST,
  //           );
  //         }
  //         const approver = await prisma.user.findUnique({
  //           where: { id: createRequestDto.approverId, companyId },
  //         });
  //         if (!approver) {
  //           throw new HttpException(
  //             `Approver with id ${createRequestDto.approverId} does not exist`,
  //             HttpStatus.BAD_REQUEST,
  //           );
  //         }
  //         const request = await prisma.request.create({
  //           data: {
  //             REQ: createRequestDto.REQ,
  //             name: createRequestDto.supplierName,
  //             type: createRequestDto.type,
  //             location: createRequestDto.location,
  //             openedBy: createRequestDto.openedBy,
  //             opened: createRequestDto.opened,
  //             dueDate: createRequestDto.dueDate,
  //             totalPrice: createRequestDto.totalPrice,
  //             approverName: createRequestDto.approverName,
  //             purchaseRequest: {
  //               connect: createRequestDto?.itemDetails.map((p) => ({
  //                 id: Number(p.productId),
  //               })),
  //             },
  //             itemDetails: createRequestDto?.itemDetails.map((item) => ({
  //               productId: item?.productId,
  //               productName: item.productName,
  //               unitType: item.unitType,
  //               quantity: item.quantity,
  //               warehouseName: item.warehouseName,
  //               amount: item.amount,
  //               rate: item.rate,
  //               unit: item.unit,
  //               baseQty: item.baseQty,
  //             })),
  //             supplierId: supplier.id,
  //             companyId,
  //           },
  //         });

  //         const notification = await prisma.approvalNotifications.create({
  //           data: {
  //             message: `New purchase request ${request.REQ} needs approval.`,
  //             companyId,
  //             userId: user.id,
  //             approverId: approver.id,
  //             requestId: request.id,
  //             notifierId: approver.id,
  //             type: 'PurchaseRequestApproval',
  //           },
  //           include: { request: true },
  //         });

  //         const appNotification = await prisma.inAppNotifications.create({
  //           data: {
  //             message: `New purchase request ${request.REQ} needs approval.`,
  //             companyId,
  //             requestId: request.id,
  //             receiverId: approver.id,
  //             senderId: user.id,
  //             type: 'PurchaseRequestApproval',
  //           },
  //           include: { request: true },
  //         });

  //         this.eventsGateway.sendNotificationToUser(
  //           approver.id,
  //           appNotification,
  //         );
  //         await this.mailService.purchaseRequestNotifications(
  //           notification,
  //           approver,
  //           user,
  //           request,
  //         );

  //         if (request) {
  //           await this.finaliseSerialNumber.markSerialNumber(
  //             createRequestDto.REQ,
  //             companyId,
  //           );
  //         }

  //         return {
  //           status: 'Success',
  //           data: request,
  //         };
  //       },
  //       { isolationLevel: 'Serializable' },
  //     );
  //   } catch (error) {
  //     if (error.code === 'P2034') {
  //       throw new HttpException(
  //         'Duplicate transaction, try again later',
  //         HttpStatus.BAD_REQUEST,
  //       );
  //     }
  //     if (error instanceof Prisma.PrismaClientValidationError) {
  //       throw new HttpException(
  //         'An error occurred while creating request',
  //         HttpStatus.BAD_REQUEST,
  //       );
  //     }
  //     this.logger.error(error);
  //     throw error;
  //   }
  // }

  async createPurchaseRequest(
    userId: number,
    createRequestDto: CreatePurchaseRequestDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const supplier = await this.prismaService.supplier.findUnique({
        where: { id: createRequestDto.supplierId, companyId },
      });

      if (!supplier) {
        throw new HttpException('Supplier not found', HttpStatus.NOT_FOUND);
      }

      const approver = await this.prismaService.user.findUnique({
        where: { id: createRequestDto.approverId, companyId },
      });

      if (!approver) {
        throw new HttpException(
          `Approver with id ${createRequestDto.approverId} does not exist`,
          HttpStatus.BAD_REQUEST,
        );
      }

      await Promise.all(
        createRequestDto.itemDetails.map(async (item) => {
          const product = await this.prismaService.product.findUnique({
            where: { id: Number(item.productId) },
            include: { stocks: true },
          });

          if (!product) {
            throw new HttpException(
              `Invalid product ID: ${item.productId}`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }),
      );

      const warehousePromises = (createRequestDto.itemDetails || []).map(
        async (item) => {
          const warehouse = await this.prismaService.wareHouse.findFirst({
            where: {
              name: {
                equals: item.warehouseName.trim(),
                mode: 'insensitive',
              },
              companyId,
            },
            include: {
              products: { where: { name: item.productName } },
            },
          });
          if (!warehouse) {
            throw new HttpException(
              `Warehouse not found for request with warehouseName: ${item.warehouseName}`,
              HttpStatus.NOT_FOUND,
            );
          }

          return warehouse;
        },
      );

      const warehouses = await Promise.all(warehousePromises);

      // const hasProductsInAnyWarehouse = warehouses.map((warehouse) => {
      //   if (!warehouse.products || warehouse.products.length === 0) {
      //     throw new HttpException(
      //       `Product name does not exist in warehouse ${warehouse.name}`,
      //       HttpStatus.NOT_FOUND,
      //     );
      //   }
      //   return true;
      // });

      if (warehouses.every((hasProducts) => !hasProducts)) {
        throw new HttpException(
          'Product not found in any warehouse',
          HttpStatus.NOT_FOUND,
        );
      }

      const existingRequest = await this.prismaService.request.findFirst({
        where: { REQ: createRequestDto.REQ, companyId },
      });

      if (existingRequest) {
        throw new HttpException(
          `Request already created with this request serial number ${createRequestDto.REQ}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const request = await this.prismaService.$transaction(async (prisma) => {
        const request = await prisma.request.create({
          data: {
            REQ: createRequestDto.REQ,
            name: createRequestDto.supplierName,
            type: createRequestDto.type,
            location: createRequestDto.location,
            openedBy: createRequestDto.openedBy,
            opened: createRequestDto.opened,
            dueDate: createRequestDto.dueDate,
            totalPrice: createRequestDto.totalPrice,
            approverName: createRequestDto.approverName,
            purchaseRequest: {
              connect: createRequestDto?.itemDetails.map((p) => ({
                id: Number(p.productId),
              })),
            },
            itemDetails: createRequestDto?.itemDetails.map((item) => ({
              productId: item?.productId,
              productName: item.productName,
              unitType: item.unitType,
              quantity: item.quantity,
              warehouseName: item.warehouseName,
              amount: item.amount,
              rate: item.rate,
              unit: item.unit,
              baseQty: item.baseQty,
            })),
            supplierId: supplier.id,
            companyId,
          },
        });

        return request;
      });

      const notification =
        await this.prismaService.approvalNotifications.create({
          data: {
            message: `New purchase request ${request.REQ} needs approval.`,
            companyId,
            userId: user.id,
            approverId: approver.id,
            requestId: request.id,
            notifierId: approver.id,
            type: 'PurchaseRequestApproval',
          },
          include: { request: true },
        });

      const appNotification =
        await this.prismaService.inAppNotifications.create({
          data: {
            message: `New purchase request ${request.REQ} needs approval.`,
            companyId,
            requestId: request.id,
            receiverId: approver.id,
            senderId: user.id,
            type: 'PurchaseRequestApproval',
          },
          include: { request: true },
        });

      await this.eventsGateway.sendNotificationToUser(
        approver.id,
        appNotification,
      );
      await this.mailService.purchaseRequestNotifications(
        notification,
        approver,
        user,
        request,
      );

      await this.finaliseSerialNumber.markSerialNumber(
        createRequestDto.REQ,
        companyId,
      );

      return {
        status: 'Success',
        data: request,
      };
    } catch (error) {
      if (error.code === 'P2034') {
        throw new HttpException(
          'Duplicate transaction, try again later',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating request',
          HttpStatus.BAD_REQUEST,
        );
      }
      this.logger.error(error);
      throw error;
    }
  }

  async updatePurchaseApprovalRequest(
    userId: number,
    requestId: number,
    updateSalesRequestDto: UpdateSalesRequestDto,
  ): Promise<any> {
    try {
      // console.log(userId);
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the request exists
      const existingRequest = await this.prismaService.request.findUnique({
        where: { id: requestId, companyId },
      });

      if (!existingRequest) {
        throw new HttpException(
          `Request with id number ${requestId} does not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const getNotification =
        await this.prismaService.approvalNotifications.findFirst({
          where: {
            approverId: userId,
            companyId,
            requestId: existingRequest.id,
          },
        });

      if (!getNotification) {
        // Handle the case when no notification is found
        throw new HttpException('No notification found', HttpStatus.NOT_FOUND);
      }
      //console.log(getNotification);
      const requestedUser = await this.prismaService.user.findUnique({
        where: { id: getNotification.userId, companyId },
      });
      // Save the updated request
      const updatedRequest = await this.prismaService.request.update({
        where: { id: requestId, companyId },
        data: {
          state: updateSalesRequestDto.state,
        },
      });

      if (updateSalesRequestDto.state === RequestState.APPROVED) {
        const notification =
          await this.prismaService.approvalNotifications.update({
            where: { id: getNotification.id },
            data: {
              message: `Request with serial number: ${updatedRequest.REQ} has been approved.`,
              companyId,
              comment: null,
              read: false,
              userId: requestedUser.id,
              approverId: user.id,
              requestId: existingRequest.id,
              notifierId: requestedUser.id,
              type: 'ApprovedPurchaseRequest',
            },
            include: { request: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Request with serial number: ${updatedRequest.REQ} has been approved.`,
              companyId,
              requestId: existingRequest.id,
              receiverId: requestedUser.id,
              senderId: user.id,
              type: 'ApprovedPurchaseRequest',
            },
            include: { request: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          requestedUser.id,
          appNotification,
        );
        await this.mailService.requestApprovalNotifications(
          notification,
          requestedUser,
          user,
          updatedRequest,
        );
      } else if (updateSalesRequestDto.state === RequestState.REJECT) {
        const notification =
          await this.prismaService.approvalNotifications.update({
            where: {
              id: getNotification.id,
              companyId,
            },
            data: {
              message: `Request with serial number: ${updatedRequest.REQ} was rejected.`,
              comment: updateSalesRequestDto.comment,
              companyId,
              userId: requestedUser.id,
              approverId: user.id,
              requestId: existingRequest.id,
              notifierId: requestedUser.id,
              read: false,
              type: 'RejectedPurchaseRequest',
            },
            include: { request: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Request with serial number: ${updatedRequest.REQ} was rejected.`,
              companyId,
              requestId: existingRequest.id,
              receiverId: requestedUser.id,
              senderId: user.id,
              type: 'RejectedPurchaseRequest',
            },
            include: { request: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          requestedUser.id,
          appNotification,
        );
        await this.mailService.requestRejectionNotifications(
          notification,
          requestedUser,
          user,
          updatedRequest,
        );
      }

      return {
        status: 'Success',
        data: updatedRequest,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getPurchaseRequests(userId: number): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const requests = await this.prismaService.request.findMany({
        where: { companyId, type: RequestType.SUPPLIER },
        include: {
          supplier: { where: { companyId } },
          approvalNotifications: { where: { companyId } },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        status: 'Success',
        message: 'Requests retrieved successfully',
        data: requests,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getApprovedPurchaseRequests(userId: number): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const requests = await this.prismaService.request.findMany({
        where: {
          state: RequestState.APPROVED,
          companyId,
          type: RequestType.SUPPLIER,
        },
        include: {
          customer: { where: { companyId } },
          approvalNotifications: { where: { companyId } },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        status: 'Success',
        message: 'Requests retrieved successfully',
        data: requests,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async editPurchaseRequest(
    userId: number,
    requestId: number,
    updateRequestDto: UpdatePurchaseRequestDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the request exists
      const existingRequest = await this.prismaService.request.findUnique({
        where: { id: requestId, companyId },
      });

      if (!existingRequest) {
        throw new HttpException(
          `Purchase request with id ${requestId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Check if data is provided for update
      if (!Object.keys(updateRequestDto).length) {
        return {
          status: 'No Updates',
          data: [],
        };
      }

      // Notify approver about the update
      const approver = await this.prismaService.user.findUnique({
        where: { id: updateRequestDto.approverId, companyId },
      });

      if (!approver) {
        throw new HttpException(
          `Approver with id ${updateRequestDto.approverId} does not exist`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // Update the request fields
      const updatedRequest = await this.prismaService.request.update({
        where: { id: requestId, companyId },
        data: {
          name: updateRequestDto.supplierName,
          type: updateRequestDto.type,
          location: updateRequestDto.location,
          openedBy: updateRequestDto.openedBy,
          opened: updateRequestDto.opened,
          dueDate: updateRequestDto.dueDate,
          totalPrice: updateRequestDto.totalPrice,
          approverName: updateRequestDto.approverName,
          state: RequestState.PENDING,
          itemDetails: updateRequestDto?.itemDetails?.map((item) => ({
            productId: item?.productId,
            productName: item.productName,
            unitType: item.unitType,
            quantity: item.quantity,
            warehouseName: item.warehouseName,
            amount: item.amount,
            rate: item.rate,
            unit: item.unit,
            baseQty: item.baseQty,
          })),
        },
      });

      const existingNotification =
        await this.prismaService.approvalNotifications.findFirst({
          where: {
            approverId: approver.id,
            requestId: updatedRequest.id,
          },
        });

      if (!existingNotification) {
        const notification =
          await this.prismaService.approvalNotifications.create({
            data: {
              message: `Purchase request ${updatedRequest.REQ} needs approval.`,
              companyId,
              userId: user.id,
              approverId: approver.id,
              requestId: updatedRequest.id,
              notifierId: approver.id,
              type: 'PurchaseRequestApproval',
            },
            include: { request: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Purchase request ${updatedRequest.REQ} needs approval.`,
              companyId,
              requestId: updatedRequest.id,
              receiverId: approver.id,
              senderId: user.id,
              type: 'PurchaseRequestApproval',
            },
            include: { request: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          approver.id,
          appNotification,
        );
        await this.mailService.purchaseRequestNotifications(
          notification,
          approver,
          user,
          updatedRequest,
        );
      }

      // if (updatedRequest) {
      //   await this.finaliseSerialNumber.markSerialNumber(
      //     updateRequestDto.REQ,
      //     companyId,
      //   );
      // }

      return {
        status: 'Success',
        data: updatedRequest,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  /************************ PURCHASE REQUEST ENDS *****************************/

  async getRequestByREQ(userId: number, requestNumber: string): Promise<any> {
    try {
      // Check if the user exists with associated relationships
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const request = await this.prismaService.request.findFirst({
        where: { REQ: requestNumber, companyId },
        include: {
          customer: { where: { companyId } },
          supplier: { where: { companyId } },
          approvalNotifications: { where: { companyId } },
        },
      });

      if (!request) {
        throw new HttpException('Request not found', HttpStatus.NOT_FOUND);
      }

      return {
        status: 'Success',
        data: request,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async sendEmailToCustomer(userId: number, id: number): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const request = await this.prismaService.request.findUnique({
        where: { id, companyId },
      });

      if (!request) {
        throw new HttpException(
          `Customer request with id ${id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const customerId: number = request.customerId;
      const customer = await this.prismaService.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new HttpException(`Customer not found`, HttpStatus.NOT_FOUND);
      }

      const itemDetails: {
        rate: string;
        amount: string;
        quantity: string;
        productId: number;
        productName: string;
        warehouseName: string;
      }[] = request.itemDetails as {
        rate: string;
        amount: string;
        quantity: string;
        productId: number;
        productName: string;
        warehouseName: string;
      }[];

      // Compose email body
      let emailBody = `
        <p class="sm-leading-8" style="margin: 0; margin-bottom: 24px; font-size: 24px; font-weight: 600; color: #000;">Product Details</p>
        <table style="width: 100%; border-collapse: collapse;" cellpadding="0" cellspacing="0" role="presentation">
          <thead>
            <tr>
              <th style="padding: 8px; border: 1px solid #e2e8f0;">Product Name</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0;">Quantity</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0;">Rate</th>
              <th style="padding: 8px; border: 1px solid #e2e8f0;">Amount</th>
            </tr>
          </thead>
          <tbody>`;

      // Populate table rows with item details
      itemDetails.forEach((item: any) => {
        emailBody += `
          <tr>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${item.productName}</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${item.quantity}</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${item.rate}</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${item.amount}</td>
          </tr>`;
      });

      emailBody += `</tbody>
        </table>`;

      // Add more information to the email body
      emailBody += `
        <p>Company Name: ${user.adminCompanyId.organizationName}</p>
        <p>S/N: ${request.REQ}</p>
        <p>Location: ${request.location}</p>
        <p>Total Price: ${request.totalPrice}</p>
        <p>Customer Name: ${customer.companyName ? customer.companyName : customer.displayName}</p>
        <p>Customer Type: ${customer.type}</p>
        
  
        <p>Thank you for your patronage!</p>
      `;

      if (customer.companyEmail) {
        // Send email to the customer
        await this.mailService.sendEmailToCustomer(
          customer.companyEmail,
          `Customer Quote`,
          emailBody,
        );
      } else {
        throw new HttpException(
          `Customer email address not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        status: 'Success',
        message: 'Quote successfully sent',
      };
    } catch (error) {
      this.logger.error(error);
      console.error(
        `Error sending email to customer: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /************************ LOAN REQUEST STARTS *****************************/

  async loanRequest(
    userId: number,
    createRequestDto: CreateLoanRequestDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const requestExist = await this.prismaService.loanRequest.findFirst({
        where: { requestNumber: createRequestDto.requestNumber, companyId },
      });

      if (requestExist) {
        throw new HttpException(
          `Request with serial number ${createRequestDto.requestNumber} already exists`,
          HttpStatus.CONFLICT,
        );
      }

      const customer = await this.prismaService.customer.findUnique({
        where: { id: createRequestDto.customerId, companyId },
      });

      if (!customer) {
        throw new HttpException('Customer not found', HttpStatus.NOT_FOUND);
      }

      const warehouse = await this.prismaService.wareHouse.findUnique({
        where: { id: createRequestDto.warehouseId, companyId },
        include: { stocks: { include: { product: true } } },
      });

      if (!warehouse) {
        throw new HttpException('Warehouse not found', HttpStatus.NOT_FOUND);
      }

      // Create a Set to store the product IDs available in the warehouse's stocks
      const availableProductIds: Set<number> = new Set();

      // Loop through each stock and add product IDs to the Set
      warehouse.stocks.forEach((stock) => {
        stock.product.forEach((p) => availableProductIds.add(p.id));
      });

      // Check for duplicate products and validate product availability
      const uniqueProducts = new Set<number>();
      for (const item of createRequestDto.itemDetails) {
        if (uniqueProducts.has(item.productId)) {
          throw new HttpException(
            `Duplicate product details: ${item.productName}`,
            HttpStatus.BAD_REQUEST,
          );
        }
        uniqueProducts.add(item.productId);

        if (!availableProductIds.has(item.productId)) {
          throw new HttpException(
            `Product ${item.productName} not found in warehouse ${warehouse.name}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        // Find the stock for the product in the warehouse
        const stock = warehouse.stocks.find((stock) =>
          stock.product.every((p) => p.id === item.productId),
        );

        if (!stock) {
          throw new HttpException(
            `Stock not found for product: ${item.productName}`,
            HttpStatus.NOT_FOUND,
          );
        }

        const availableStock = warehouse.stocks
          .filter((s) => s.product.some((p) => p.id === item.productId))
          .reduce(
            (total, currentStock) =>
              total + Number(currentStock.openingStock || 0),
            0,
          );

        if (!stock) {
          throw new HttpException(
            `Stock not found for product: ${item.productName}`,
            HttpStatus.NOT_FOUND,
          );
        }

        // Validate available quantity
        if (Number(item.qtyAvailable) !== availableStock) {
          throw new HttpException(
            `Incorrect available quantity for product ${item.productName}. Expected: ${availableStock}, Provided: ${item.qtyAvailable}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        // Ensure the transferred quantity does not exceed available stock
        if (Number(item.qtyTransfer) > availableStock) {
          throw new HttpException(
            `Insufficient stock for product ${item.productName}. Requested: ${item.qtyTransfer}, Available: ${availableStock}`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      return await this.prismaService.$transaction(
        async (prisma) => {
          const approver = await prisma.user.findUnique({
            where: { id: createRequestDto.approverId, companyId },
          });

          if (!approver) {
            throw new HttpException(
              'Assigned approver not found',
              HttpStatus.NOT_FOUND,
            );
          }

          const request = await prisma.loanRequest.create({
            data: {
              requestNumber: createRequestDto.requestNumber,
              dateInitiated: createRequestDto.dateInitiated,
              dueDate: createRequestDto.dueDate,
              status: RequestState.PENDING,
              requestedBy: user.primaryContactName,
              price: createRequestDto.price,
              approverId: approver.id,
              customerId: customer.id,
              warehouseId: warehouse.id,
              companyId,
              products: {
                connect: createRequestDto.itemDetails.map((p) => ({
                  id: Number(p.productId),
                })),
              },
              itemDetails: createRequestDto.itemDetails.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                qtyAvailable: item.qtyAvailable,
                qtyTransfer: item.qtyTransfer,
                qtyToBeReturned: item.qtyTransfer,
                warehouseName: warehouse.name,
                qtyReturned: 0,
                balanceQty: 0,
                amount: item.amount,
                rate: item.rate,
                unitType: item.unitType,
                unit: item.unit,
                baseQty: item.baseQty,
              })),
            },
          });

          // Create notification for approver
          await prisma.approvalNotifications.create({
            data: {
              message: `New loan request ${request.requestNumber} needs approval.`,
              companyId,
              userId: user.id,
              approverId: approver.id,
              loanRequestId: request.id,
              notifierId: createRequestDto.approverId,
              type: 'LoanRequestApproval',
            },
            include: { loanRequest: true },
          });

          const appNotification = await prisma.inAppNotifications.create({
            data: {
              message: `New loan request ${request.requestNumber} needs approval.`,
              companyId,
              loanRequestId: request.id,
              receiverId: approver.id,
              senderId: user.id,
              type: 'LoanRequestApproval',
            },
            include: { loanRequest: true },
          });

          await this.eventsGateway.sendNotificationToUser(
            approver.id,
            appNotification,
            prisma,
          );

          if (request) {
            await this.finaliseSerialNumber.markSerialNumber(
              createRequestDto.requestNumber,
              companyId,
            );
          }

          return {
            status: 'Success',
            message: 'Request successfully created',
            data: request,
          };
        },
        { isolationLevel: 'Serializable', timeout: 60000 },
      );
    } catch (error) {
      this.logger.error(error);
      if (error.code === 'P2034') {
        throw new HttpException(
          'Duplicate transaction, try again later',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async approveLoanRequest(
    userId: number,
    requestId: number,
    updateLoanRequestDto: UpdateLoanRequestDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the request exists.
      const existingRequest = await this.prismaService.loanRequest.findUnique({
        where: { id: requestId, companyId },
      });

      if (!existingRequest) {
        throw new HttpException(
          `Request with id number ${requestId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (existingRequest.status === RequestState.CLOSED) {
        throw new HttpException(
          `Loan request already completed`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (existingRequest.status === RequestState.APPROVED) {
        throw new HttpException(
          `Loan request already approved`,
          HttpStatus.NOT_FOUND,
        );
      }

      const getNotification =
        await this.prismaService.approvalNotifications.findFirst({
          where: {
            approverId: userId,
            companyId,
            loanRequestId: existingRequest.id,
          },
        });

      if (!getNotification) {
        throw new HttpException('No notification found', HttpStatus.NOT_FOUND);
      }

      const requestedUser = await this.prismaService.user.findUnique({
        where: { id: getNotification.userId, companyId },
      });

      // Begin transaction
      return await this.prismaService.$transaction(
        async (prisma) => {
          const updatedRequest = await prisma.loanRequest.update({
            where: { id: requestId, companyId },
            data: {
              status: updateLoanRequestDto.status,
            },
          });

          if (updateLoanRequestDto.status === RequestState.APPROVED) {
            // Deduct from inventory
            await this.updateStock(
              existingRequest.itemDetails,
              existingRequest.companyId,
              existingRequest,
              prisma,
            );

            await prisma.approvalNotifications.update({
              where: { id: getNotification.id },
              data: {
                message: `Request with serial number: ${updatedRequest.requestNumber} has been approved.`,
                companyId,
                comment: null,
                read: false,
                userId: requestedUser.id,
                approverId: user.id,
                loanRequestId: existingRequest.id,
                notifierId: requestedUser.id,
                type: 'ApprovedLoanRequest',
              },
              include: { loanRequest: true },
            });

            const appNotification = await prisma.inAppNotifications.create({
              data: {
                message: `Request with serial number: ${updatedRequest.requestNumber} has been approved.`,
                companyId,
                loanRequestId: existingRequest.id,
                receiverId: requestedUser.id,
                senderId: user.id,
                type: 'ApprovedLoanRequest',
              },
              include: { loanRequest: true },
            });

            await this.eventsGateway.sendNotificationToUser(
              requestedUser.id,
              appNotification,
              prisma,
            );
          } else if (updateLoanRequestDto.status === RequestState.REJECT) {
            await prisma.approvalNotifications.update({
              where: {
                id: getNotification.id,
                companyId,
              },
              data: {
                message: `Request with serial number: ${updatedRequest.requestNumber} was rejected`,
                comment: updateLoanRequestDto.comment,
                companyId,
                userId: requestedUser.id,
                approverId: user.id,
                loanRequestId: existingRequest.id,
                notifierId: requestedUser.id,
                read: false,
                type: 'RejectedLoanRequest',
              },
              include: { loanRequest: true },
            });

            const appNotification = await prisma.inAppNotifications.create({
              data: {
                message: `Request with serial number: ${updatedRequest.requestNumber} was rejected.`,
                companyId,
                loanRequestId: existingRequest.id,
                receiverId: requestedUser.id,
                senderId: user.id,
                type: 'RejectedLoanRequest',
              },
              include: { loanRequest: true },
            });

            await this.eventsGateway.sendNotificationToUser(
              requestedUser.id,
              appNotification,
              prisma,
            );
          }

          return {
            status: 'Success',
            data: updatedRequest,
          };
        },
        { isolationLevel: 'Serializable', timeout: 60000 },
      );
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async updateStock(
    itemDetails: any,
    companyId: number,
    request: LoanRequest,
    prisma: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      let loopCount = 0;

      await Promise.all(
        itemDetails.map(async (item) => {
          loopCount++;

          const product = await prisma.product.findUnique({
            where: { id: Number(item.productId), companyId },
            include: {
              stocks: {
                where: { warehouseName: item.warehouseName },
                include: { warehouses: true },
                orderBy: { createdAt: 'asc' },
              },
            },
          });

          // Track remaining quantity needed
          let remainingQuantity = Number(item.qtyTransfer);

          // Calculate unit selling price (amount / quantity)
          const unitSellingPrice =
            Number(item.amount) / Number(item.qtyTransfer);

          for (const stock of product.stocks) {
            const costPrice = stock?.purchase
              ? parseFloat(
                  (stock.purchase as PurchaseDetails)?.costPrice || '0',
                )
              : parseFloat(
                  (product?.purchase as PurchaseDetails)?.pricePerPcs || '0',
                );

            // Check if there's enough quantity in the current batch
            if (remainingQuantity > 0 && Number(stock.openingStock) > 0) {
              const quantityToDeduct = Math.min(
                remainingQuantity,
                Number(stock.openingStock),
              );

              // Calculate selling price for the specific batch
              let batchSellingPrice = unitSellingPrice * quantityToDeduct;

              // Round the batch selling price to two decimal places
              batchSellingPrice = Math.round(batchSellingPrice * 100) / 100;

              // Update stock in the database
              const c = await prisma.stock.update({
                where: { id: stock.id },
                data: {
                  openingStock: String(
                    Number(stock.openingStock) - quantityToDeduct,
                  ),
                  committedQuantity:
                    Number(stock.committedQuantity) + quantityToDeduct,
                },
              });
              //console.log(c);
              // Update remaining quantity needed
              remainingQuantity -= quantityToDeduct;

              const specificWarehouse = stock.warehouses.find(
                (warehouse) => warehouse.name === item.warehouseName,
              );
              const warehouseId = specificWarehouse?.id;

              await prisma.batchLog.create({
                data: {
                  productId: product.id,
                  batchId: stock.id,
                  batchNumber: stock.batchNumber,
                  quantity: quantityToDeduct,
                  sellingPrice: batchSellingPrice,
                  costPrice:
                    item.unit === 'PKT'
                      ? costPrice * Number(product.qtyPKT)
                      : costPrice,
                  costPriceInPKT:
                    item.unit === 'PKT'
                      ? costPrice * Number(product.qtyPKT)
                      : null,
                  costPriceInPCS: costPrice,
                  status: 'PENDING',
                  amount: batchSellingPrice,
                  productName: product.name,
                  warehouseName: stock.warehouseName,
                  warehouseId: warehouseId,
                  customerId: request.customerId,
                  loanRequestId: request.id,
                  supplierId: product.supplierId,
                  companyId,
                },
              });

              if (remainingQuantity === 0) {
                break;
              }
            }
          }

          if (remainingQuantity > 0) {
            throw new HttpException(
              `Insufficient quantity for product ${product.name}`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }),
      );

      console.log(`Total items processed: ${loopCount}`);
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating stock',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getLoanRequests(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<LoanRequest>> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const requests = await paginate(
        this.prismaService.loanRequest,
        paginationDto,
        {
          where: {
            companyId,
          },
          include: {
            wareHouse: { where: { companyId } },
            customer: { where: { companyId } },
            products: { where: { companyId } },
            invoice: { where: { companyId } },
          },
          orderBy: { createdAt: 'desc' },
        },
      );
      return {
        status: 'Success',
        message: 'Requests retrieved successfully',
        data: requests.data as LoanRequest[],
        totalItems: requests.totalItems,
        currentPage: requests.currentPage,
        totalPages: requests.totalPages,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getLoanRequestByID(
    userId: number,
    id: number,
  ): Promise<GetResponse<LoanRequest>> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const request = await this.prismaService.loanRequest.findUnique({
        where: { id, companyId },
        include: {
          wareHouse: { where: { companyId } },
          customer: { where: { companyId } },
          products: { where: { companyId } },
          invoice: { where: { companyId } },
        },
      });

      if (!request) {
        throw new HttpException('Request not found', HttpStatus.NOT_FOUND);
      }

      return {
        status: 'Success',
        data: request,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async LoanReturn(
    userId: number,
    requestId: number,
    returnLoanDto: ReturnLoanDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const request = await this.prismaService.loanRequest.findUnique({
        where: { id: requestId, companyId },
      });

      if (!request) {
        throw new HttpException('Loan request not found', HttpStatus.NOT_FOUND);
      }

      if (request.status === RequestState.RETURNED) {
        throw new HttpException(
          'Loan completely returned',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (request.status === RequestState.PENDING) {
        throw new HttpException(
          'Loan request not approved',
          HttpStatus.BAD_REQUEST,
        );
      }

      await Promise.all(
        returnLoanDto.itemDetails.map(async (item) => {
          const product = await this.prismaService.product.findUnique({
            where: { id: Number(item.productId) },
            include: { stocks: true },
          });

          if (!product) {
            throw new HttpException(
              `Invalid product ID: ${item.productId}`,
              HttpStatus.NOT_FOUND,
            );
          }

          const requestDetails: {
            productId: number;
            warehouseName: string;
          }[] = request.itemDetails as {
            productId: number;
            warehouseName: string;
          }[];

          // Find the corresponding loan item in requestDetails
          const loanItem = requestDetails.find(
            (loanItem) => loanItem.productId === item.productId,
          );

          if (!loanItem) {
            throw new HttpException(
              `Product not part of the loan request: ${item.productName}`,
              HttpStatus.BAD_REQUEST,
            );
          }

          // Find the stock by warehouseName from loanItem
          let stock = product.stocks.find(
            (stock) => stock.warehouseName === loanItem.warehouseName.trim(),
          );

          if (!stock) {
            throw new HttpException(
              `Stock not found for product: ${item.productName}`,
              HttpStatus.NOT_FOUND,
            );
          }
        }),
      );

      const transactionResult = await this.prismaService.$transaction(
        async (prisma) => {
          const loanReturn = await prisma.loanReturn.create({
            data: {
              companyId,
              loanId: requestId,
              customerId: request.customerId,
              warehouseId: request.warehouseId,
              note: returnLoanDto.note,
              product: {
                connect: returnLoanDto?.itemDetails.map((p) => ({
                  id: Number(p.productId),
                })),
              },
              itemDetails: returnLoanDto.itemDetails.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                qtyTransfer: item.qtyTransfer,
                qtyReturned: item.qtyReturned,
                balanceQty: item.balanceQty,
                qtyToBeReturned: item.balanceQty,
                amount: item.amount,
              })),
            },
          });

          await this.returnLoan(
            returnLoanDto.itemDetails,
            loanReturn.id,
            requestId,
            companyId,
            prisma,
          );

          return {
            status: 'Loan Successfully returned',
            data: loanReturn,
          };
        },
        { timeout: 5000, isolationLevel: 'Serializable' },
      );

      return transactionResult;
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async returnLoan(
    itemDetails: any,
    loanReturnId: number,
    requestId: number,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ): Promise<any> {
    try {
      let loopCount = 0;

      const request = await prisma.loanRequest.findUnique({
        where: { id: requestId, companyId },
      });

      if (!request) {
        throw new HttpException('Loan request not found', HttpStatus.NOT_FOUND);
      }

      const loanReturn = await prisma.loanReturn.findUnique({
        where: { id: loanReturnId, companyId },
      });

      if (!loanReturn) {
        throw new HttpException('Loan return not found', HttpStatus.NOT_FOUND);
      }

      const requestDetails: {
        rate: number;
        amount: number;
        quantity: number;
        productId: number;
        productName: string;
        warehouseName: string;
        qtyReturned: number;
        qtyTransfer: number;
        balanceQty: number;
        qtyToBeReturned: number;
      }[] = request.itemDetails as any;

      const returnDetails: {
        qtyReturned: number;
        balanceQty: number;
        qtyToBeReturned: number;
        productId: number;
        amount: number;
      }[] = loanReturn.itemDetails as any;

      // Process each item in the return.
      await Promise.all(
        itemDetails.map(async (item) => {
          loopCount++;
          console.info(`\nProcessing item ${loopCount}:`, item.productName);

          const product = await prisma.product.findUnique({
            where: { id: Number(item.productId) },
            include: {
              stocks: {
                where: {
                  warehouseName: item.warehouseName.trim(),
                  OR: [
                    { committedQuantity: { gt: 0 } },
                    { openingStock: { gt: '0' } },
                  ],
                },
                orderBy: { createdAt: 'asc' },
              },
            },
          });

          if (!product) {
            this.logger.error(`Product not found: ${item.productId}`);
            throw new HttpException(
              `Invalid product ID: ${item.productId}`,
              HttpStatus.NOT_FOUND,
            );
          }

          this.logger.warn(
            `Found ${product.stocks.length} valid stocks for ${item.productName}`,
          );
          console.log(
            'Available stocks:',
            JSON.stringify(
              product.stocks.map((s) => ({
                id: s.id,
                openingStock: s.openingStock,
                committedQuantity: s.committedQuantity,
                batchNumber: s.batchNumber,
              })),
              null,
              2,
            ),
          );

          if (product.stocks.length === 0) {
            this.logger.error(`No valid stocks found for ${item.productName}`);
            throw new HttpException(
              `No valid stocks found for product: ${item.productName}`,
              HttpStatus.NOT_FOUND,
            );
          }

          const loanItem = requestDetails.find(
            (loanItem) => loanItem.productId === item.productId,
          );

          const returnItem = returnDetails.find(
            (ri) => ri.productId === item.productId,
          );

          if (!loanItem || !returnItem) {
            this.logger.error(
              `Product ${item.productName} not found in loan request`,
            );
            throw new HttpException(
              'Product not part of the loan request',
              HttpStatus.BAD_REQUEST,
            );
          }

          this.logger.verbose('Found loan item details:', {
            productName: item.productName,
            qtyTransfer: loanItem.qtyTransfer,
            qtyReturned: loanItem.qtyReturned,
            qtyToBeReturned: loanItem.qtyToBeReturned,
          });

          if (item.qtyReturned > loanItem.qtyToBeReturned) {
            this.logger.error(
              `Return quantity (${item.qtyReturned}) exceeds remaining quantity (${loanItem.qtyToBeReturned})`,
            );
            throw new HttpException(
              `Cannot return more than borrowed for product: ${item.productName}`,
              HttpStatus.BAD_REQUEST,
            );
          }

          let remainingQtyToReturn = Number(item.qtyReturned);
          this.logger.log(
            `\nProcessing return of ${remainingQtyToReturn} units for ${item.productName}`,
          );

          // Process each stock in FIFO order
          for (const stock of product.stocks) {
            this.logger.log('Current stock state:', {
              openingStock: stock.openingStock,
              committedQuantity: stock.committedQuantity,
            });

            if (remainingQtyToReturn <= 0) {
              this.logger.warn(
                'No more quantity to return, breaking stock loop',
              );
              break;
            }

            const qtyToReturnFromThisStock = Math.min(
              remainingQtyToReturn,
              stock.committedQuantity,
            );

            this.logger.warn(
              'Quantity to return from this stock:',
              qtyToReturnFromThisStock,
            );

            if (qtyToReturnFromThisStock > 0) {
              const newOpeningStock = String(
                Number(stock.openingStock) + qtyToReturnFromThisStock,
              );
              const newCommittedQty =
                stock.committedQuantity - qtyToReturnFromThisStock;

              this.logger.verbose('Updating stock with:', {
                newOpeningStock,
                newCommittedQty,
              });

              // Update the stock
              const updatedStock = await prisma.stock.update({
                where: { id: stock.id },
                data: {
                  openingStock: newOpeningStock,
                  committedQuantity: newCommittedQty,
                },
              });

              this.logger.debug('Stock updated:', {
                id: updatedStock.id,
                openingStock: updatedStock.openingStock,
                committedQuantity: updatedStock.committedQuantity,
              });

              remainingQtyToReturn -= qtyToReturnFromThisStock;
              this.logger.warn(
                'Remaining quantity to return:',
                remainingQtyToReturn,
              );
            } else {
              this.logger.error('No quantity can be returned from this stock');
            }
          }

          // Update the loan item details
          const oldQtyReturned = loanItem.qtyReturned;
          loanItem.qtyReturned += Number(item.qtyReturned);
          loanItem.balanceQty = loanItem.qtyTransfer - loanItem.qtyReturned;
          loanItem.qtyToBeReturned -= Number(item.qtyReturned);
          loanItem.amount = Number(item.amount);

          const price = requestDetails.reduce(
            (acc, curr) => acc + Number(curr.amount),
            0,
          );

          // Update the return item details
          returnItem.balanceQty = loanItem.balanceQty;
          returnItem.qtyToBeReturned = loanItem.qtyToBeReturned;
          returnItem.qtyReturned = loanItem.qtyReturned;
          returnItem.amount = Number(item.amount);

          this.logger.warn('Updating loan item:', {
            productName: item.productName,
            oldQtyReturned,
            newQtyReturned: loanItem.qtyReturned,
            newBalanceQty: loanItem.balanceQty,
            newQtyToBeReturned: loanItem.qtyToBeReturned,
          });

          // Update the loan request
          const updatedLoan = await prisma.loanRequest.update({
            where: { id: requestId },
            data: {
              price: String(price),
              itemDetails: requestDetails.map((i) =>
                i.productId === Number(item.productId) ? loanItem : i,
              ),
            },
          });

          // Update the loan request
          const updatedLoanReturn = await prisma.loanReturn.update({
            where: { id: loanReturnId },
            data: {
              itemDetails: returnDetails.map((i) =>
                i.productId === Number(item.productId) ? returnItem : i,
              ),
            },
          });

          this.logger.verbose('Loan request updated successfully');
        }),
      );

      // Check if all items have been returned
      const allReturned = requestDetails.every(
        (item) => item.qtyReturned === item.qtyTransfer,
      );

      this.logger.warn('\nFinal status check:', {
        allItemsReturned: allReturned,
        totalItemsProcessed: loopCount,
      });

      const updatedStatus = allReturned
        ? RequestState.RETURNED
        : RequestState.PART_RETURNED;

      const finalUpdate = await prisma.loanRequest.update({
        where: { id: requestId },
        data: { status: updatedStatus },
      });

      this.logger.log('Final loan status:', finalUpdate.status);

      return {
        status: 'Success',
        message: allReturned
          ? 'All items have been returned'
          : 'Partial return completed',
      };
    } catch (error) {
      console.error('Error in returnLoan:', error);
      this.logger.error(error);
      throw error;
    }
  }

  async getReturnLoans(
    userId: number,
    loanId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<LoanReturn>> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      await this.getLoanRequestByID(user.id, loanId);

      const { page, limit } = paginationDto;
      const skip = page ? (page - 1) * limit : 0;
      const take = limit || 10;

      const returns = await this.prismaService.loanReturn.findMany({
        where: {
          loanId,
          companyId,
        },
        skip,
        take,
        select: {
          id: true,
          note: true,
          createdAt: true,
          itemDetails: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Get total count for pagination
      const totalItems = await this.prismaService.loanReturn.count({
        where: {
          companyId,
        },
      });

      const totalPages = limit ? Math.ceil(totalItems / limit) : 1;
      const currentPage = page || 1;

      return {
        status: 'Success',
        message: 'Requests retrieved successfully',
        data: returns as LoanReturn[],
        totalItems,
        currentPage,
        totalPages,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }
}
