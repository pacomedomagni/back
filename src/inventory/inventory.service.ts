import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AdjustInventoryDto,
  DebtorsReport,
  ProductInfo,
  ProductMetric,
} from './dto/adjust-inventory.dto';
import {
  MailService,
  PrismaService,
  finaliseSerialNumber,
  paginate,
} from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import {
  AdjustmentType,
  BatchLog,
  PaymentMode,
  PaymentStatus,
  Prisma,
  RequestState,
  RequestType,
  StockRequest,
} from '@prisma/client';
import { TransferDto } from './dto/warehouse-transfer.dto';
import { UpdateRequestDto } from './dto/update-warehouse-transfer.dto';
import { DateTime } from 'luxon';
import { EventsGateway } from 'src/events/events.gateway';
import { PaginationDto } from 'src/common/dto';
import { GetAllResponse } from 'src/common/interface';
import { PurchaseDetails } from 'src/orders/dto/create-sales-order.dto';
//import { zeroStocks } from 'src/common/utils/zeroStocks';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersservice: UsersService,
    private readonly mailService: MailService,
    private readonly logger: Logger,
    private readonly eventsGateway: EventsGateway,
    //private readonly zeroStocks: zeroStocks,
    private readonly finaliseSerialNumber: finaliseSerialNumber,
  ) {}

  async createAdjustInventory(
    userId: number,
    adjustInventoryDto: AdjustInventoryDto,
  ) {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const warehouse = await this.validateWarehouse(
        adjustInventoryDto,
        companyId,
      );

      const adjustedInventory = await this.prismaService.$transaction(
        async (prisma) => {
          const adjustedInventory = await this.adjustInventory(
            companyId,
            user.primaryContactName,
            adjustInventoryDto,
            warehouse,
            prisma,
          );

          return adjustedInventory;
        },
        { isolationLevel: 'Serializable', timeout: 60000 },
      );

      const successMessage =
        adjustInventoryDto.type === AdjustmentType.QUANTITY
          ? 'Quantity successfully adjusted'
          : 'Value successfully adjusted';

      return {
        status: 'Success',
        message: successMessage,
        data: adjustedInventory,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'Internal Server Error',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async validateWarehouse(
    adjustInventoryDto: AdjustInventoryDto,
    companyId: number,
  ) {
    if (adjustInventoryDto.type === AdjustmentType.QUANTITY) {
      const warehouse = await this.prismaService.wareHouse.findUnique({
        where: {
          id: adjustInventoryDto.warehouseId,
          name: adjustInventoryDto.warehouseName,
          companyId,
        },
      });

      if (!warehouse) {
        throw new HttpException('Warehouse not found', HttpStatus.NOT_FOUND);
      }

      return warehouse;
    }
  }

  private async adjustInventory(
    companyId: number,
    adjustedBy: string,
    adjustInventoryDto: AdjustInventoryDto,
    warehouse: any,
    prisma: Prisma.TransactionClient,
  ) {
    const itemDetails = this.mapItemDetails(adjustInventoryDto);

    const adjustedInventory = await prisma.adjustInventory.create({
      data: {
        companyId,
        adjustedBy,
        type: adjustInventoryDto.type,
        dateAdjusted: adjustInventoryDto.dateAdjusted,
        reason: adjustInventoryDto.reason,
        description: adjustInventoryDto.description,
        account: adjustInventoryDto.account,
        wareHouse: warehouse.name,
        itemDetails,
        product: {
          connect: itemDetails.map((p) => ({
            id: Number(p.productId),
          })),
        },
      },
    });

    const changeType = await this.updateInventory(
      itemDetails,
      adjustInventoryDto.type,
      companyId,
      prisma,
    );
    return { ...adjustedInventory, changeType };
  }

  private mapItemDetails(adjustInventoryDto: AdjustInventoryDto) {
    const uniqueProducts = new Set();
    return adjustInventoryDto.itemDetails.map((item) => {
      if (uniqueProducts.has(item.productId)) {
        throw new HttpException(
          `Duplicate product Details: ${item.productName}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      uniqueProducts.add(item.productId);
      const {
        productId,
        qtyAvailable,
        qtyOnHand,
        qtyAdjusted,
        purchasePrice,
        costPrice,
        itemName,
        currentValue,
        valueAdjusted,
        warehouseName,
        stockId,
      } = item;
      return adjustInventoryDto.type === AdjustmentType.QUANTITY
        ? {
            productId,
            qtyAvailable,
            qtyOnHand,
            qtyAdjusted,
            purchasePrice,
            costPrice,
            itemName,
            warehouseName,
            stockId,
          }
        : {
            productId,
            currentValue: currentValue,
            changedValue: qtyAdjusted,
            valueAdjusted: valueAdjusted,
            itemName,
            stockId,
          };
    });
  }

  private async updateInventory(
    itemDetails: any,
    type: AdjustmentType,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    try {
      const productIds = itemDetails.map((item) => item.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: { stocks: true },
      });

      let changeType;
      for (const item of itemDetails) {
        const product = products.find((p) => p.id === item.productId);

        if (!product) {
          throw new Error(`Product not found for ID ${item.productId}`);
        }

        if (type === AdjustmentType.QUANTITY) {
          changeType = await this.adjustQuantity(
            product,
            item,
            companyId,
            prisma,
          );
        }

        // Logic for value adjustment (if needed)
      }
      return { changeType };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating inventory',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async adjustQuantity(
    product: any,
    item: any,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    // Find the stock for the given warehouse

    const stock = product.stocks.find(
      (s) =>
        s.id === Number(item.stockId) && s.warehouseName === item.warehouseName,
    );
    if (!stock) {
      throw new Error(
        `Stock not found for product ${product.name} and warehouse ${item.warehouseName}`,
      );
    }

    const updatedQuantity = Number(item.qtyOnHand);
    const previousQuantity = Number(stock.openingStock);

    // Calculate the change in stock
    const changeInStock = updatedQuantity - previousQuantity;

    // Determine the type of change (increase or decrease)
    const changeType = changeInStock > 0 ? 'increase' : 'decrease';

    // Update the opening stock with the new quantity
    await this.updateStockOpeningQuantity(stock.id, updatedQuantity, prisma);

    // Adjust the total stock based on the change in stock level
    const totalStock = this.calculateTotalStock(
      product.totalStock,
      changeType,
      Math.abs(changeInStock),
    );

    // Update the product with the adjusted total stock
    await this.updateProductTotalStock(product.id, totalStock, prisma);

    // Delete zero stocks after updating the stock quantities
    // if (Number(stock.openingStock) === 0) {
    //   await this.zeroStocks.delete(prisma, companyId);
    // }

    return {
      changeInStock,
      changeType,
      updatedQuantity,
      previousQuantity,
      initialStockQty: product.totalStock,
      finalStockQty: totalStock,
    };
  }

  private async updateStockOpeningQuantity(
    stockId: number,
    updatedQuantity: number,
    prisma: Prisma.TransactionClient,
  ) {
    await prisma.stock.update({
      where: { id: stockId },
      data: { openingStock: String(updatedQuantity) },
    });
  }

  private calculateTotalStock(
    previousTotalStock: number,
    changeType: string,
    changeInStock: number,
  ) {
    if (changeType === 'increase') {
      return previousTotalStock + changeInStock;
    } else {
      return Math.max(previousTotalStock - changeInStock, 0);
    }
  }

  private async updateProductTotalStock(
    productId: number,
    totalStock: number,
    prisma: Prisma.TransactionClient,
  ) {
    await prisma.product.update({
      where: { id: productId },
      data: { totalStock },
    });
  }

  async getAdjustInventoryById(userId: number, id: number) {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const inventory = await this.prismaService.adjustInventory.findUnique({
        where: { id, companyId },
        include: {
          product: { where: { companyId } },
        },
      });

      if (!inventory) {
        throw new HttpException('Inventory not found', HttpStatus.NOT_FOUND);
      }

      return {
        status: 'Success',
        data: inventory,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'Error retrieving AdjustInventory',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getAdjustInventory(userId: number) {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const inventory = await this.prismaService.adjustInventory.findMany({
        where: { companyId },
        include: {
          product: { where: { companyId } },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!inventory) {
        throw new HttpException('Inventory not found', HttpStatus.NOT_FOUND);
      }

      return {
        status: 'Success',
        data: inventory,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'Error retrieving AdjustInventory',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async transferRequest(
    userId: number,
    transferDto: TransferDto,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const requestExist = await this.prismaService.stockRequest.findFirst({
        where: { requestNumber: transferDto.requestNumber, companyId },
      });

      if (requestExist) {
        throw new HttpException(
          `Request with serial number ${transferDto.requestNumber} already exist`,
          HttpStatus.NOT_FOUND,
        );
      }

      const uniqueProducts = new Set();
      await Promise.all(
        transferDto.itemDetails.map(async (item) => {
          if (uniqueProducts.has(item.productId)) {
            throw new HttpException(
              `Duplicate product Details: ${item.productName}`,
              HttpStatus.BAD_REQUEST,
            );
          }
          uniqueProducts.add(item.productId);
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

          const stock = product.stocks.find(
            (stock) => stock.warehouseName === item.warehouseName,
          );

          if (!stock) {
            throw new Error(
              `Stock not found for product ${product.name} and warehouse ${item.warehouseName}`,
            );
          }
          const sendingWarehouse =
            await this.prismaService.wareHouse.findUnique({
              where: { id: transferDto.sendingWarehouseId, companyId },
              include: { stocks: true },
            });

          const receivingWarehouse =
            await this.prismaService.wareHouse.findUnique({
              where: { id: transferDto.receivingWarehouseId, companyId },
              include: { stocks: true },
            });

          if (!sendingWarehouse || !receivingWarehouse) {
            throw new HttpException(
              'Sending or receiving warehouse not found',
              HttpStatus.NOT_FOUND,
            );
          }

          const sendingStock = await this.prismaService.stock.findUnique({
            where: { id: Number(item.sendingStockId) },
          });

          if (!sendingStock) {
            throw new HttpException('Stock not found', HttpStatus.BAD_REQUEST);
          }

          if (Number(sendingStock.openingStock) < Number(item.qtyTransferred)) {
            throw new HttpException(
              `Insufficient quantity for product with name ${item.itemName} in the sending stock`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }),
      );

      const approver = await this.prismaService.user.findUnique({
        where: { id: transferDto.approverId, companyId },
      });

      if (!approver) {
        throw new HttpException(
          'Assigned approver not found',
          HttpStatus.NOT_FOUND,
        );
      }

      const request = await this.prismaService.stockRequest.create({
        data: {
          requestNumber: transferDto.requestNumber,
          dateInitiated: transferDto.dateInitiated,
          sendingWarehouseId: transferDto.sendingWarehouseId,
          receivingWarehouseId: transferDto.receivingWarehouseId,
          sendingWarehouseName: transferDto.sendingWarehouseName,
          receivingWarehouseName: transferDto.receivingWarehouseName,
          requestedBy: user.primaryContactName,
          dueDate: transferDto.dueDate,
          approverName: transferDto.approverName,
          approverId: approver.id,
          companyId,
          itemDetails: transferDto?.itemDetails.map((item) => ({
            productId: item?.productId,
            productName: item.itemName,
            costPrice: item.costPrice,
            qtyTransferred: item.qtyTransferred,
            sendingStockId: item.sendingStockId,
            warehouseName: item.warehouseName,
            transferValue: item.transferValue,
          })),
        },
      });

      // Create notification
      const notification = await this.prismaService.systemNotifications.create({
        data: {
          message: `New request ${request.requestNumber} needs approval.`,
          companyId,
          userId: user.id,
          approverId: approver.id,
          stockRequestId: request.id,
          type: 'StockTransferApproval',
          receiverId: transferDto.approverId,
        },
        include: { stockRequest: true },
      });

      const appNotification =
        await this.prismaService.inAppNotifications.create({
          data: {
            message: `New request ${request.requestNumber} needs approval.`,
            companyId,
            stockRequestId: request.id,
            receiverId: approver.id,
            senderId: user.id,
            type: 'StockTransferApproval',
          },
          include: { stockRequest: true },
        });

      // Send notification
      this.eventsGateway.sendNotificationToUser(approver.id, appNotification);
      await this.mailService.transferNotifications(
        notification,
        approver,
        user,
        request,
      );

      if (request) {
        await this.finaliseSerialNumber.markSerialNumber(
          transferDto.requestNumber,
          companyId,
        );
      }
      return {
        status: 'Success',
        message: 'Request successfully created',
        data: request,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getStockRequest(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<StockRequest>> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const request = await paginate(
        this.prismaService.stockRequest,
        paginationDto,
        {
          where: { companyId },
          include: {
            sendingWarehouse: { where: { companyId } },
            receivingWarehouse: { where: { companyId } },
            //stockApprover: { where: { companyId } },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      );

      if (!request) {
        throw new HttpException(
          'Stock request not found',
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        status: 'Success',
        message: 'Stock requests retrieved successfully',
        data: request.data as StockRequest[],
        totalItems: request.totalItems,
        currentPage: request.currentPage,
        totalPages: request.totalPages,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'Error retrieving stock request',
          HttpStatus.BAD_REQUEST,
        );
      }
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

      const timestamps = DateTime.local().toMillis().toString(36);
      const prefix = warehouseName.slice(0, 3).toUpperCase();
      const formattedDate = DateTime.local().toFormat('yyyyLLdd');
      const concatenated = prefix + formattedDate.replace(/-/g, '');
      const timestamp = Date.now().toString(36);
      const randomString = Math.random().toString(36).substring(2, 8);
      // const batchNumber = `${concatenated}-${timestamp}-${randomString}`;

      const batchNumber = await this.usersservice.generateBatchNumber(
        concatenated,
        'batch',
        userId,
      );

      const existingStock = await this.prismaService.stock.findFirst({
        where: { batchNumber, companyId },
      });

      if (existingStock) {
        console.log(
          `Existing stock found for batch number ${batchNumber}, ${existingStock}. Generating a new batch number.`,
        );
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

  async updateStockApprovalRequest(
    userId: number,
    requestId: number,
    updateRequestDto: UpdateRequestDto,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const existingRequest = await this.prismaService.stockRequest.findUnique({
        where: { id: requestId, companyId },
      });

      if (!existingRequest) {
        throw new HttpException(
          `Request with id number ${requestId} does not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const getNotification =
        await this.prismaService.systemNotifications.findFirst({
          where: {
            approverId: userId,
            companyId,
            stockRequestId: existingRequest.id,
          },
        });

      if (!getNotification) {
        throw new HttpException('No notification found', HttpStatus.NOT_FOUND);
      }

      const requestedUser = await this.prismaService.user.findUnique({
        where: { id: getNotification.userId, companyId },
      });

      // Save the updated request
      const updatedRequest = await this.prismaService.stockRequest.update({
        where: { id: requestId, companyId },
        data: {
          status: updateRequestDto.status,
          comment:
            updateRequestDto.status === RequestState.APPROVED
              ? null
              : updateRequestDto.status === RequestState.REJECT
                ? updateRequestDto.comment
                : null,
        },
      });

      if (updateRequestDto.status === RequestState.APPROVED) {
        const notification =
          await this.prismaService.systemNotifications.update({
            where: { id: getNotification.id },
            data: {
              message: `Request with serial number: ${updatedRequest.requestNumber} has been approved.`,
              companyId,
              comment: null,
              read: false,
              userId: requestedUser.id,
              approverId: user.id,
              type: 'ApprovedStockTransfer',
              stockRequestId: existingRequest.id,
              receiverId: requestedUser.id,
            },
            include: { stockRequest: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Request with serial number: ${updatedRequest.requestNumber} has been approved.`,
              companyId,
              stockRequestId: existingRequest.id,
              receiverId: requestedUser.id,
              senderId: user.id,
              type: 'ApprovedStockTransfer',
            },
            include: { stockRequest: true },
          });

        this.eventsGateway.sendNotificationToUser(
          requestedUser.id,
          appNotification,
        );
        await this.mailService.stockRequestApprovalNotifications(
          notification,
          requestedUser,
          user,
          updatedRequest,
        );
      } else if (updateRequestDto.status === RequestState.REJECT) {
        const notification =
          await this.prismaService.systemNotifications.update({
            where: {
              id: getNotification.id,
              companyId,
            },
            data: {
              message: `Request with serial number: ${updatedRequest.requestNumber} was rejected.`,
              comment: updateRequestDto.comment,
              companyId,
              userId: requestedUser.id,
              approverId: user.id,
              type: 'RejectedStockTransfer',
              stockRequestId: existingRequest.id,
              receiverId: requestedUser.id,
              read: false,
            },
            include: { stockRequest: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Request with serial number: ${updatedRequest.requestNumber} was rejected.`,
              companyId,
              stockRequestId: existingRequest.id,
              receiverId: requestedUser.id,
              senderId: user.id,
              type: 'RejectedStockTransfer',
            },
            include: { stockRequest: true },
          });

        this.eventsGateway.sendNotificationToUser(
          requestedUser.id,
          appNotification,
        );
        await this.mailService.stockRequestRejectionNotifications(
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

  async getRequestByREQ(userId: number, requestNumber: string): Promise<any> {
    try {
      // Check if the user exists with associated relationships
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const request = await this.prismaService.stockRequest.findFirst({
        where: { requestNumber: requestNumber, companyId },
        include: {
          sendingWarehouse: { where: { companyId } },
          receivingWarehouse: { where: { companyId } },
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

  async editStockRequest(
    userId: number,
    requestId: number,
    updateRequestDto: UpdateRequestDto,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the request exists
      const existingRequest = await this.prismaService.stockRequest.findUnique({
        where: { id: requestId, companyId },
      });

      if (!existingRequest) {
        throw new HttpException(
          `Request with id ${requestId} not found`,
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
      const updatedRequest = await this.prismaService.stockRequest.update({
        where: { id: requestId, companyId },
        data: {
          requestNumber: updateRequestDto.requestNumber,
          dateInitiated: updateRequestDto.dateInitiated,
          sendingWarehouseId: updateRequestDto.sendingWarehouseId,
          receivingWarehouseId: updateRequestDto.receivingWarehouseId,
          sendingWarehouseName: updateRequestDto.sendingWarehouseName,
          receivingWarehouseName: updateRequestDto.receivingWarehouseName,
          requestedBy: user.primaryContactName,
          dueDate: updateRequestDto.dueDate,
          approverName: updateRequestDto.approverName,
          status: RequestState.PENDING,
          approverId: approver.id,
          companyId,
          itemDetails: updateRequestDto?.itemDetails?.map((item) => ({
            productId: item?.productId,
            productName: item.itemName,
            costPrice: item.costPrice,
            sendingStockId: item.sendingStockId,
            qtyTransferred: item.qtyTransferred,
            warehouseName: item.warehouseName,
            transferValue: item.transferValue,
          })),
        },
      });

      let notification;
      notification = await this.prismaService.systemNotifications.findFirst({
        where: {
          approverId: approver.id,
          stockRequestId: updatedRequest.id,
        },
      });

      if (!notification) {
        notification = await this.prismaService.systemNotifications.create({
          data: {
            message: `Stock transfer request ${updatedRequest.requestNumber} needs approval.`,
            companyId,
            userId: user.id,
            approverId: approver.id,
            type: 'StockTransferApproval',
            stockRequestId: updatedRequest.id,
            receiverId: approver.id,
          },
          include: { stockRequest: true },
        });
      }

      const appNotification =
        await this.prismaService.inAppNotifications.create({
          data: {
            message: `Stock transfer request ${updatedRequest.requestNumber} needs approval.`,
            companyId,
            stockRequestId: updatedRequest.id,
            receiverId: approver.id,
            senderId: user.id,
            type: 'StockTransferApproval',
          },
          include: { stockRequest: true },
        });

      this.eventsGateway.sendNotificationToUser(approver.id, appNotification);
      await this.mailService.transferNotifications(
        notification,
        approver,
        user,
        updatedRequest,
      );

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

  async calculateInventoryMetrics(
    userId: number,
    startDate?: DateTime,
    endDate?: DateTime,
  ): Promise<any[]> {
    try {
      // Fetch user and company information
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      let startOfDay: Date;
      let endOfDay: Date;
      if (startDate && endDate) {
        startOfDay = startDate.startOf('day').toJSDate();
        endOfDay = endDate.endOf('day').toJSDate();
      }

      const salesData = await this.fetchSalesData(
        this.prismaService,
        companyId,
        startOfDay,
        endOfDay,
      );

      const restockData = await this.fetchRestockData(
        this.prismaService,
        companyId,
        startOfDay,
        endOfDay,
      );

      const stockData = await this.fetchStockData(
        this.prismaService,
        companyId,
        startOfDay,
        endOfDay,
      );

      // Initialize maps for sales and restocks
      const salesMap = this.createProductMap(salesData);
      const restockMap = this.createProductMap(restockData);

      // Calculate product metrics
      const productMetrics = this.calculateProductMetrics(
        stockData,
        salesMap,
        restockMap,
      );

      return Array.from(productMetrics.values());
    } catch (error) {
      this.handleErrors(error, this.logger);
    }
  }

  // Utility function for fetching sales data
  async fetchSalesData(prismaService, companyId, start, end) {
    return prismaService.salesTransaction.findMany({
      where: {
        companyId,
        createdAt: { gte: start, lt: end },
      },
      select: {
        productId: true,
        quantity: true,
        amount: true,
      },
    });
  }

  // Utility function for fetching restock data
  async fetchRestockData(prismaService, companyId, start, end) {
    return prismaService.purchasesTransaction.findMany({
      where: {
        companyId,
        createdAt: { gte: start, lt: end },
      },
      select: {
        productId: true,
        quantity: true,
        amount: true,
      },
    });
  }

  // Utility function for fetching stock data
  async fetchStockData(prismaService, companyId, start, end) {
    return prismaService.stock.findMany({
      where: {
        companyId,
        createdAt: { gte: start, lt: end },
      },
      select: {
        openingStock: true,
        committedQuantity: true,
        product: {
          select: { id: true, totalStock: true, name: true, purchase: true },
        },
        purchase: true,
      },
    });
  }

  createProductMap(
    data: { productId: number; quantity: number; amount: number }[],
  ): Map<number, ProductInfo> {
    const productMap = new Map<number, ProductInfo>();
    data.forEach((item) => {
      const { productId, quantity, amount } = item;

      if (!productMap.has(productId)) {
        productMap.set(productId, { quantity: 0, amount: 0 });
      }

      const productItem = productMap.get(productId);
      productItem.quantity += Number(quantity);
      productItem.amount += Number(amount);
    });

    return productMap;
  }

  calculateProductMetrics(
    stockData: any[],
    salesMap: Map<number, ProductInfo>,
    restockMap: Map<number, ProductInfo>,
  ): Map<number, ProductMetric> {
    const productMetrics = new Map<number, ProductMetric>();

    stockData.forEach((stock) => {
      const openingStock = Number(stock.openingStock || 0);
      const committedQuantity = Number(stock.committedQuantity || 0);
      const productList = stock.product || [];

      productList.forEach((product) => {
        const productId = product.id;
        const productName = product.name;
        const totalStock = Number(product.totalStock || 0);

        const totalSold = salesMap.has(productId)
          ? salesMap.get(productId).quantity
          : 0;

        const totalSalesAmount = salesMap.has(productId)
          ? salesMap.get(productId).amount
          : 0;

        const totalRestocked = restockMap.has(productId)
          ? restockMap.get(productId).quantity
          : 0;

        const totalRestockAmount = restockMap.has(productId)
          ? restockMap.get(productId).amount
          : 0;

        const quantityLeft = openingStock + committedQuantity;

        const costPrice = stock?.purchase
          ? parseFloat(stock?.purchase?.costPrice || '0')
          : parseFloat(product?.purchase?.pricePerPcs || '0');

        // const costPrice = parseFloat(stock.purchase?.costPrice || '0');

        const totalAmountUnsold = costPrice * quantityLeft;

        if (!productMetrics.has(productId)) {
          productMetrics.set(productId, {
            productName,
            totalSold,
            totalSalesAmount,
            totalPurchaseQuantity: totalRestocked,
            totalPurchaseAmount: totalRestockAmount,
            quantityLeft,
            totalAmountUnsold,
          });
        } else {
          const existingMetric = productMetrics.get(productId);
          existingMetric.quantityLeft += quantityLeft;
          existingMetric.totalAmountUnsold += totalAmountUnsold;
        }
      });
    });

    return productMetrics;
  }

  // Function to handle errors
  handleErrors(error, logger) {
    logger.error(error);
    if (error instanceof Prisma.PrismaClientValidationError) {
      throw new HttpException(
        'An error occurred while fetching report',
        HttpStatus.BAD_REQUEST,
      );
    }
    throw error;
  }

  async deleteStockRequest(userId: number, requestId: number) {
    try {
      // Check if the user exists with associated relationships
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const request = await this.prismaService.stockRequest.findUnique({
        where: { id: requestId, companyId },
        include: { sendingWarehouse: true, receivingWarehouse: true },
      });

      if (!request) {
        throw new HttpException(
          'Stock request not found',
          HttpStatus.NOT_FOUND,
        );
      }

      if (request.companyId !== companyId) {
        throw new HttpException(
          'You do not have permission to delete this product',
          HttpStatus.UNAUTHORIZED,
        );
      }

      await this.prismaService.stockRequest.delete({
        where: {
          id: request.id,
          companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Stock request deleted successfully',
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while deleting stock request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  // async debtorsMetrics(
  //   userId: number,
  //   startDate: DateTime,
  //   endDate: DateTime,
  // ): Promise<DebtorsReport> {
  //   try {
  //     const user = await this.usersservice.findUserWithRelationships(userId);
  //     const companyId =
  //       user.adminCompanyId?.adminID || user.employeeId?.companyId;

  //     const startOfDay = startDate.startOf('day');
  //     const endOfDay = endDate.endOf('day');

  //     // Query invoices within the specified date range and with specific payment statuses
  //     const invoices = await this.prismaService.invoice.findMany({
  //       where: {
  //         companyId,
  //         createdAt: {
  //           gte: startOfDay.toJSDate(),
  //           lt: endOfDay.toJSDate(),
  //         },
  //         OR: [
  //           { paymentStatus: PaymentStatus.PART },
  //           { paymentStatus: PaymentStatus.UNPAID },
  //         ],
  //       },
  //       select: {
  //         id: true,
  //         customerId: true,
  //         totalPrice: true,
  //       },
  //     });

  //     // Calculate total invoice amount for each customer
  //     const invoiceAmounts = invoices.reduce((acc, invoice) => {
  //       const customerId = invoice.customerId;
  //       const totalPrice = parseFloat(invoice.totalPrice.replace(/,/g, ''));
  //       acc[customerId] = (acc[customerId] || 0) + totalPrice;
  //       return acc;
  //     }, {});

  //     const payments = await this.prismaService.payment.findMany({
  //       where: {
  //         companyId,
  //         createdAt: {
  //           gte: startOfDay.toJSDate(),
  //           lt: endOfDay.toJSDate(),
  //         },
  //         OR: [
  //           { paymentMode: PaymentMode.CASH },
  //           { paymentMode: PaymentMode.TRANSFER },
  //         ],
  //       },
  //       select: {
  //         customerId: true,
  //         amountPaid: true,
  //       },
  //     });

  //     // Calculate total payment amount for each customer
  //     const paymentAmounts = payments.reduce((acc, payment) => {
  //       const customerId = payment.customerId;
  //       const amountPaid = parseFloat(payment.amountPaid.replace(/,/g, ''));
  //       acc[customerId] = (acc[customerId] || 0) + amountPaid;
  //       return acc;
  //     }, {});

  //     const validCustomerIds = Object.keys(invoiceAmounts).filter(
  //       (customerId) => customerId !== 'null',
  //     );

  //     // Construct debtor information for each customer
  //     const debtorsInfo = [];

  //     for (const customerId of validCustomerIds) {
  //       const customerIdNum = parseInt(customerId);
  //       const totalInvoiceAmount = invoiceAmounts[customerId];
  //       const totalPaymentAmount = paymentAmounts[customerIdNum] || 0;
  //       const balance = totalPaymentAmount - totalInvoiceAmount;

  //       // Fetch customer info only if customerId is not null
  //       const customerInfo = await this.prismaService.customer.findUnique({
  //         where: { id: customerIdNum },
  //         select: {
  //           id: true,
  //           companyName: true,
  //         },
  //       });

  //       if (!customerInfo) {
  //         throw new HttpException(`Customer not found`, HttpStatus.NOT_FOUND);
  //       }

  //       // Fetch invoices that the customer currently owes (unpaid or partially paid) within the specified date range
  //       const invoicesForCustomer = await this.prismaService.invoice.findMany({
  //         where: {
  //           customerId: customerIdNum,
  //           companyId,
  //           createdAt: {
  //             gte: startOfDay.toJSDate(),
  //             lt: endOfDay.toJSDate(),
  //           },
  //           OR: [
  //             { paymentStatus: PaymentStatus.PART },
  //             { paymentStatus: PaymentStatus.UNPAID },
  //           ],
  //         },
  //         select: {
  //           id: true,
  //           invoiceSN: true,
  //           salesPerson: true,
  //           createdAt: true,
  //         },
  //       });

  //       const customerInvoice = invoicesForCustomer.map(
  //         (invoice) => invoice.invoiceSN,
  //       );

  //       debtorsInfo.push({
  //         customerId: customerInfo.id,
  //         customerName: customerInfo.companyName,
  //         totalInvoiceAmount,
  //         totalPaymentAmount,
  //         balance,
  //         customerInvoice,
  //         salesPerson: invoicesForCustomer.map(
  //           (invoice) => invoice.salesPerson,
  //         ),
  //         createdAt: invoicesForCustomer.map((invoice) => invoice.createdAt),
  //       });
  //     }

  //     // Calculate total balance in the company
  //     let totalBalance: number = 0;
  //     for (const debtor of debtorsInfo) {
  //       totalBalance += debtor.balance;
  //     }

  //     // Calculate total payments made across all customers
  //     let totalPaymentsMade: number = 0;
  //     for (const debtor of debtorsInfo) {
  //       totalPaymentsMade += debtor.totalPaymentAmount;
  //     }

  //     return {
  //       status: true,
  //       message: 'Successfully fetched debtors info',
  //       debtorsInfo: debtorsInfo,
  //       totalBalance: totalBalance,
  //       totalPaymentsMade: totalPaymentsMade,
  //     };
  //   } catch (error) {
  //     this.logger.error(error);
  //     if (error instanceof Prisma.PrismaClientValidationError) {
  //       throw new HttpException(
  //         'An error occurred while fetching debtors report',
  //         HttpStatus.BAD_REQUEST,
  //       );
  //     }
  //     throw error;
  //   }
  // }

  async debtorsMetrics(
    userId: number,
    startDate?: DateTime,
    endDate?: DateTime,
  ): Promise<DebtorsReport> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Initialize the date filters only if both dates are provided
      let dateFilter: any = {};
      if (startDate && endDate) {
        const startOfDay = startDate.startOf('day');
        const endOfDay = endDate.endOf('day');
        dateFilter = {
          gte: startOfDay.toJSDate(),
          lt: endOfDay.toJSDate(),
        };
      }

      // Query invoices within the specified date range and with specific payment statuses
      const invoices = await this.prismaService.invoice.findMany({
        where: {
          companyId,
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
          OR: [
            { paymentStatus: PaymentStatus.PART },
            { paymentStatus: PaymentStatus.UNPAID },
          ],
        },
        select: {
          id: true,
          customerId: true,
          totalPrice: true,
        },
      });

      // Calculate total invoice amount for each customer
      const invoiceAmounts = invoices.reduce((acc, invoice) => {
        const customerId = invoice.customerId;
        const totalPrice = parseFloat(invoice.totalPrice.replace(/,/g, ''));
        acc[customerId] = (acc[customerId] || 0) + totalPrice;
        return acc;
      }, {});

      const payments = await this.prismaService.payment.findMany({
        where: {
          companyId,
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
          OR: [
            { paymentMode: PaymentMode.CASH },
            { paymentMode: PaymentMode.TRANSFER },
          ],
        },
        select: {
          customerId: true,
          amountPaid: true,
        },
      });

      // Calculate total payment amount for each customer
      const paymentAmounts = payments.reduce((acc, payment) => {
        const customerId = payment.customerId;
        const amountPaid = parseFloat(payment.amountPaid.replace(/,/g, ''));
        acc[customerId] = (acc[customerId] || 0) + amountPaid;
        return acc;
      }, {});

      const validCustomerIds = Object.keys(invoiceAmounts).filter(
        (customerId) => customerId !== 'null',
      );

      // Construct debtor information for each customer
      const debtorsInfo = [];

      for (const customerId of validCustomerIds) {
        const customerIdNum = parseInt(customerId);
        const totalInvoiceAmount = invoiceAmounts[customerId];
        const totalPaymentAmount = paymentAmounts[customerIdNum] || 0;
        const balance = totalPaymentAmount - totalInvoiceAmount;

        // Fetch customer info only if customerId is not null
        const customerInfo = await this.prismaService.customer.findUnique({
          where: { id: customerIdNum },
          select: {
            id: true,
            companyName: true,
          },
        });

        if (!customerInfo) {
          throw new HttpException(`Customer not found`, HttpStatus.NOT_FOUND);
        }

        // Fetch invoices that the customer currently owes (unpaid or partially paid) within the specified date range
        const invoicesForCustomer = await this.prismaService.invoice.findMany({
          where: {
            customerId: customerIdNum,
            companyId,
            ...(Object.keys(dateFilter).length > 0 && {
              createdAt: dateFilter,
            }),
            OR: [
              { paymentStatus: PaymentStatus.PART },
              { paymentStatus: PaymentStatus.UNPAID },
            ],
          },
          select: {
            id: true,
            invoiceSN: true,
            salesPerson: true,
            createdAt: true,
          },
        });

        const customerInvoice = invoicesForCustomer.map(
          (invoice) => invoice.invoiceSN,
        );

        debtorsInfo.push({
          customerId: customerInfo.id,
          customerName: customerInfo.companyName,
          totalInvoiceAmount,
          totalPaymentAmount,
          balance,
          customerInvoice,
          salesPerson: invoicesForCustomer.map(
            (invoice) => invoice.salesPerson,
          ),
          createdAt: invoicesForCustomer.map((invoice) => invoice.createdAt),
        });
      }

      // Calculate total balance in the company
      let totalBalance: number = 0;
      for (const debtor of debtorsInfo) {
        totalBalance += debtor.balance;
      }

      // Calculate total payments made across all customers
      let totalPaymentsMade: number = 0;
      for (const debtor of debtorsInfo) {
        totalPaymentsMade += debtor.totalPaymentAmount;
      }

      return {
        status: true,
        message: 'Successfully fetched debtors info',
        debtorsInfo: debtorsInfo,
        totalBalance: totalBalance,
        totalPaymentsMade: totalPaymentsMade,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching debtors report',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async stockConfirmation(
    userId: number,
    requestId: number,
    updateRequestDto: UpdateRequestDto,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      let request;
      await this.prismaService.$transaction(async (transaction) => {
        const existingRequest = await transaction.stockRequest.findUnique({
          where: { id: requestId, companyId },
        });

        if (!existingRequest) {
          throw new HttpException(
            `Invalid request serial number ${requestId} `,
            HttpStatus.BAD_REQUEST,
          );
        }

        this.logger.debug(existingRequest.status);
        if (existingRequest.status !== RequestState.APPROVED) {
          throw new HttpException(
            `Request not approved`,
            HttpStatus.BAD_REQUEST,
          );
        }

        await Promise.all(
          updateRequestDto.itemDetails.map(async (item) => {
            const product = await transaction.product.findUnique({
              where: { id: Number(item.productId) },
              include: { stocks: true },
            });

            if (!product) {
              throw new HttpException(
                `Invalid product ID: ${item.productId}`,
                HttpStatus.NOT_FOUND,
              );
            }
          }),
        );

        // Create the order confirmation
        request = await transaction.stockRequest.update({
          where: { id: requestId, companyId },
          data: {
            status: updateRequestDto.status,
            itemDetails: updateRequestDto?.itemDetails.map((item) => ({
              productId: item?.productId,
              productName: item.itemName,
              sendingStockId: item.sendingStockId,
              costPrice: item.costPrice,
              qtyTransferred: item.qtyTransferred,
              warehouseName: item.warehouseName,
              transferValue: item.transferValue,
              comment: item.comment,
              received: item.receive,
            })),
          },
        });

        if (request.status === RequestState.CONFIRM) {
          await this.updateTransfer(
            updateRequestDto.itemDetails,
            request,
            user.id,
            transaction,
          );
        }
      });

      //await this.zeroStocks.delete(this.prismaService, companyId);
      return {
        status: 'Stock Confirmation Successful',
        data: request,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating Stock confirmation',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async updateTransfer(
    itemDetails: any,
    request: StockRequest,
    userId: number,
    transaction: Prisma.TransactionClient,
  ) {
    try {
      let loopCount = 0;
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      let newStock;

      for (const item of itemDetails) {
        loopCount++;
        const product = await transaction.product.findUnique({
          where: { id: Number(item.productId) },
          include: { stocks: true },
        });

        if (!product) {
          throw new Error(`Product not found for ID ${item.productId}`);
        }

        const sendingWarehouse = await transaction.wareHouse.findUnique({
          where: { id: request.sendingWarehouseId, companyId },
          include: { stocks: true },
        });

        const receivingWarehouse = await transaction.wareHouse.findUnique({
          where: { id: request.receivingWarehouseId, companyId },
          include: { stocks: true },
        });

        if (!sendingWarehouse || !receivingWarehouse) {
          throw new HttpException(
            'Sending or receiving warehouse not found',
            HttpStatus.NOT_FOUND,
          );
        }

        const sendingWarehouseStock = product.stocks.find(
          (s) =>
            s.id === Number(item.sendingStockId) &&
            s.warehouseName === request.sendingWarehouseName,
        );

        if (!sendingWarehouseStock) {
          throw new HttpException(
            `Stock not found for product ${item.itemName} in the sending warehouse`,
            HttpStatus.BAD_REQUEST,
          );
        }

        if (
          Number(sendingWarehouseStock.openingStock) <
          Number(item.qtyTransferred)
        ) {
          throw new HttpException(
            `Insufficient quantity for product with name ${item.itemName} in the sending warehouse`,
            HttpStatus.BAD_REQUEST,
          );
        }

        // Update quantity in sending warehouse
        const updatedSendingStock: number =
          Number(sendingWarehouseStock.openingStock) -
          Number(item.qtyTransferred);
        await transaction.stock.update({
          where: { id: sendingWarehouseStock.id },
          data: { openingStock: updatedSendingStock.toString() },
        });

        const batchNumber = await this.generateUniqueBatchNumber(
          companyId,
          receivingWarehouse.name,
          user.id,
        );

        const openingStockValue =
          Number(item.costPrice) * Number(item.qtyTransferred);
        newStock = await transaction.stock.create({
          data: {
            companyId: product.companyId,
            openingStock: String(item.qtyTransferred),
            itemName: product.name,
            warehouseName: receivingWarehouse.name,
            batchNumber,
            purchase: {
              costPrice: item.costPrice,
            },
            openingStockValue: String(openingStockValue),
            createdBy: user.primaryContactName,
            product: { connect: { id: Number(item.productId) } },
            warehouses: { connect: { id: receivingWarehouse.id } },
          },
        });

        console.log(`Total items processed: ${loopCount}`);
      }

      return newStock;
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'Error transferring item',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async BatchLogs(
    userId: number,
    paginationDto: PaginationDto,
    startDate?: DateTime,
    endDate?: DateTime,
  ): Promise<GetAllResponse<BatchLog>> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const { page, limit } = paginationDto;
      const skip = page ? (page - 1) * limit : 0;
      const take = limit || 10;

      // Date filtering logic
      let dateFilter: any = {};
      if (startDate && endDate) {
        const startOfDay = startDate.startOf('day');
        const endOfDay = endDate.endOf('day');
        dateFilter = {
          gte: startOfDay.toJSDate(),
          lt: endOfDay.toJSDate(),
        };
      }

      const batchLogs = await this.prismaService.batchLog.findMany({
        where: {
          companyId,
          status: 'COMPLETED',
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
        include: {
          invoice: { where: { companyId } },
          customer: { where: { companyId } },
        },
        skip,
        take,

        orderBy: {
          createdAt: 'desc',
        },
      });

      // Get total count for pagination.
      const totalItems = await this.prismaService.batchLog.count({
        where: {
          companyId,
          status: 'COMPLETED',
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
      });

      // Add gross margin to each batch log.
      const batchLogsWithGrossMargin = await Promise.all(
        batchLogs.map(async (log) => {
          const stock = await this.prismaService.stock.findUnique({
            where: {
              companyId,
              id: log.batchId,
            },
            include: {
              product: { where: { companyId } },
            },
          });

          // A Temp workaround to solve the issues of packet price being used as pcs price.
          let costPriceInPCS: number;
          const costPrice = parseFloat(
            (stock?.purchase as PurchaseDetails)?.costPrice || '0',
          );

          const pricePerPack = parseFloat(
            (stock.product[0]?.purchase as PurchaseDetails)?.pricePerPack ||
              '0',
          );

          if (costPrice === pricePerPack) {
            const pricePerPcs = parseFloat(
              (stock.product[0]?.purchase as PurchaseDetails)?.pricePerPcs ||
                '0',
            );
            costPriceInPCS = pricePerPcs;
          }

          const Vat = user.adminCompanyId?.VAT ? user.adminCompanyId?.VAT : 7.5;
          const calVat = (Vat * log.sellingPrice) / 100;

          //const grossMargin = log.sellingPrice - log.costPrice - Vat;
          const costPriceTest = costPriceInPCS
            ? costPriceInPCS * log.quantity
            : log.costPriceInPCS * log.quantity;
          const grossMarginTest = log.sellingPrice - costPriceTest;
          const inputVat = (costPriceTest * Vat) / 100;
          const outputVat = (grossMarginTest * Vat) / 100;

          return {
            ...log,
            costPrice: costPriceTest,
            grossMargin: grossMarginTest,
            costPriceInPCS: undefined,
            costPriceInPKT: undefined,
            VAT: calVat,
            inputVat,
            outputVat,
          };
        }),
      );

      const totalPages = limit ? Math.ceil(totalItems / limit) : 1;
      const currentPage = page || 1;

      const total = batchLogsWithGrossMargin.reduce(
        (acc, curr) => {
          acc.grossMargin += Number(curr?.grossMargin);
          acc.quantity += Number(curr?.quantity);
          acc.costPrice += Number(curr?.costPrice);
          acc.sellingPrice += Number(curr?.sellingPrice);
          return acc;
        },
        { grossMargin: 0, quantity: 0, costPrice: 0, sellingPrice: 0 },
      );

      return {
        status: 'Success',
        message: 'Successfully retrieved',
        data: batchLogsWithGrossMargin as BatchLog[],
        grandTotal: {
          grossMargin: total.grossMargin,
          salesValue: total.sellingPrice,
          COGS: total.costPrice,
          salesVolume: total.quantity,
        },
        totalItems,
        currentPage,
        totalPages,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'Error retrieving batch logs',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async GroupedBatchLogs(
    userId: number,
    productId: number,
    paginationDto: PaginationDto,
    startDate?: DateTime,
    endDate?: DateTime,
  ): Promise<GetAllResponse<any>> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;
      const { page, limit } = paginationDto;
      const skip = page ? (page - 1) * limit : 0;
      const take = limit || 10;

      // Date filtering logic
      let dateFilter: any = {};
      if (startDate && endDate) {
        const startOfDay = startDate.startOf('day');
        const endOfDay = endDate.endOf('day');
        dateFilter = {
          gte: startOfDay.toJSDate(),
          lt: endOfDay.toJSDate(),
        };
      }

      const batchLogs = await this.prismaService.batchLog.groupBy({
        by: ['batchNumber'],
        where: {
          companyId,
          productId,
          status: 'COMPLETED',
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
        _sum: {
          quantity: true,
          sellingPrice: true,
          amount: true,
        },
        orderBy: {
          batchNumber: 'asc',
        },
        skip,
        take,
      });

      // Get total count for pagination
      const totalItems = await this.prismaService.batchLog.groupBy({
        by: ['batchNumber'],
        where: {
          companyId,
          productId,
          status: 'COMPLETED',
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
        _count: true,
      });

      // Fetch additional details for each group
      const group = await Promise.all(
        batchLogs.map(async (group) => {
          const firstBatchLogInGroup =
            await this.prismaService.batchLog.findFirst({
              where: { batchNumber: group.batchNumber, productId, companyId },
              include: {
                product: { where: { companyId } },
                supplier: { where: { companyId } },
                warehouse: { where: { companyId } },
                stock: true,
              },
            });

          const Vat = user.adminCompanyId?.VAT ? user.adminCompanyId?.VAT : 7.5;
          const calVat = (Vat * group._sum.sellingPrice!) / 100;

          const stock = await this.prismaService.stock.findUnique({
            where: {
              companyId,
              id: firstBatchLogInGroup.batchId,
            },
            include: {
              product: { where: { companyId } },
            },
          });

          // A Temp workaround to solve the issues of packet price being used as pcs price
          let costPriceInPCS: number;
          const costPrice = parseFloat(
            (stock.purchase as PurchaseDetails)?.costPrice || '0',
          );

          const pricePerPack = parseFloat(
            (stock.product[0].purchase as PurchaseDetails)?.pricePerPack || '0',
          );

          if (costPrice === pricePerPack) {
            const pricePerPcs = parseFloat(
              (stock.product[0].purchase as PurchaseDetails)?.pricePerPcs ||
                '0',
            );
            costPriceInPCS = pricePerPcs;
          }

          const initialValue =
            firstBatchLogInGroup.costPriceInPCS *
            (Number(group._sum.quantity) +
              Number(firstBatchLogInGroup?.stock?.openingStock));

          //const margin = group._sum.amount! - initialValue

          const costOfGoodsSold = costPriceInPCS
            ? costPriceInPCS * group._sum.quantity
            : firstBatchLogInGroup.costPriceInPCS * group._sum.quantity;
          const margin = group._sum.amount - costOfGoodsSold;
          const newCostPrice = costPriceInPCS
            ? costPriceInPCS
            : firstBatchLogInGroup.costPriceInPCS;

          return {
            batchNumber: group.batchNumber,
            quantitySold: group._sum.quantity!,
            costPrice: newCostPrice,
            sellingPrice: group._sum.sellingPrice!,
            salesValue: group._sum.amount,
            initialValue,
            margin,
            VAT: calVat,
            costOfGoodsSold,
            supplierName: firstBatchLogInGroup?.stock?.supplierName,
            warehouse: firstBatchLogInGroup?.warehouse?.name,
            initialQty: firstBatchLogInGroup?.stock?.initialQtyValue
              ? firstBatchLogInGroup?.stock?.initialQtyValue
              : Number(group._sum.quantity) +
                Number(firstBatchLogInGroup?.stock?.openingStock),
            createdAt: firstBatchLogInGroup.createdAt,
          };
        }),
      );

      const totalPages = limit ? Math.ceil(totalItems.length / limit) : 1;
      const currentPage = page || 1;

      return {
        status: 'Success',
        message: 'Successfully retrieved grouped batch logs',
        data: group,
        totalItems: totalItems.length,
        currentPage,
        totalPages,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'Error retrieving grouped batch logs',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async requestSalesStats(userId: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const salesOrder = await this.prismaService.salesOrder.findMany({
        where: {
          companyId,
        },
        include: {
          request: { where: { companyId } },
          invoices: { where: { companyId } },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      const request = await this.prismaService.request.findMany({
        where: {
          companyId,
          type: RequestType.CUSTOMER,
        },

        orderBy: {
          createdAt: 'desc',
        },
      });

      let pendingRequest = 0;
      let approvedRequest = 0;
      let approvedSales = 0;

      salesOrder.forEach((order) => {
        switch (order.status) {
          case 'APPROVED':
            approvedSales++;
            break;
        }
      });

      request.forEach((request) => {
        switch (request.state) {
          case 'PENDING':
            pendingRequest++;
            break;
          case 'APPROVED':
            approvedRequest++;
            break;
        }
      });

      return {
        status: 'Success',
        message: 'Successfully retrieved',
        data: {
          pendingRequest,
          approvedRequest,
          approvedSales,
        },
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching sales stats',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  // async getDashboardMetrics(userId: number, month: number) {
  //   const user = await this.usersservice.findUserWithRelationships(userId);
  //   const companyId =
  //     user.adminCompanyId?.adminID || user.employeeId?.companyId;

  //   const currentYear = new Date().getFullYear();
  //   const previousYear = currentYear - 1;

  //   // Calculate date ranges for the selected month in current and previous years
  //   const currentYearStart = new Date(currentYear, month - 1, 1); // First day of the month
  //   const currentYearEnd = new Date(currentYear, month, 0); // Last day of the month

  //   const previousYearStart = new Date(previousYear, month - 1, 1);
  //   const previousYearEnd = new Date(previousYear, month, 0);

  //   console.log('currentYear:', currentYear);
  //   console.log('currentYearStart:', currentYearStart);
  //   console.log('currentYearEnd:', currentYearEnd);

  //   console.log('previousYear:', previousYear);
  //   console.log('previousYearStart:', previousYearStart);
  //   console.log('previousYearStart:', previousYearStart);

  //   // Sales Volume
  //   const currentYearSalesVolume = await this.prismaService.salesOrder.count({
  //     where: {
  //       companyId,
  //       status: RequestState.PENDING,
  //       createdAt: {
  //         gte: currentYearStart,
  //         lte: currentYearEnd,
  //       },
  //     },
  //   });

  //   const previousYearSalesVolume = await this.prismaService.salesOrder.count({
  //     where: {
  //       companyId,
  //       status: RequestState.PENDING,
  //       createdAt: {
  //         gte: previousYearStart,
  //         lte: previousYearEnd,
  //       },
  //     },
  //   });

  //   // Sales Value
  //   // const currentYearSalesValue = await this.prismaService.salesOrder.aggregate({
  //   //   _sum: {
  //   //     total: true,
  //   //   },
  //   //   where: {
  //   //     createdAt: {
  //   //       gte: currentYearStart,
  //   //       lte: currentYearEnd,
  //   //     },
  //   //   },
  //   // });

  //   // const previousYearSalesValue = await this.prisma.salesOrder.aggregate({
  //   //   _sum: {
  //   //     total: true,
  //   //   },
  //   //   where: {
  //   //     createdAt: {
  //   //       gte: previousYearStart,
  //   //       lte: previousYearEnd,
  //   //     },
  //   //   },
  //   // });

  //   // Add similar logic for other metrics...

  //   return {
  //     salesVolume: {
  //       current: currentYearSalesVolume,
  //       previous: previousYearSalesVolume,
  //     },
  //     // salesValue: {
  //     //   current: currentYearSalesValue._sum.total || 0,
  //     //   previous: previousYearSalesValue._sum.total || 0,
  //     // },
  //     // Add other metrics here...
  //   };
  // }

  // async getDashboardMetrics(userId: number, month: number) {
  //   const user = await this.usersservice.findUserWithRelationships(userId);
  //   const companyId =
  //     user.adminCompanyId?.adminID || user.employeeId?.companyId;

  //   const currentYear = new Date().getUTCFullYear();
  //   const previousYear = currentYear - 1;

  //   // Calculate date ranges up to the selected month in current and previous years
  //   const currentYearStart = new Date(Date.UTC(currentYear, 0, 1)); // January 1 of the current year
  //   const currentYearEnd = new Date(
  //     Date.UTC(currentYear, month, 0, 23, 59, 59, 999),
  //   ); // Last day of the passed month

  //   const previousYearStart = new Date(Date.UTC(previousYear, 0, 1)); // January 1 of the previous year
  //   const previousYearEnd = new Date(
  //     Date.UTC(previousYear, month, 0, 23, 59, 59, 999),
  //   ); // Last day of the passed month

  //   console.log('currentYear:', currentYear);
  //   console.log('currentYearStart (UTC):', currentYearStart.toISOString());
  //   console.log('currentYearEnd (UTC):', currentYearEnd.toISOString());

  //   console.log('previousYear:', previousYear);
  //   console.log('previousYearStart (UTC):', previousYearStart.toISOString());
  //   console.log('previousYearEnd (UTC):', previousYearEnd.toISOString());

  //   // Fetch current year batch logs
  //   const currentYearBatchLogs = await this.prismaService.batchLog.findMany({
  //     where: {
  //       companyId,
  //       status: 'COMPLETED',
  //       createdAt: {
  //         gte: currentYearStart,
  //         lte: currentYearEnd,
  //       },
  //     },
  //   });

  //   // Fetch previous year batch logs
  //   const previousYearBatchLogs = await this.prismaService.batchLog.findMany({
  //     where: {
  //       companyId,
  //       status: 'COMPLETED',
  //       createdAt: {
  //         gte: previousYearStart,
  //         lte: previousYearEnd,
  //       },
  //     },
  //   });

  //   // Sales Volume
  //   const currentYearSalesOrder = await this.prismaService.salesOrder.count({
  //     where: {
  //       companyId,
  //       status: RequestState.PENDING,
  //       createdAt: {
  //         gte: currentYearStart,
  //         lte: currentYearEnd,
  //       },
  //     },
  //   });

  //   const previousYearSalesOrder = await this.prismaService.salesOrder.count({
  //     where: {
  //       companyId,
  //       status: RequestState.PENDING,
  //       createdAt: {
  //         gte: previousYearStart,
  //         lte: previousYearEnd,
  //       },
  //     },
  //   });

  //   const currentYearUnpaidInvoice = await this.prismaService.invoice.count({
  //     where: {
  //       companyId,
  //       paymentStatus: PaymentStatus.UNPAID,
  //       createdAt: {
  //         gte: currentYearStart,
  //         lte: currentYearEnd,
  //       },
  //     },
  //   });

  //   const previousYearUnpaidInvoice = await this.prismaService.invoice.count({
  //     where: {
  //       companyId,
  //       paymentStatus: PaymentStatus.UNPAID,
  //       createdAt: {
  //         gte: previousYearStart,
  //         lte: previousYearEnd,
  //       },
  //     },
  //   });

  //   const currentYearsalesValue = this.calculateMetrics(currentYearBatchLogs);
  //   const previousYearsalesValue = this.calculateMetrics(currentYearBatchLogs);

  //   const currentYearSalesVolume = this.calculateMetrics(currentYearBatchLogs);
  //   const previousYearsalesVolume = this.calculateMetrics(currentYearBatchLogs);

  //   return {
  //     status: 'Success',
  //     message: 'Successfully retrieved',
  //     data: {
  //       salesVolume: {
  //         current: currentYearSalesVolume,
  //         previous: previousYearsalesVolume,
  //       },
  //       salesValue: {
  //         current: currentYearsalesValue,
  //         previous: previousYearsalesValue,
  //       },
  //       InventoryQuantity: {
  //         current: currentYearSalesOrder,
  //         previous: previousYearSalesOrder,
  //       },
  //       salesOrder: {
  //         current: currentYearSalesOrder,
  //         previous: previousYearSalesOrder,
  //       },
  //       UnpaidInvoices: {
  //         current: currentYearUnpaidInvoice,
  //         previous: previousYearUnpaidInvoice,
  //       },
  //     },
  //   };
  // }

  // Helper method to calculate metrics

  async getDashboardMetrics(
    userId: number,
    startDate?: DateTime,
    endDate?: DateTime,
  ) {
    const user = await this.usersservice.findUserWithRelationships(userId);
    const companyId =
      user.adminCompanyId?.adminID || user.employeeId?.companyId;

    // Date filtering logic
    let dateFilter: any = {};
    if (startDate && endDate) {
      const startOfDay = startDate.startOf('day');
      const endOfDay = endDate.endOf('day');
      dateFilter = {
        gte: startOfDay.toJSDate(),
        lt: endOfDay.toJSDate(),
      };
    }

    const batchLogs = await this.prismaService.batchLog.findMany({
      where: {
        companyId,
        status: 'COMPLETED',
        ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
      },
    });

    const stocks = await this.fetchStockData(
      this.prismaService,
      companyId,
      startDate,
      endDate,
    );

    const totalInventory = stocks.reduce(
      (acc, curr) => {
        acc.openingStock += Number(curr?.openingStock);
        acc.committedQuantity += Number(curr?.committedQuantity);
        return acc;
      },
      { openingStock: 0, committedQuantity: 0 },
    );

    const total =
      totalInventory.openingStock + totalInventory.committedQuantity;

    // Sales Volume
    const salesOrder = await this.prismaService.salesOrder.count({
      where: {
        companyId,
        status: RequestState.PENDING,
        ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
      },
    });

    const unpaidInvoices = await this.prismaService.invoice.count({
      where: {
        companyId,
        paymentStatus: PaymentStatus.UNPAID,
        ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
      },
    });

    //const currentYearsalesValue = this.calculateMetrics(batchLogs);
    // const previousYearsalesValue = this.calculateMetrics(batchLogs);

    //const currentYearSalesVolume = this.calculateMetrics(batchLogs);
    //const previousYearsalesVolume = this.calculateMetrics(batchLogs);

    // Add gross margin to each batch log.
    const salesReport = await Promise.all(
      batchLogs.map(async (log) => {
        const stock = await this.prismaService.stock.findUnique({
          where: {
            companyId,
            id: log.batchId,
          },
          include: {
            product: { where: { companyId } },
          },
        });

        // A Temp workaround to solve the issues of packet price being used as pcs price.
        let costPriceInPCS: number;
        const costPrice = parseFloat(
          (stock?.purchase as PurchaseDetails)?.costPrice || '0',
        );

        const pricePerPack = parseFloat(
          (stock.product[0]?.purchase as PurchaseDetails)?.pricePerPack || '0',
        );

        if (costPrice === pricePerPack) {
          const pricePerPcs = parseFloat(
            (stock.product[0]?.purchase as PurchaseDetails)?.pricePerPcs || '0',
          );
          costPriceInPCS = pricePerPcs;
        }

        //const grossMargin = log.sellingPrice - log.costPrice - Vat;
        const costPriceTest = costPriceInPCS
          ? costPriceInPCS * log.quantity
          : log.costPriceInPCS * log.quantity;

        return {
          ...log,
          costPrice: costPriceTest,
        };
      }),
    );

    const totalCal = salesReport.reduce(
      (acc, curr) => {
        acc.quantity += Number(curr?.quantity);
        acc.costPrice += Number(curr?.costPrice);
        acc.sellingPrice += Number(curr?.sellingPrice);
        return acc;
      },
      { quantity: 0, costPrice: 0, sellingPrice: 0 },
    );

    return {
      status: 'Success',
      message: 'Successfully retrieved',
      data: {
        salesVolume: {
          current: totalCal.quantity,
          //previous: previousYearsalesVolume,
        },
        salesValue: {
          current: totalCal.sellingPrice,
          // previous: previousYearsalesValue,
        },
        COGS: {
          current: totalCal.costPrice,
          // previous: previousYearsalesValue,
        },
        InventoryQuantity: {
          current: total,
        },
        pendingSalesOrder: {
          current: salesOrder,
        },
        UnpaidInvoices: {
          current: unpaidInvoices,
        },
      },
    };
  }

  private calculateMetrics(batchLogs: BatchLog[]) {
    // sales trans. would have still work but batchlog works same.
    const salesVolume = batchLogs.reduce(
      (acc, curr) => acc + Number(curr.quantity),
      0,
    );

    const salesValue = batchLogs.reduce(
      (acc, curr) => acc + Number(curr.costPrice),
      0,
    );

    return { salesVolume, salesValue };
  }

  // async topSalesPerson(
  //   userId: number,
  //   startDate: DateTime,
  //   endDate: DateTime,
  //   limit: number,
  // ) {
  //   try {

  //     const user = await this.usersservice.findUserWithRelationships(userId);
  //     const companyId =
  //       user.adminCompanyId?.adminID || user.employeeId?.companyId;

  //     const startOfDay = startDate.startOf('day');
  //     const endOfDay = endDate.endOf('day');

  //     // Fetch grouped sales data
  //     const salesByUser = await this.prismaService.salesTransaction.groupBy({
  //       by: ['salesPersonId'],
  //       _sum: {
  //         amount: true,
  //       },
  //       where: {
  //         companyId,
  //         AND: [
  //           { createdAt: { gte: startOfDay.toJSDate() } },
  //           { createdAt: { lt: endOfDay.toJSDate() } },
  //         ],
  //       },
  //       orderBy: {
  //         _sum: {
  //           amount: 'desc',
  //         },
  //       },
  //       take: limit,
  //     });
  //     console.log(salesByUser);
  //     // Fetch unique invoices and customers for each salesperson
  //     const topSellers = await Promise.all(
  //       salesByUser.map(async (userSale) => {
  //         const userId = userSale.salesPersonId;
  //         console.log(userId);
  //         // Get unique invoice count
  //         const uniqueInvoices =
  //           await this.prismaService.salesTransaction.findMany({
  //             where: {
  //               salesPersonId: userId,
  //               companyId,
  //               AND: [
  //                 { createdAt: { gte: startOfDay.toJSDate() } },
  //                 { createdAt: { lt: endOfDay.toJSDate() } },
  //               ],
  //             },
  //             select: {
  //               invoiceId: true,
  //             },
  //             distinct: ['invoiceId'],
  //           });

  //         // Get unique customer count
  //         const uniqueCustomers =
  //           await this.prismaService.salesTransaction.findMany({
  //             where: {
  //               salesPersonId: userId,
  //               companyId,
  //               AND: [
  //                 { createdAt: { gte: startOfDay.toJSDate() } },
  //                 { createdAt: { lt: endOfDay.toJSDate() } },
  //               ],
  //             },
  //             select: {
  //               customerId: true,
  //             },
  //             distinct: ['customerId'],
  //           });

  //         // Fetch salesperson details
  //         const user = await this.prismaService.user.findUnique({
  //           where: {
  //             id: userId,
  //           },
  //           select: {
  //             id: true,
  //             primaryContactName: true,
  //           },
  //         });

  //         return {
  //           ...user,
  //           totalSalesAmount: userSale._sum.amount,
  //           totalInvoices: uniqueInvoices.length, // Unique invoices count
  //           totalCustomers: uniqueCustomers.length, // Unique customers count
  //         };
  //       }),
  //     );

  //     return {
  //       status: 'Success',
  //       message: 'Successfully retrieved top salespersons',
  //       topSellers,
  //     };
  //   } catch (error) {
  //     this.logger.error(error);
  //     if (error instanceof Prisma.PrismaClientValidationError) {
  //       throw new HttpException(
  //         'An error occurred while fetching records',
  //         HttpStatus.BAD_REQUEST,
  //       );
  //     }
  //     throw error;
  //   }
  // }

  async topSalesPerson(
    userId: number,
    startDate: DateTime,
    endDate: DateTime,
    limit: number,
  ) {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const startOfDay = startDate.startOf('day');
      const endOfDay = endDate.endOf('day');

      // Fetch grouped sales data
      const salesByUser = await this.prismaService.salesTransaction.groupBy({
        by: ['salesPersonId'],
        _sum: {
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
          },
        },
        take: limit,
      });

      // Fetch unique invoices and customers for each salesperson
      const topSellers = await Promise.all(
        salesByUser.map(async (userSale) => {
          const salesPersonId = userSale.salesPersonId;

          // Skip processing if salesPersonId is null
          if (!salesPersonId) {
            return null;
          }

          // Get unique invoice count
          const uniqueInvoices =
            await this.prismaService.salesTransaction.findMany({
              where: {
                salesPersonId,
                companyId,
                AND: [
                  { createdAt: { gte: startOfDay.toJSDate() } },
                  { createdAt: { lt: endOfDay.toJSDate() } },
                ],
              },
              select: {
                invoiceId: true,
              },
              distinct: ['invoiceId'],
            });

          // Get unique customer count
          const uniqueCustomers =
            await this.prismaService.salesTransaction.findMany({
              where: {
                salesPersonId,
                companyId,
                AND: [
                  { createdAt: { gte: startOfDay.toJSDate() } },
                  { createdAt: { lt: endOfDay.toJSDate() } },
                ],
              },
              select: {
                customerId: true,
              },
              distinct: ['customerId'],
            });

          // Fetch salesperson details
          const user = await this.prismaService.user.findUnique({
            where: {
              id: salesPersonId,
            },
            select: {
              id: true,
              primaryContactName: true,
            },
          });

          return {
            ...user,
            totalSalesAmount: userSale._sum.amount,
            totalInvoices: uniqueInvoices.length,
            totalCustomers: uniqueCustomers.length,
          };
        }),
      );

      // Filter out null values (e.g., skipped entries)
      const filteredTopSellers = topSellers.filter((seller) => seller !== null);

      return {
        status: 'Success',
        message: 'Successfully retrieved top salespersons',
        topSellers: filteredTopSellers,
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
}
