import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  CreateSalesOrderDto,
  PurchaseDetails,
} from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import {
  MailService,
  PrismaService,
  finaliseSerialNumber,
  paginate,
} from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import {
  CreatePurchaseOrderDto,
  OrderStatus,
} from './dto/create-purchase-order.dto';
import {
  OrderType,
  Prisma,
  PurchaseOrder,
  RequestState,
  SalesOrder,
  User,
} from '@prisma/client';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { CreateOrderConfirmationDto } from './dto/create-purchase-confirmation.dto';
import { DateTime } from 'luxon';
import { EventsGateway } from 'src/events/events.gateway';
import { PaginationDto } from 'src/common/dto';
import { GetAllResponse } from 'src/common/interface';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersservice: UsersService,
    private readonly mailService: MailService,
    private readonly logger: Logger,
    private readonly eventsGateway: EventsGateway,
    private readonly finaliseSerialNumber: finaliseSerialNumber,
  ) {}

  /************************ SALES ORDER START*****************************/

  async CreateSalesOrder(
    createSalesOrderDto: CreateSalesOrderDto,
    userId: number,
  ) {
    const user = await this.usersservice.findUserWithRelationships(userId);
    const companyId =
      user.adminCompanyId?.adminID || user.employeeId?.companyId;

    const customer = await this.prismaService.customer.findUnique({
      where: { id: createSalesOrderDto.customerId, companyId },
    });

    if (!customer) {
      throw new HttpException(
        `Customer with name ${createSalesOrderDto.customerName} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Check for valid product IDs and availability
    const uniqueProducts = new Set();
    await Promise.all(
      createSalesOrderDto.itemDetails.map(async (item) => {
        //Check for uniqueness
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
          throw new HttpException(
            `Stock not found for product ${product.name} and warehouse name ${item.warehouseName}`,
            HttpStatus.NOT_FOUND,
          );
        }

        // if (
        //   Number(stock.openingStock) === 0 &&
        //   Number(stock.committedQuantity) === 0
        // ) {
        //   //console.log('Stock check', stock.openingStock);
        //   throw new HttpException(
        //     `Product with name ${product.name} is out of stock`,
        //     HttpStatus.BAD_REQUEST,
        //   );
        // }
      }),
    );

    if (createSalesOrderDto.priceListId) {
      const priceList = await this.prismaService.priceList.findUnique({
        where: { id: createSalesOrderDto.priceListId, companyId },
        include: { products: { where: { companyId } } },
      });

      if (!priceList) {
        throw new HttpException(`PriceList not found`, HttpStatus.NOT_FOUND);
      }

      if (priceList.customerType !== customer.customerType) {
        throw new HttpException(
          `PriceList can only be applied to same customer Type`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Compare productIds in the dto with the productIds in the priceList
      const missingProductIds = createSalesOrderDto.productIds?.filter(
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
    const existingSalesOrder = await this.prismaService.salesOrder.findFirst({
      where: { SN: createSalesOrderDto.SN, companyId },
    });

    const request = await this.prismaService.request.findUnique({
      where: { id: createSalesOrderDto.requestId, companyId },
    });

    if (!request) {
      throw new HttpException(`Invalid request ID`, HttpStatus.NOT_FOUND);
    }

    if (request.state === RequestState.COMPLETED) {
      throw new HttpException(
        `Request already completed`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (request.state !== RequestState.APPROVED) {
      throw new HttpException(`Request not approved`, HttpStatus.BAD_REQUEST);
    }

    if (existingSalesOrder) {
      throw new HttpException(
        `sales order already created with this number ${createSalesOrderDto.SN} `,
        HttpStatus.BAD_REQUEST,
      );
    }

    const assignedTo = await this.prismaService.user.findUnique({
      where: {
        id: createSalesOrderDto.assignedToId,
        companyId,
      },
    });

    if (!assignedTo) {
      throw new HttpException(
        'Assigned user does not exist',
        HttpStatus.NOT_FOUND,
      );
    }

    try {
      return await this.prismaService.$transaction(
        async (prisma) => {
          // Check if any item quantity requires approval
          const totalQuantity = createSalesOrderDto.itemDetails.reduce(
            (total, item) => total + Number(item.quantity),
            0,
          );

          let salesOrder: SalesOrder;
          if (totalQuantity && totalQuantity > 1000) {
            if (createSalesOrderDto.type === OrderType.APPROVAL) {
              if (createSalesOrderDto.approverId) {
                const approver = await prisma.user.findUnique({
                  where: {
                    id: createSalesOrderDto.approverId,
                    companyId,
                  },
                });

                if (!approver) {
                  throw new HttpException(
                    'Assigned approver does not exist',
                    HttpStatus.NOT_FOUND,
                  );
                }

                salesOrder = await prisma.salesOrder.create({
                  data: {
                    SN: createSalesOrderDto.SN,
                    customerName: createSalesOrderDto.customerName,
                    customerId: customer.id,
                    shipmentDate: createSalesOrderDto.shipmentDate,
                    requestId: createSalesOrderDto.requestId,
                    location: createSalesOrderDto.location,
                    shippingAddress: createSalesOrderDto.shippingAddress,
                    shippingCharges: createSalesOrderDto.shippingCharges,
                    priceListName: createSalesOrderDto.priceListName,
                    discount: createSalesOrderDto.discount,
                    priority: createSalesOrderDto.priority,
                    totalItems: createSalesOrderDto.totalItems,
                    totalPrice: createSalesOrderDto.totalPrice,
                    state: createSalesOrderDto.state,
                    status: createSalesOrderDto.status,
                    approverId: approver.id,
                    assignedToId: assignedTo.id,
                    type: createSalesOrderDto.type,
                    openedBy: user.primaryContactName,
                    product: {
                      connect: createSalesOrderDto?.itemDetails.map((p) => ({
                        id: Number(p.productId),
                      })),
                    },
                    itemDetails: createSalesOrderDto?.itemDetails.map(
                      (item) => ({
                        productId: item?.productId,
                        productName: item.productName,
                        unitType: item.unitType,
                        quantity: item.quantity,
                        warehouseName: item.warehouseName,
                        amount: item.amount,
                        rate: item.rate,
                        unit: item.unit,
                        baseQty: item.baseQty,
                      }),
                    ),
                    companyId,
                  },
                  include: { approver: { where: { companyId } } },
                });

                await this.updateStock(
                  createSalesOrderDto.itemDetails,
                  companyId,
                  salesOrder,
                  prisma,
                );

                const notification = await prisma.approvalNotifications.create({
                  data: {
                    message: `New sales order ${salesOrder.SN} needs approval.`,
                    companyId,
                    userId: user.id,
                    approverId: approver.id,
                    salesOrderId: salesOrder.id,
                    notifierId: approver.id,
                    type: 'SalesOrderApproval',
                  },
                  include: { salesOrder: true },
                });

                const appNotification = await prisma.inAppNotifications.create({
                  data: {
                    message: `New sales order ${salesOrder.SN} needs approval.`,
                    companyId,
                    receiverId: approver.id,
                    salesOrderId: salesOrder.id,
                    senderId: user.id,
                    type: 'SalesOrderApproval',
                  },
                  include: { salesOrder: true },
                });

                await this.eventsGateway.sendNotificationToUser(
                  approver.id,
                  appNotification,
                  prisma,
                );
                await this.mailService.salesOrderNotifications(
                  notification,
                  approver,
                  user,
                  salesOrder,
                );
              } else if (createSalesOrderDto.departmentIds) {
                let existingDepartments: any[] = [];

                //checks and ensure departmentId is always an array.
                const departmentIdArray = Array.isArray(
                  createSalesOrderDto.departmentIds,
                )
                  ? createSalesOrderDto.departmentIds
                  : [createSalesOrderDto.departmentIds];

                // Check if the departments exist
                existingDepartments = await prisma.department.findMany({
                  where: { id: { in: departmentIdArray } },
                });

                if (existingDepartments.length !== departmentIdArray.length) {
                  const missingDepartmentIds = departmentIdArray.filter(
                    (id) =>
                      !existingDepartments.some(
                        (department) => department.id === id,
                      ),
                  );
                  throw new HttpException(
                    `Departments with IDs ${missingDepartmentIds.join(
                      ', ',
                    )} not found`,
                    HttpStatus.NOT_FOUND,
                  );
                }

                salesOrder = await prisma.salesOrder.create({
                  data: {
                    SN: createSalesOrderDto.SN,
                    customerName: createSalesOrderDto.customerName,
                    customerId: customer.id,
                    shipmentDate: createSalesOrderDto.shipmentDate,
                    shippingAddress: createSalesOrderDto.shippingAddress,
                    shippingCharges: createSalesOrderDto.shippingCharges,
                    priceListName: createSalesOrderDto.priceListName,
                    discount: createSalesOrderDto.discount,
                    priority: createSalesOrderDto.priority,
                    totalItems: createSalesOrderDto.totalItems,
                    totalPrice: createSalesOrderDto.totalPrice,
                    state: createSalesOrderDto.state,
                    status: createSalesOrderDto.status,
                    type: createSalesOrderDto.type,
                    openedBy: user.primaryContactName,
                    product: {
                      connect: createSalesOrderDto?.itemDetails.map((p) => ({
                        id: Number(p.productId),
                      })),
                    },
                    itemDetails: createSalesOrderDto?.itemDetails.map(
                      (item) => ({
                        productId: item?.productId,
                        productName: item.productName,
                        unitType: item.unitType,
                        quantity: item.quantity,
                        warehouseName: item.warehouseName,
                        amount: item.amount,
                        rate: item.rate,
                        unit: item.unit,
                        baseQty: item.baseQty,
                      }),
                    ),
                    companyId,
                  },
                });

                await this.updateStock(
                  createSalesOrderDto.itemDetails,
                  companyId,
                  salesOrder,
                  prisma,
                );

                // Associate the task with each department
                await Promise.all(
                  existingDepartments.map(async (department) => {
                    const departments = await prisma.department.update({
                      where: { id: department.id, companyId },
                      data: { salesOrder: { connect: { id: salesOrder.id } } },
                      include: { users: true },
                    });

                    // Notify each user in the department
                    await Promise.all(
                      departments.users.map(async (userInDepartment) => {
                        const notification =
                          await prisma.approvalNotifications.create({
                            data: {
                              message: `New sales order ${salesOrder.SN} needs approval.`,
                              companyId,
                              userId: user.id,
                              approverId: userInDepartment.id,
                              salesOrderId: salesOrder.id,
                              notifierId: userInDepartment.id,
                              type: 'SalesOrderApproval',
                            },
                            include: { salesOrder: true },
                          });

                        const appNotification =
                          await prisma.inAppNotifications.create({
                            data: {
                              message: `New sales order ${salesOrder.SN} needs approval.`,
                              companyId,
                              receiverId: userInDepartment.id,
                              salesOrderId: salesOrder.id,
                              senderId: user.id,
                              type: 'SalesOrderApproval',
                            },
                            include: { salesOrder: true },
                          });

                        await this.eventsGateway.sendNotificationToUser(
                          userInDepartment.id,
                          appNotification,
                          prisma,
                        );
                        await this.mailService.salesOrderNotifications(
                          notification,
                          userInDepartment,
                          user,
                          salesOrder,
                        );
                      }),
                    );
                  }),
                );
              }
              await prisma.request.update({
                where: {
                  id: createSalesOrderDto.requestId,
                },
                data: {
                  state: RequestState.COMPLETED,
                  companyId,
                },
              });
            } else if (createSalesOrderDto.type === OrderType.DRAFT) {
              // await this.updateStock(createSalesOrderDto.itemDetails, companyId);

              salesOrder = await prisma.salesOrder.create({
                data: {
                  SN: createSalesOrderDto.SN,
                  customerName: createSalesOrderDto.customerName,
                  customerId: customer.id,
                  shipmentDate: createSalesOrderDto.shipmentDate,
                  requestId: createSalesOrderDto.requestId,
                  location: createSalesOrderDto.location,
                  shippingAddress: createSalesOrderDto.shippingAddress,
                  shippingCharges: createSalesOrderDto.shippingCharges,
                  priceListName: createSalesOrderDto.priceListName,
                  discount: createSalesOrderDto.discount,
                  priority: createSalesOrderDto.priority,
                  totalItems: createSalesOrderDto.totalItems,
                  totalPrice: createSalesOrderDto.totalPrice,
                  state: createSalesOrderDto.state,
                  status: createSalesOrderDto.status,
                  approverId: createSalesOrderDto.approverId,
                  assignedToId: assignedTo.id,
                  type: createSalesOrderDto.type,
                  openedBy: user.primaryContactName,
                  product: {
                    connect: createSalesOrderDto?.itemDetails.map((p) => ({
                      id: Number(p.productId),
                    })),
                  },
                  itemDetails: createSalesOrderDto?.itemDetails.map((item) => ({
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
                  companyId,
                },
                include: { approver: { where: { companyId } } },
              });
            }

            if (salesOrder) {
              await this.finaliseSerialNumber.markSerialNumber(
                createSalesOrderDto.SN,
                companyId,
              );
            }

            return {
              status: 'Success',
              message: 'Sales Order created successfully',
              data: salesOrder,
            };
          }

          salesOrder = await this.createSalesOrderWithoutApproval(
            companyId,
            customer.id,
            user,
            assignedTo,
            createSalesOrderDto,
            prisma,
          );

          if (salesOrder) {
            await this.finaliseSerialNumber.markSerialNumber(
              createSalesOrderDto.SN,
              companyId,
            );
          }

          return {
            status: 'Success',
            message: 'Sales Order created successfully',
            data: salesOrder,
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
          'An error occurred while creating sales order.',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  // async updateStock(
  //   itemDetails: any[],
  //   companyId: number,
  //   saleOrder: SalesOrder,
  //   prisma: Prisma.TransactionClient,
  // ): Promise<void> {
  //   try {
  //     let loopCount = 0;

  //     await Promise.all(
  //       itemDetails.map(async (item) => {
  //         loopCount++;

  //         const product = await prisma.product.findUnique({
  //           where: { id: Number(item.productId), companyId },
  //           include: {
  //             stocks: {
  //               where: { warehouseName: item.warehouseName },
  //               include: { warehouses: true },
  //               orderBy: { createdAt: 'asc' },
  //             },
  //           },
  //         });

  //         // Track remaining quantity needed
  //         let remainingQuantity = Number(item.quantity);

  //         for (const stock of product.stocks) {
  //           const costPrice = stock?.purchase
  //             ? parseFloat(
  //                 (stock.purchase as PurchaseDetails)?.costPrice || '0',
  //               )
  //             : parseFloat(
  //                 (product?.purchase as PurchaseDetails)?.pricePerPcs || '0',
  //               );

  //           // Check if there's enough quantity in the current batch
  //           if (remainingQuantity > 0 && Number(stock.openingStock) > 0) {
  //             const quantityToDeduct = Math.min(
  //               remainingQuantity,
  //               Number(stock.openingStock),
  //             );

  //             // Update stock in the database
  //             await prisma.stock.update({
  //               where: { id: stock.id },
  //               data: {
  //                 openingStock: String(
  //                   Number(stock.openingStock) - quantityToDeduct,
  //                 ),

  //                 committedQuantity:
  //                   Number(stock.committedQuantity) + quantityToDeduct,
  //               },
  //             });

  //             // Update remaining quantity needed
  //             remainingQuantity -= quantityToDeduct;

  //             const specificWarehouse = stock.warehouses.find(
  //               (warehouse) => warehouse.name === item.warehouseName,
  //             );
  //             const warehouseId = specificWarehouse?.id;

  //             const SP =
  //               (quantityToDeduct * item.amount) / Number(stock.openingStock);

  //             await prisma.batchLog.create({
  //               data: {
  //                 productId: product.id,
  //                 batchId: stock.id,
  //                 batchNumber: stock.batchNumber,
  //                 quantity: quantityToDeduct,
  //                 sellingPrice: SP,
  //                 costPrice:
  //                   item.unit === 'PKT'
  //                     ? costPrice * Number(product.qtyPKT)
  //                     : costPrice,
  //                 costPriceInPKT:
  //                   item.unit === 'PKT'
  //                     ? costPrice * Number(product.qtyPKT)
  //                     : null,
  //                 costPriceInPCS: costPrice,
  //                 status: 'PENDING',
  //                 amount: Number(item.amount),
  //                 productName: product.name,
  //                 warehouseName: stock.warehouseName,
  //                 warehouseId: warehouseId,
  //                 customerId: saleOrder.customerId,
  //                 saleOrderId: saleOrder.id,
  //                 supplierId: product.supplierId,
  //                 companyId,
  //               },
  //             });

  //             if (remainingQuantity === 0) {
  //               // If remaining quantity becomes zero, exit loop
  //               break;
  //             }
  //           }
  //         }

  //         // Check if the entire quantity is fulfilled
  //         if (remainingQuantity > 0) {
  //           // Throw error if quantity is still not fulfilled after checking all batches
  //           throw new Error(
  //             `Insufficient quantity for product ${product.name}`,
  //           );
  //         }
  //       }),
  //     );

  //     console.log(`Total items processed: ${loopCount}`);
  //   } catch (error) {
  //     this.logger.error(error);
  //     if (error instanceof Prisma.PrismaClientValidationError) {
  //       throw new HttpException(
  //         'An error occurred while updating stock',
  //         HttpStatus.BAD_REQUEST,
  //       );
  //     }
  //     throw error;
  //   }
  // }

  async updateStock(
    itemDetails: any[],
    companyId: number,
    saleOrder: SalesOrder,
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
          let remainingQuantity = Number(item.quantity);

          // Calculate unit selling price (amount / quantity)
          const unitSellingPrice = Number(item.amount) / Number(item.quantity);

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
              await prisma.stock.update({
                where: { id: stock.id },
                data: {
                  openingStock: String(
                    Number(stock.openingStock) - quantityToDeduct,
                  ),
                  committedQuantity:
                    Number(stock.committedQuantity) + quantityToDeduct,
                },
              });

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
                  // Use rounded batch-specific amount
                  amount: batchSellingPrice,
                  productName: product.name,
                  warehouseName: stock.warehouseName,
                  warehouseId: warehouseId,
                  customerId: saleOrder.customerId,
                  saleOrderId: saleOrder.id,
                  supplierId: product.supplierId,
                  companyId,
                },
              });

              if (remainingQuantity === 0) {
                // If remaining quantity becomes zero, exit loop
                break;
              }
            }
          }

          // Check if the entire quantity is fulfilled
          if (remainingQuantity > 0) {
            // Throw error if quantity is still not fulfilled after checking all batches
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

  private async createSalesOrderWithoutApproval(
    companyId: number,
    customerId: number,
    user: User,
    assignedTo: User,
    createSalesOrderDto,
    prisma: Prisma.TransactionClient,
  ): Promise<any> {
    try {
      let salesOrder: SalesOrder;

      if (createSalesOrderDto.type === OrderType.DRAFT) {
        salesOrder = await prisma.salesOrder.create({
          data: {
            SN: createSalesOrderDto.SN,
            customerName: createSalesOrderDto.customerName,
            customerId,
            shipmentDate: createSalesOrderDto.shipmentDate,
            requestId: createSalesOrderDto.requestId,
            location: createSalesOrderDto.location,
            shippingAddress: createSalesOrderDto.shippingAddress,
            shippingCharges: createSalesOrderDto.shippingCharges,
            priceListName: createSalesOrderDto.priceListName,
            discount: createSalesOrderDto.discount,
            priority: createSalesOrderDto.priority,
            totalItems: createSalesOrderDto.totalItems,
            totalPrice: createSalesOrderDto.totalPrice,
            state: createSalesOrderDto.state,
            status: RequestState.PENDING,
            approved: false,
            approverId: createSalesOrderDto.approverId,
            assignedToId: assignedTo.id,
            type: createSalesOrderDto.type,
            openedBy: user.primaryContactName,
            product: {
              connect: createSalesOrderDto?.itemDetails.map((p) => ({
                id: Number(p.productId),
              })),
            },
            itemDetails: createSalesOrderDto?.itemDetails.map((item) => ({
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
            companyId,
          },
          include: { approver: { where: { companyId } } },
        });

        return salesOrder;
      }

      salesOrder = await prisma.salesOrder.create({
        data: {
          SN: createSalesOrderDto.SN,
          customerName: createSalesOrderDto.customerName,
          customerId,
          shipmentDate: createSalesOrderDto.shipmentDate,
          requestId: createSalesOrderDto.requestId,
          location: createSalesOrderDto.location,
          shippingAddress: createSalesOrderDto.shippingAddress,
          shippingCharges: createSalesOrderDto.shippingCharges,
          priceListName: createSalesOrderDto.priceListName,
          discount: createSalesOrderDto.discount,
          priority: createSalesOrderDto.priority,
          totalItems: createSalesOrderDto.totalItems,
          totalPrice: createSalesOrderDto.totalPrice,
          state: createSalesOrderDto.state,
          status: RequestState.APPROVED,
          approved: true,
          approverId: createSalesOrderDto.approverId,
          assignedToId: assignedTo.id,
          type: createSalesOrderDto.type,
          openedBy: user.primaryContactName,
          product: {
            connect: createSalesOrderDto?.itemDetails.map((p) => ({
              id: Number(p.productId),
            })),
          },
          itemDetails: createSalesOrderDto?.itemDetails.map((item) => ({
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
          companyId,
        },
        include: { approver: { where: { companyId } } },
      });

      await this.updateStock(
        createSalesOrderDto.itemDetails,
        companyId,
        salesOrder,
        prisma,
      );

      await prisma.request.update({
        where: {
          id: createSalesOrderDto.requestId,
        },
        data: {
          state: RequestState.COMPLETED,
          companyId,
        },
      });
      //console.log(salesOrder);
      return salesOrder;
    } catch (error) {
      throw error;
    }
  }

  private async updateSalesOrderWithoutApproval(
    companyId: number,
    order: SalesOrder,
    updateSalesOrderDto: UpdateSalesOrderDto,
    prisma: Prisma.TransactionClient,
  ): Promise<any> {
    try {
      let salesOrder: SalesOrder;

      salesOrder = await prisma.salesOrder.update({
        where: { id: order.id, companyId },
        data: {
          shipmentDate: updateSalesOrderDto.shipmentDate,

          location: updateSalesOrderDto.location,
          shippingAddress: updateSalesOrderDto.shippingAddress,
          shippingCharges: updateSalesOrderDto.shippingCharges,
          priceListName: updateSalesOrderDto.priceListName,
          discount: updateSalesOrderDto.discount,
          priority: updateSalesOrderDto.priority,
          totalItems: updateSalesOrderDto.totalItems,
          totalPrice: updateSalesOrderDto.totalPrice,
          state: updateSalesOrderDto.state,
          status: RequestState.APPROVED,
          approved: true,
          type: updateSalesOrderDto.type,
          product: {
            connect: updateSalesOrderDto?.itemDetails.map((p) => ({
              id: Number(p.productId),
            })),
          },
          itemDetails: updateSalesOrderDto?.itemDetails.map((item) => ({
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
          companyId,
        },
        include: { approver: { where: { companyId } } },
      });

      await this.updateStock(
        updateSalesOrderDto.itemDetails,
        companyId,
        salesOrder,
        prisma,
      );

      await prisma.request.update({
        where: {
          id: updateSalesOrderDto.requestId,
        },
        data: {
          state: RequestState.COMPLETED,
          companyId,
        },
      });

      return salesOrder;
    } catch (error) {
      throw error;
    }
  }

  async getSalesOrder(userId: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const salesOrder = await this.prismaService.salesOrder.findMany({
        where: { companyId },
        include: {
          request: { where: { companyId } },
          notifications: { where: { companyId } },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        status: 'Success',
        message: 'SalesOrder retrieved successfully',
        data: salesOrder,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching sales order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getSalesOrderById(userId: number, id: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const salesOrder = await this.prismaService.salesOrder.findUnique({
        where: { id, companyId },
        include: {
          request: { where: { companyId } },
          notifications: { where: { companyId } },
        },
      });

      if (!salesOrder) {
        throw new HttpException(
          `Sales order with id ${id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        status: 'Success',
        message: 'SalesOrder retrieved successfully',
        data: salesOrder,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching sales order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getApprovedSalesOrder(userId: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const salesOrder = await this.prismaService.salesOrder.findMany({
        where: { status: RequestState.APPROVED, companyId },
        include: { request: { where: { companyId } } },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        status: 'Success',
        message: 'SalesOrder retrieved successfully',
        data: salesOrder,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching sales order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getSalesOrderDraft(userId: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const salesOrder = await this.prismaService.salesOrder.findMany({
        where: { type: OrderType.DRAFT, companyId },
        include: { request: { where: { companyId } } },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        status: 'Success',
        message: 'SalesOrder retrieved successfully',
        data: salesOrder,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching sales order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async updateApprovedSalesOrder(
    userId: number,
    orderId: number,
    updateOrderDto: UpdateSalesOrderDto,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the Order exists
      const existingOrder = await this.prismaService.salesOrder.findUnique({
        where: { id: orderId, companyId },
        include: { request: { where: { companyId } } },
      });

      if (!existingOrder) {
        throw new HttpException(
          `Sales Order with id number ${orderId} does not found`,
          HttpStatus.NOT_FOUND,
        );
      }
      const getNotification =
        await this.prismaService.approvalNotifications.findFirst({
          where: {
            approverId: userId,
            companyId,
            salesOrderId: existingOrder.id,
          },
        });

      if (!getNotification) {
        throw new HttpException(
          'No sales order notifications found',
          HttpStatus.NOT_FOUND,
        );
      }
      //console.log(getNotification);
      const requestedUser = await this.prismaService.user.findUnique({
        where: { id: getNotification.userId, companyId },
      });
      // Save the updated request
      const updateOrder = await this.prismaService.salesOrder.update({
        where: { id: orderId, companyId },
        data: {
          status: updateOrderDto.status,
        },
      });
      //console.log(updateOrder);
      if (updateOrderDto.status === RequestState.APPROVED) {
        const notification =
          await this.prismaService.approvalNotifications.update({
            where: {
              id: getNotification.id,
              companyId,
            },
            data: {
              message: `Sales with serial number: ${updateOrder.SN} has been approved.`,
              companyId,
              userId: requestedUser.id,
              approverId: user.id,
              salesOrderId: existingOrder.id,
              notifierId: requestedUser.id,
              type: 'ApprovedSalesOrder',
              read: false,
            },
            include: { salesOrder: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Sales with serial number: ${updateOrder.SN} has been approved.`,
              companyId,
              receiverId: requestedUser.id,
              salesOrderId: existingOrder.id,
              senderId: user.id,
              type: 'ApprovedSalesOrder',
            },
            include: { salesOrder: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          requestedUser.id,
          appNotification,
        );
        await this.mailService.salesApprovalNotifications(
          notification,
          requestedUser,
          user,
          updateOrder,
        );
      } else if (updateOrderDto.status === RequestState.REJECT) {
        const notification =
          await this.prismaService.approvalNotifications.update({
            where: {
              id: getNotification.id,
              companyId,
            },
            data: {
              message: `Sales with serial number: ${updateOrder.SN} was rejected.`,
              comment: updateOrderDto.comment,
              companyId,
              userId: requestedUser.id,
              approverId: user.id,
              salesOrderId: existingOrder.id,
              notifierId: requestedUser.id,
              type: 'RejectedSalesOrder',
              read: false,
            },
            include: { salesOrder: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Sales with serial number: ${updateOrder.SN} was rejected.`,
              companyId,
              receiverId: requestedUser.id,
              salesOrderId: existingOrder.id,
              senderId: user.id,
              type: 'RejectedSalesOrder',
            },
            include: { salesOrder: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          requestedUser.id,
          appNotification,
        );
        await this.mailService.salesRejectionNotifications(
          notification,
          requestedUser,
          user,
          updateOrder,
        );
      }
      return {
        status: 'Successfully updated',
        data: updateOrder,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while processing this request',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async updateSalesOrderFields(
    userId: number,
    orderId: number,
    updateSalesOrderDto: UpdateSalesOrderDto,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const existingOrder = await this.prismaService.salesOrder.findUnique({
        where: { id: orderId, companyId },
      });

      if (!existingOrder) {
        throw new HttpException(
          `Sales Order with id number ${orderId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (existingOrder.status === RequestState.APPROVED) {
        throw new HttpException(
          `Sales Order already approved`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (!Object.keys(updateSalesOrderDto).length) {
        return {
          status: 'No Updates',
          data: [],
        };
      }

      const requestId = await this.prismaService.request.findUnique({
        where: { id: updateSalesOrderDto.requestId, companyId },
      });

      //console.log(existingOrder);
      if (!requestId) {
        throw new HttpException(
          `Request Order with id number ${updateSalesOrderDto.requestId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }
      return await this.prismaService.$transaction(
        async (prisma) => {
          // Check if any item quantity requires approval
          const totalQuantity = updateSalesOrderDto.itemDetails.reduce(
            (total, item) => total + Number(item.quantity),
            0,
          );
          let salesOrder: SalesOrder;

          if (updateSalesOrderDto.type === OrderType.APPROVAL) {
            if (totalQuantity && totalQuantity > 1000) {
              if (updateSalesOrderDto.approverId) {
                const approver = await prisma.user.findUnique({
                  where: {
                    id: updateSalesOrderDto.approverId,
                    companyId,
                  },
                  include: { approverNotifications: true },
                });

                if (!approver) {
                  throw new HttpException(
                    'Assigned approver does not exist',
                    HttpStatus.NOT_FOUND,
                  );
                }

                // Save the updated request with dynamic data
                salesOrder = await prisma.salesOrder.update({
                  where: { id: existingOrder.id, companyId },
                  data: {
                    SN: updateSalesOrderDto.SN,
                    customerName: updateSalesOrderDto.customerName,
                    shipmentDate: updateSalesOrderDto.shipmentDate,
                    shippingAddress: updateSalesOrderDto.shippingAddress,
                    shippingCharges: updateSalesOrderDto.shippingCharges,
                    priceListName: updateSalesOrderDto.priceListName,
                    discount: updateSalesOrderDto.discount,
                    priority: updateSalesOrderDto.priority,
                    totalItems: updateSalesOrderDto.totalItems,
                    totalPrice: updateSalesOrderDto.totalPrice,
                    state: updateSalesOrderDto.state,
                    status: RequestState.APPROVED,
                    approved: true,
                    type: updateSalesOrderDto.type,
                    openedBy: user.primaryContactName,
                    itemDetails: updateSalesOrderDto?.itemDetails.map(
                      (item) => ({
                        productId: item?.productId,
                        productName: item.productName,
                        unitType: item.unitType,
                        quantity: item.quantity,
                        warehouseName: item.warehouseName,
                        amount: item.amount,
                        rate: item.rate,
                        unit: item.unit,
                        baseQty: item.baseQty,
                      }),
                    ),
                    companyId,
                  },
                });

                // Update committed stock and opening stock
                await this.updateStock(
                  updateSalesOrderDto.itemDetails,
                  companyId,
                  salesOrder,
                  prisma,
                );

                // Retrieve existing notification for the given approver and sales order
                let existingNotification =
                  await prisma.approvalNotifications.findFirst({
                    where: {
                      approverId: approver.id,
                      salesOrderId: salesOrder.id,
                    },
                  });

                // If notification doesn't exist, create one
                if (!existingNotification) {
                  existingNotification =
                    await prisma.approvalNotifications.create({
                      data: {
                        message: `New sales order ${salesOrder.SN} needs approval.`,
                        companyId,
                        userId: user.id,
                        approverId: approver.id,
                        salesOrderId: salesOrder.id,
                        notifierId: approver.id,
                        type: 'SalesOrderApproval',
                      },
                      include: { salesOrder: true },
                    });
                }

                let appNotification = await prisma.inAppNotifications.findFirst(
                  {
                    where: {
                      receiverId: approver.id,
                      salesOrderId: salesOrder.id,
                      type: 'SalesOrderApproval',
                    },
                  },
                );

                if (!appNotification) {
                  appNotification = await prisma.inAppNotifications.create({
                    data: {
                      message: `New sales order ${salesOrder.SN} needs approval`,
                      companyId,
                      receiverId: approver.id,
                      salesOrderId: salesOrder.id,
                      senderId: user.id,
                      type: 'SalesOrderApproval',
                    },
                    include: { salesOrder: true },
                  });
                }

                await this.eventsGateway.sendNotificationToUser(
                  approver.id,
                  appNotification,
                  prisma,
                );

                await this.mailService.salesOrderNotifications(
                  existingNotification,
                  approver,
                  user,
                  salesOrder,
                );

                await prisma.request.update({
                  where: {
                    id: updateSalesOrderDto.requestId,
                  },
                  data: {
                    state: RequestState.COMPLETED,
                    companyId,
                  },
                });

                return {
                  status: 'Successfully Updated',
                  data: salesOrder,
                };
              } else if (updateSalesOrderDto.departmentIds) {
                let existingDepartments: any[] = [];

                //checks and ensure departmentId is always an array
                const departmentIdArray = Array.isArray(
                  updateSalesOrderDto.departmentIds,
                )
                  ? updateSalesOrderDto.departmentIds
                  : [updateSalesOrderDto.departmentIds];

                // Check if the departments exist
                existingDepartments = await prisma.department.findMany({
                  where: { id: { in: departmentIdArray } },
                });

                if (existingDepartments.length !== departmentIdArray.length) {
                  const missingDepartmentIds = departmentIdArray.filter(
                    (id) =>
                      !existingDepartments.some(
                        (department) => department.id === id,
                      ),
                  );
                  throw new HttpException(
                    `Departments with IDs ${missingDepartmentIds.join(
                      ', ',
                    )} not found`,
                    HttpStatus.NOT_FOUND,
                  );
                }

                salesOrder = await prisma.salesOrder.update({
                  where: { id: orderId, companyId },
                  data: {
                    SN: updateSalesOrderDto.SN,
                    customerName: updateSalesOrderDto.customerName,
                    shipmentDate: updateSalesOrderDto.shipmentDate,
                    shippingAddress: updateSalesOrderDto.shippingAddress,
                    shippingCharges: updateSalesOrderDto.shippingCharges,
                    priceListName: updateSalesOrderDto.priceListName,
                    discount: updateSalesOrderDto.discount,
                    priority: updateSalesOrderDto.priority,
                    totalItems: updateSalesOrderDto.totalItems,
                    totalPrice: updateSalesOrderDto.totalPrice,
                    state: updateSalesOrderDto.state,
                    status: RequestState.PENDING,
                    type: updateSalesOrderDto.type,
                    openedBy: user.primaryContactName,
                    itemDetails: updateSalesOrderDto?.itemDetails.map(
                      (item) => ({
                        productId: item?.productId,
                        productName: item.productName,
                        unitType: item.unitType,
                        quantity: item.quantity,
                        warehouseName: item.warehouseName,
                        amount: item.amount,
                        rate: item.rate,
                        unit: item.unit,
                        baseQty: item.baseQty,
                      }),
                    ),
                    companyId,
                  },
                });

                await this.updateStock(
                  updateSalesOrderDto.itemDetails,
                  companyId,
                  salesOrder,
                  prisma,
                );

                // Associate the task with each department
                await Promise.all(
                  existingDepartments.map(async (department) => {
                    const departments = await prisma.department.update({
                      where: { id: department.id, companyId },
                      data: { salesOrder: { connect: { id: salesOrder.id } } },
                      include: { users: true },
                    });

                    // Notify each user in the department
                    await Promise.all(
                      departments.users.map(async (userInDepartment) => {
                        // Retrieve existing notification for the given approver and sales order
                        let existingNotification =
                          await prisma.approvalNotifications.findFirst({
                            where: {
                              approverId: userInDepartment.id,
                              salesOrderId: salesOrder.id,
                            },
                          });

                        if (!existingNotification) {
                          existingNotification =
                            await prisma.approvalNotifications.create({
                              data: {
                                message: `New sales order ${salesOrder.SN} needs approval.`,
                                companyId,
                                userId: user.id,
                                approverId: userInDepartment.id,
                                salesOrderId: salesOrder.id,
                                notifierId: userInDepartment.id,
                                type: 'SalesOrderApproval',
                              },
                              include: { salesOrder: true },
                            });
                        }

                        const appNotification =
                          await prisma.inAppNotifications.create({
                            data: {
                              message: `New sales order ${salesOrder.SN} needs approval`,
                              companyId,
                              receiverId: userInDepartment.id,
                              salesOrderId: salesOrder.id,
                              senderId: user.id,
                              type: 'SalesOrderApproval',
                            },
                            include: { salesOrder: true },
                          });

                        await this.eventsGateway.sendNotificationToUser(
                          userInDepartment.id,
                          appNotification,
                          prisma,
                        );
                        await this.mailService.salesOrderNotifications(
                          existingNotification,
                          userInDepartment,
                          user,
                          salesOrder,
                        );
                      }),
                    );
                  }),
                );

                await prisma.request.update({
                  where: {
                    id: updateSalesOrderDto.requestId,
                  },
                  data: {
                    state: RequestState.COMPLETED,
                    companyId,
                  },
                });

                return {
                  status: 'Successfully Updated',
                  data: salesOrder,
                };
              }
            } else {
              salesOrder = await this.updateSalesOrderWithoutApproval(
                companyId,
                existingOrder,
                updateSalesOrderDto,
                prisma,
              );

              return {
                status: 'Success',
                message: 'Sales Order updated successfully',
                data: salesOrder,
              };
            }
          }
          salesOrder = await prisma.salesOrder.update({
            where: { id: orderId, companyId },
            data: {
              ...updateSalesOrderDto,
              status: RequestState.APPROVED,
              approved: true,
              itemDetails: updateSalesOrderDto?.itemDetails.map((item) => ({
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
              companyId,
            },
          });

          return {
            status: 'Successfully Updated Draft',
            data: salesOrder,
          };
        },
        { isolationLevel: 'Serializable', timeout: 60000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating sales order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  // async updateSalesOrderFields(
  //   userId: number,
  //   orderId: number,
  //   updateSalesOrderDto: UpdateSalesOrderDto,
  // ): Promise<any> {
  //   try {
  //     const user = await this.usersservice.findUserWithRelationships(userId);
  //     const companyId =
  //       user.adminCompanyId?.adminID || user.employeeId?.companyId;

  //     const existingOrder = await this.prismaService.salesOrder.findUnique({
  //       where: { id: orderId, companyId },
  //     });

  //     if (!existingOrder) {
  //       throw new HttpException(
  //         `Sales Order with id number ${orderId} not found`,
  //         HttpStatus.NOT_FOUND,
  //       );
  //     }

  //     if (!Object.keys(updateSalesOrderDto).length) {
  //       return {
  //         status: 'No Updates',
  //         data: [],
  //       };
  //     }

  //     const requestId = await this.prismaService.request.findUnique({
  //       where: { id: updateSalesOrderDto.requestId, companyId },
  //     });

  //     //console.log(existingOrder);
  //     if (!requestId) {
  //       throw new HttpException(
  //         `Request Order with id number ${updateSalesOrderDto.requestId} not found`,
  //         HttpStatus.NOT_FOUND,
  //       );
  //     }

  //     let salesOrder: SalesOrder;

  //     if (updateSalesOrderDto.type === OrderType.APPROVAL) {
  //       if (updateSalesOrderDto.approverId) {
  //         const approver = await this.prismaService.user.findUnique({
  //           where: {
  //             id: updateSalesOrderDto.approverId,
  //             companyId,
  //           },
  //           include: { approverNotifications: true },
  //         });

  //         if (!approver) {
  //           throw new HttpException(
  //             'Assigned approver does not exist',
  //             HttpStatus.NOT_FOUND,
  //           );
  //         }

  //         // Update committed stock and opening stock

  //         // await this.updateStock(updateSalesOrderDto.itemDetails, companyId);

  //         console.log('creating or updating...');
  //         // Save the updated request with dynamic data
  //         salesOrder = await this.prismaService.salesOrder.update({
  //           where: { id: orderId, companyId },
  //           data: {
  //             SN: updateSalesOrderDto.SN,
  //             customerName: updateSalesOrderDto.customerName,
  //             shipmentDate: updateSalesOrderDto.shipmentDate,
  //             shippingAddress: updateSalesOrderDto.shippingAddress,
  //             shippingCharges: updateSalesOrderDto.shippingCharges,
  //             priceListName: updateSalesOrderDto.priceListName,
  //             discount: updateSalesOrderDto.discount,
  //             priority: updateSalesOrderDto.priority,
  //             totalItems: updateSalesOrderDto.totalItems,
  //             totalPrice: updateSalesOrderDto.totalPrice,
  //             state: updateSalesOrderDto.state,
  //             status: RequestState.PENDING,
  //             type: updateSalesOrderDto.type,
  //             openedBy: user.primaryContactName,
  //             itemDetails: updateSalesOrderDto?.itemDetails.map((item) => ({
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
  //             companyId,
  //           },
  //         });

  //         // Retrieve existing notification for the given approver and sales order
  //         let existingNotification =
  //           await this.prismaService.approvalNotifications.findFirst({
  //             where: {
  //               approverId: approver.id,
  //               salesOrderId: salesOrder.id,
  //             },
  //           });

  //         // If notification doesn't exist, create one
  //         if (!existingNotification) {
  //           existingNotification =
  //             await this.prismaService.approvalNotifications.create({
  //               data: {
  //                 message: `New sales order ${salesOrder.SN} needs approval.`,
  //                 companyId,
  //                 userId: user.id,
  //                 approverId: approver.id,
  //                 salesOrderId: salesOrder.id,
  //                 notifierId: approver.id,
  //                 type: 'SalesOrderApproval',
  //               },
  //               include: { salesOrder: true },
  //             });
  //         }

  //         const appNotification =
  //           await this.prismaService.inAppNotifications.create({
  //             data: {
  //               message: `New sales order ${salesOrder.SN} needs approval`,
  //               companyId,
  //               receiverId: approver.id,
  //               salesOrderId: salesOrder.id,
  //               senderId: user.id,
  //               type: 'SalesOrderApproval',
  //             },
  //             include: { salesOrder: true },
  //           });

  //         this.eventsGateway.sendNotificationToUser(
  //           approver.id,
  //           appNotification,
  //         );
  //         await this.mailService.salesOrderNotifications(
  //           existingNotification,
  //           approver,
  //           user,
  //           salesOrder,
  //         );

  //         await this.prismaService.request.update({
  //           where: {
  //             id: updateSalesOrderDto.requestId,
  //           },
  //           data: {
  //             state: RequestState.COMPLETED,
  //             companyId,
  //           },
  //         });

  //         return {
  //           status: 'Successfully Updated',
  //           data: salesOrder,
  //         };
  //       } else if (updateSalesOrderDto.departmentIds) {
  //         let existingDepartments: any[] = [];

  //         //checks and ensure departmentId is always an array
  //         const departmentIdArray = Array.isArray(
  //           updateSalesOrderDto.departmentIds,
  //         )
  //           ? updateSalesOrderDto.departmentIds
  //           : [updateSalesOrderDto.departmentIds];

  //         // Check if the departments exist
  //         existingDepartments = await this.prismaService.department.findMany({
  //           where: { id: { in: departmentIdArray } },
  //         });

  //         if (existingDepartments.length !== departmentIdArray.length) {
  //           const missingDepartmentIds = departmentIdArray.filter(
  //             (id) =>
  //               !existingDepartments.some((department) => department.id === id),
  //           );
  //           throw new HttpException(
  //             `Departments with IDs ${missingDepartmentIds.join(
  //               ', ',
  //             )} not found`,
  //             HttpStatus.NOT_FOUND,
  //           );
  //         }

  //         //await this.updateStock(updateSalesOrderDto.itemDetails, companyId);

  //         salesOrder = await this.prismaService.salesOrder.update({
  //           where: { id: orderId, companyId },
  //           data: {
  //             SN: updateSalesOrderDto.SN,
  //             customerName: updateSalesOrderDto.customerName,
  //             shipmentDate: updateSalesOrderDto.shipmentDate,
  //             shippingAddress: updateSalesOrderDto.shippingAddress,
  //             shippingCharges: updateSalesOrderDto.shippingCharges,
  //             priceListName: updateSalesOrderDto.priceListName,
  //             discount: updateSalesOrderDto.discount,
  //             priority: updateSalesOrderDto.priority,
  //             totalItems: updateSalesOrderDto.totalItems,
  //             totalPrice: updateSalesOrderDto.totalPrice,
  //             state: updateSalesOrderDto.state,
  //             status: RequestState.PENDING,
  //             type: updateSalesOrderDto.type,
  //             openedBy: user.primaryContactName,
  //             itemDetails: updateSalesOrderDto?.itemDetails.map((item) => ({
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
  //             companyId,
  //           },
  //         });

  //         // Associate the task with each department
  //         await Promise.all(
  //           existingDepartments.map(async (department) => {
  //             const departments = await this.prismaService.department.update({
  //               where: { id: department.id, companyId },
  //               data: { salesOrder: { connect: { id: salesOrder.id } } },
  //               include: { users: true },
  //             });

  //             // Notify each user in the department
  //             await Promise.all(
  //               departments.users.map(async (userInDepartment) => {
  //                 // Retrieve existing notification for the given approver and sales order
  //                 let existingNotification =
  //                   await this.prismaService.approvalNotifications.findFirst({
  //                     where: {
  //                       approverId: userInDepartment.id,
  //                       salesOrderId: salesOrder.id,
  //                     },
  //                   });

  //                 if (!existingNotification) {
  //                   existingNotification =
  //                     await this.prismaService.approvalNotifications.create({
  //                       data: {
  //                         message: `New sales order ${salesOrder.SN} needs approval.`,
  //                         companyId,
  //                         userId: user.id,
  //                         approverId: userInDepartment.id,
  //                         salesOrderId: salesOrder.id,
  //                         notifierId: userInDepartment.id,
  //                         type: 'SalesOrderApproval',
  //                       },
  //                       include: { salesOrder: true },
  //                     });
  //                 }

  //                 const appNotification =
  //                   await this.prismaService.inAppNotifications.create({
  //                     data: {
  //                       message: `New sales order ${salesOrder.SN} needs approval`,
  //                       companyId,
  //                       receiverId: userInDepartment.id,
  //                       salesOrderId: salesOrder.id,
  //                       senderId: user.id,
  //                       type: 'SalesOrderApproval',
  //                     },
  //                     include: { salesOrder: true },
  //                   });

  //                 this.eventsGateway.sendNotificationToUser(
  //                   userInDepartment.id,
  //                   appNotification,
  //                 );
  //                 await this.mailService.salesOrderNotifications(
  //                   existingNotification,
  //                   userInDepartment,
  //                   user,
  //                   salesOrder,
  //                 );
  //               }),
  //             );
  //           }),
  //         );

  //         await this.prismaService.request.update({
  //           where: {
  //             id: updateSalesOrderDto.requestId,
  //           },
  //           data: {
  //             state: RequestState.COMPLETED,
  //             companyId,
  //           },
  //         });

  //         return {
  //           status: 'Successfully Updated',
  //           data: salesOrder,
  //         };
  //       }

  //       // Save the updated request with dynamic data
  //       salesOrder = await this.prismaService.salesOrder.update({
  //         where: { id: orderId, companyId },
  //         data: {
  //           ...updateSalesOrderDto,
  //           status: RequestState.APPROVED,
  //           approved: true,
  //           itemDetails: updateSalesOrderDto?.itemDetails.map((item) => ({
  //             productId: item?.productId,
  //             productName: item.productName,
  //             unitType: item.unitType,
  //             quantity: item.quantity,
  //             warehouseName: item.warehouseName,
  //             amount: item.amount,
  //             rate: item.rate,
  //             unit: item.unit,
  //             baseQty: item.baseQty,
  //           })),
  //           companyId,
  //         },
  //       });

  //       await this.prismaService.request.update({
  //         where: {
  //           id: updateSalesOrderDto.requestId,
  //         },
  //         data: {
  //           state: RequestState.COMPLETED,
  //           companyId,
  //         },
  //       });

  //       return {
  //         status: 'Successfully Updated Order',
  //         data: salesOrder,
  //       };
  //     }
  //   } catch (error) {
  //     if (error instanceof Prisma.PrismaClientValidationError) {
  //       throw new HttpException(
  //         'An error occurred while updating sales order',
  //         HttpStatus.BAD_REQUEST,
  //       );
  //     }
  //     throw error;
  //   }
  // }

  async cancelSalesOrder(userId: number, orderId: number, comment: string) {
    try {
      await this.prismaService.$transaction(
        async (prisma) => {
          const user =
            await this.usersservice.findUserWithRelationships(userId);
          const companyId =
            user.adminCompanyId?.adminID || user.employeeId?.companyId;

          // Retrieve the sales details including the items sold
          const salesOrder = await prisma.salesOrder.findUnique({
            where: { id: orderId, companyId },
          });

          if (!salesOrder) {
            throw new HttpException(
              'Sales Order not found',
              HttpStatus.NOT_FOUND,
            );
          }

          if (salesOrder.status === RequestState.CANCELLED) {
            throw new HttpException(
              'Sales Order already cancelled',
              HttpStatus.BAD_REQUEST,
            );
          }

          if (salesOrder.status === RequestState.COMPLETED) {
            throw new HttpException(
              'Sales Order already invoiced',
              HttpStatus.BAD_REQUEST,
            );
          }

          // Restore the inventory by adding back the quantities of items sold
          await this.returnStock(salesOrder.itemDetails, companyId, prisma);

          // Update the status of the request to "Canceled"
          const order = await prisma.salesOrder.update({
            where: { id: orderId },
            data: { status: RequestState.CANCELLED, comment },
          });

          // Delete batch logs associated with the sales order
          await prisma.batchLog.deleteMany({
            where: {
              saleOrderId: orderId,
              companyId,
              status: 'PENDING',
            },
          });

          const appNotification = await prisma.inAppNotifications.create({
            data: {
              message: `Sales with serial number: ${order.SN} has been cancelled.`,
              companyId,
              receiverId: user.id,
              salesOrderId: order.id,
              senderId: user.id,
              type: 'CancelledSalesOrder',
            },
            include: { salesOrder: true },
          });

          await this.eventsGateway.sendNotificationToUser(
            user.id,
            appNotification,
            prisma,
          );
        },
        { isolationLevel: 'Serializable' },
      );
      return {
        status: 'Success',
        message: 'Sales order canceled successfully',
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

  async returnStock(
    itemDetails,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      await Promise.all(
        itemDetails.map(async (item) => {
          const product = await prisma.product.findUnique({
            where: { id: Number(item.productId), companyId },
            include: {
              stocks: {
                where: { warehouseName: item.warehouseName },
                orderBy: { createdAt: 'asc' },
              },
            },
          });

          // Track returned quantity
          let returnedQuantity = Number(item.quantity);

          for (const stock of product.stocks) {
            // Check if the stock has committed quantity to return
            if (returnedQuantity > 0 && Number(stock.committedQuantity) > 0) {
              const quantityToReturn = Math.min(
                returnedQuantity,
                Number(stock.committedQuantity),
              );

              // Update stock in the database
              await prisma.stock.update({
                where: { id: stock.id },
                data: {
                  openingStock: String(
                    Number(stock.openingStock) + quantityToReturn,
                  ), // Increase opening stock by the quantity returned
                  committedQuantity:
                    Number(stock.committedQuantity) - quantityToReturn, // Decrease committed quantity
                },
              });

              returnedQuantity -= quantityToReturn; // Update returned quantity

              if (returnedQuantity === 0) {
                // If returned quantity becomes zero, exit loop
                break;
              }
            }
          }

          // Check if the entire quantity is returned
          if (returnedQuantity > 0) {
            // Throw error if quantity is still not returned after checking all batches
            throw new HttpException(
              `Unable to return all quantities for product ${product.name}`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }),
      );
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while returning stock',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getAllSalesOrderStatsByFiltering(
    userId: number,
    startDate: DateTime,
    endDate: DateTime,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Calculate the start of the day (00:00:00) in the appropriate time zone
      const startOfDay = startDate.startOf('day');

      // Calculate the end of the day (23:59:59.999) in the appropriate time zone
      const endOfDay = endDate.endOf('day');

      const salesOrder = await this.prismaService.salesOrder.findMany({
        where: {
          companyId,
          AND: [
            { createdAt: { gte: startOfDay.toJSDate() } },
            { createdAt: { lt: endOfDay.toJSDate() } },
          ],
        },
        include: {
          request: { where: { companyId } },
          invoices: { where: { companyId } },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      let draft = 0;
      let pending = 0;
      let approved = 0;
      let rejected = 0;
      let completed = 0;
      let invoice = 0;

      salesOrder.forEach((order) => {
        switch (order.status) {
          case 'PENDING':
            pending++;
            break;
          case 'APPROVED':
            approved++;
            break;
          case 'REJECT':
            rejected++;
            break;
          case 'COMPLETED':
            completed++;
            break;
        }
      });

      salesOrder.forEach((order) => {
        switch (order.type) {
          case 'DRAFT':
            draft++;
            break;
        }
      });

      // Count the number of invoices
      invoice = salesOrder.reduce(
        (total, order) => total + order.invoices.length,
        0,
      );

      return {
        status: 'Success',
        message: 'Sales Order stats successfully retrieved',
        data: {
          draft,
          pending,
          approved,
          rejected,
          completed,
          invoice,
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

  /************************ SALES ORDER END*****************************/

  /************************ PURCHASE ORDER START*****************************/

  async CreatePurchaseOrder(
    createPurchaseOrderDto: CreatePurchaseOrderDto,
    userId: number,
  ) {
    try {
      return await this.prismaService.$transaction(async (prisma) => {
        const user = await this.usersservice.findUserWithRelationships(userId);
        const companyId =
          user.adminCompanyId?.adminID || user.employeeId?.companyId;

        // Validate supplier
        const supplier = await prisma.supplier.findUnique({
          where: { id: createPurchaseOrderDto.supplierId, companyId },
        });

        if (!supplier) {
          throw new HttpException(
            `Supplier with name ${createPurchaseOrderDto.supplierName} not found`,
            HttpStatus.NOT_FOUND,
          );
        }

        // Validate request
        const request = await prisma.request.findUnique({
          where: { id: createPurchaseOrderDto.requestId, companyId },
        });

        if (!request) {
          throw new HttpException(`Invalid request ID`, HttpStatus.NOT_FOUND);
        }

        // Validate products
        await this.validateProducts(createPurchaseOrderDto.itemDetails, prisma);

        // Validate price list
        if (createPurchaseOrderDto.priceListId) {
          await this.validatePriceList(
            createPurchaseOrderDto,
            companyId,
            prisma,
          );
        }

        // Check for existing purchase order
        await this.checkExistingPurchaseOrder(
          createPurchaseOrderDto.SN,
          companyId,
          prisma,
        );

        // Create purchase order
        const purchaseOrder = await this.createPurchaseOrder(
          createPurchaseOrderDto,
          user,
          supplier,
          companyId,
          prisma,
        );

        // Update request state
        await this.updateRequestState(
          createPurchaseOrderDto.requestId,
          companyId,
          prisma,
        );

        // Finalize serial number
        if (purchaseOrder) {
          await this.finaliseSerialNumber.markSerialNumber(
            createPurchaseOrderDto.SN,
            companyId,
          );
        }

        return {
          status: 'Success',
          message: 'Purchase Order created successfully',
          data: purchaseOrder,
        };
      });
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating purchase order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async validateProducts(
    itemDetails,
    prisma: Prisma.TransactionClient,
  ) {
    const uniqueProducts = new Set();
    await Promise.all(
      itemDetails.map(async (item) => {
        //Check for uniqueness
        if (uniqueProducts.has(item.productId)) {
          throw new HttpException(
            `Duplicate product Details: ${item.productName}`,
            HttpStatus.BAD_REQUEST,
          );
        }
        uniqueProducts.add(item.productId);
        const product = await prisma.product.findUnique({
          where: { id: Number(item.productId) },
        });

        if (!product) {
          throw new HttpException(
            `Invalid product ID: ${item.productId}`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }),
    );
  }

  private async validatePriceList(
    createPurchaseOrderDto: CreatePurchaseOrderDto,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    const priceList = await prisma.priceList.findUnique({
      where: { id: createPurchaseOrderDto.priceListId, companyId },
      include: { products: { where: { companyId } } },
    });

    if (!priceList) {
      throw new HttpException(`PriceList not found`, HttpStatus.NOT_FOUND);
    }

    const missingProductIds = createPurchaseOrderDto.productIds.filter(
      (productId) =>
        !priceList.products.some((product) => product.id === productId),
    );

    if (missingProductIds.length > 0) {
      throw new HttpException(
        `Products with IDs ${missingProductIds.join(', ')} not found in the PriceList`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async checkExistingPurchaseOrder(
    SN: string,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    const existingPurchaseOrder = await prisma.purchaseOrder.findFirst({
      where: { SN, companyId },
    });

    if (existingPurchaseOrder) {
      throw new HttpException(
        `Purchase order already created with this number ${SN}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async createPurchaseOrder(
    createPurchaseOrderDto: CreatePurchaseOrderDto,
    user: any,
    supplier: any,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    const purchaseOrderData = {
      SN: createPurchaseOrderDto.SN,
      supplierName: createPurchaseOrderDto.supplierName,
      supplierId: supplier.id,
      shipmentDate: createPurchaseOrderDto.shipmentDate,
      requestId: createPurchaseOrderDto.requestId,
      location: createPurchaseOrderDto.location,
      shippingAddress: createPurchaseOrderDto.shippingAddress,
      shippingCharges: createPurchaseOrderDto.shippingCharges,
      priceListName: createPurchaseOrderDto.priceListName,
      discount: createPurchaseOrderDto.discount,
      priority: createPurchaseOrderDto.priority,
      totalItems: createPurchaseOrderDto.totalItems,
      totalPrice: createPurchaseOrderDto.totalPrice,
      state: createPurchaseOrderDto.state,
      approved: true,
      status: createPurchaseOrderDto.status
        ? createPurchaseOrderDto.status
        : OrderStatus.APPROVED,
      type: createPurchaseOrderDto.type,
      openedBy: user.primaryContactName,
      product: {
        connect: createPurchaseOrderDto.itemDetails.map((p) => ({
          id: Number(p.productId),
        })),
      },
      itemDetails: createPurchaseOrderDto.itemDetails.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        unitType: item.unitType,
        quantity: item.quantity,
        amount: item.amount,
        rate: item.rate,
        unit: item.unit,
        baseQty: item.baseQty,
      })),
      companyId,
    };

    if (createPurchaseOrderDto.type === OrderType.DRAFT) {
      if (createPurchaseOrderDto.assignedToId) {
        await this.validateAssignedUser(
          createPurchaseOrderDto.assignedToId,
          companyId,
          prisma,
        );
      }

      purchaseOrderData['assignedToId'] = createPurchaseOrderDto.assignedToId;
    } else if (createPurchaseOrderDto.departmentIds) {
      await this.validateDepartments(
        createPurchaseOrderDto.departmentIds,
        companyId,
        purchaseOrderData,
        prisma,
      );
    } else {
      await this.validateAssignedUser(
        createPurchaseOrderDto.assignedToId,
        companyId,
        prisma,
      );
      purchaseOrderData['assignedToId'] = createPurchaseOrderDto.assignedToId;
    }

    return await prisma.purchaseOrder.create({
      data: purchaseOrderData,
      //include: { approver: { where: { companyId } } },
    });
  }

  private async validateAssignedUser(
    assignedToId: number,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    const assignedTo = await prisma.user.findUnique({
      where: { id: assignedToId, companyId },
    });

    if (!assignedTo) {
      throw new HttpException(
        'Assigned user does not exist',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async validateDepartments(
    departmentIds: number[],
    companyId: number,
    purchaseOrderData: any,
    prisma: Prisma.TransactionClient,
  ) {
    const departmentIdArray = Array.isArray(departmentIds)
      ? departmentIds
      : [departmentIds];

    const existingDepartments = await prisma.department.findMany({
      where: { id: { in: departmentIdArray } },
    });

    if (existingDepartments.length !== departmentIdArray.length) {
      const missingDepartmentIds = departmentIdArray.filter(
        (id) => !existingDepartments.some((department) => department.id === id),
      );
      throw new HttpException(
        `Departments with IDs ${missingDepartmentIds.join(', ')} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    purchaseOrderData['departmentIds'] = departmentIdArray;
  }

  private async updateRequestState(
    requestId: number,
    companyId: number,
    prisma: Prisma.TransactionClient,
  ) {
    await prisma.request.update({
      where: { id: requestId },
      data: { state: RequestState.COMPLETED, companyId },
    });
  }

  async updateApprovedPurchaseOrder(
    userId: number,
    orderId: number,
    updateOrderDto: UpdatePurchaseOrderDto,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the Order exists
      const existingOrder = await this.prismaService.purchaseOrder.findUnique({
        where: { id: orderId, companyId },
      });

      if (!existingOrder) {
        throw new HttpException(
          `Purchase Order with id number ${orderId} does not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const getNotification =
        await this.prismaService.approvalNotifications.findFirst({
          where: {
            approverId: userId,
            companyId,
            purchaseOrderId: existingOrder.id,
          },
        });

      if (!getNotification) {
        throw new HttpException(
          'No Purchase order notifications found',
          HttpStatus.NOT_FOUND,
        );
      }
      //console.log(getNotification);
      const requestedUser = await this.prismaService.user.findUnique({
        where: { id: getNotification.userId, companyId },
      });
      // Save the updated request
      const updateOrder = await this.prismaService.purchaseOrder.update({
        where: { id: orderId, companyId },
        data: {
          status: updateOrderDto.status,
        },
      });

      if (updateOrderDto.status === RequestState.APPROVED) {
        const notification =
          await this.prismaService.approvalNotifications.update({
            where: {
              id: getNotification.id,
              companyId,
            },
            data: {
              message: `Purchase with serial number: ${updateOrder.SN} has been approved`,
              companyId,
              comment: null,
              userId: requestedUser.id,
              notifierId: requestedUser.id,
              approverId: user.id,
              purchaseOrderId: updateOrder.id,
              type: 'ApprovedPurchaseOrder',
            },
            include: { purchaseOrder: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Purchase with serial number: ${updateOrder.SN} has been approved`,
              companyId,
              receiverId: requestedUser.id,
              purchaseOrderId: updateOrder.id,
              senderId: user.id,
              type: 'ApprovedPurchaseOrder',
            },
            include: { purchaseOrder: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          requestedUser.id,
          appNotification,
        );
        await this.mailService.purchaseApprovalNotifications(
          notification,
          requestedUser,
          user,
          updateOrder,
        );
      } else if (updateOrderDto.status === RequestState.REJECT) {
        const notification =
          await this.prismaService.approvalNotifications.update({
            where: {
              id: getNotification.id,
              companyId,
            },
            data: {
              message: `Purchase with serial number: ${updateOrder.SN} was rejected.`,
              comment: updateOrderDto.comment,
              companyId,
              userId: requestedUser.id,
              notifierId: requestedUser.id,
              approverId: user.id,
              purchaseOrderId: existingOrder.id,
              type: 'RejectedPurchaseOrder',
            },
            include: { purchaseOrder: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `Purchase with serial number: ${updateOrder.SN} was rejected.`,
              companyId,
              receiverId: requestedUser.id,
              purchaseOrderId: existingOrder.id,
              senderId: user.id,
              type: 'RejectedPurchaseOrder',
            },
            include: { purchaseOrder: true },
          });

        await this.eventsGateway.sendNotificationToUser(
          requestedUser.id,
          appNotification,
        );
        await this.mailService.purchaseRejectionNotifications(
          notification,
          requestedUser,
          user,
          updateOrder,
        );
      }

      return {
        status: 'Success',
        data: updateOrder,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating purchase order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getApprovedPurchaseOrder(userId: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const purchaseOrder = await this.prismaService.purchaseOrder.findMany({
        where: { status: RequestState.APPROVED, companyId },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        status: 'Success',
        message: 'Purchase Order retrieved successfully',
        data: purchaseOrder,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching purchase order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getPurchaseOrderById(userId: number, id: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const purchaseOrder = await this.prismaService.purchaseOrder.findUnique({
        where: { id, companyId },
        include: {
          request: { where: { companyId } },
          notifications: { where: { companyId } },
        },
      });

      if (!purchaseOrder) {
        throw new HttpException(
          `Purchase order with id ${id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        status: 'Success',
        message: 'PurchaseOrder retrieved successfully',
        data: purchaseOrder,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching purchase order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getPurchaseOrderDraft(userId: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const purchaseOrder = await this.prismaService.purchaseOrder.findMany({
        where: { type: OrderType.DRAFT, companyId },
        include: { request: { where: { companyId } } },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        status: 'Success',
        message: 'purchase Order retrieved successfully',
        data: purchaseOrder,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching purchase order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async updatePurchaseOrderFields(
    userId: number,
    orderId: number,
    updatePurchaseOrderDto: UpdatePurchaseOrderDto,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const existingOrder = await this.prismaService.purchaseOrder.findUnique({
        where: { id: orderId, companyId },
      });

      //console.log(existingOrder);
      if (!existingOrder) {
        throw new HttpException(
          `Purchase Order with id number ${orderId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const requestId = await this.prismaService.request.findUnique({
        where: { id: updatePurchaseOrderDto.requestId, companyId },
      });

      //console.log(existingOrder);
      if (!requestId) {
        throw new HttpException(
          `Request Order with id number ${updatePurchaseOrderDto.requestId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Create an object to hold the dynamic update data
      const dynamicUpdateData: Record<string, any> = {};

      // Iterate over the fields in updateOrderDto and add them to dynamicUpdateData
      for (const field in updatePurchaseOrderDto) {
        dynamicUpdateData[field] = updatePurchaseOrderDto[field];
      }

      let purchaseOrder: PurchaseOrder;
      if (Object.keys(dynamicUpdateData).length > 0) {
        if (updatePurchaseOrderDto.approverId) {
          const approver = await this.prismaService.user.findUnique({
            where: {
              id: updatePurchaseOrderDto.approverId,
              companyId,
            },
          });

          if (!approver) {
            throw new HttpException(
              'Assigned approver does not exist',
              HttpStatus.NOT_FOUND,
            );
          }
          const request = await this.prismaService.request.findUnique({
            where: { id: updatePurchaseOrderDto.requestId, companyId },
          });

          if (!request) {
            throw new HttpException(`Invalid request ID`, HttpStatus.NOT_FOUND);
          }

          // Save the updated request with dynamic data
          purchaseOrder = await this.prismaService.purchaseOrder.update({
            where: { id: orderId, companyId },
            data: {
              ...dynamicUpdateData,
              status: RequestState.PENDING,
            },
          });

          let existingNotification =
            await this.prismaService.approvalNotifications.findFirst({
              where: {
                approverId: approver.id,
                purchaseOrderId: purchaseOrder.id,
              },
            });

          if (!existingNotification) {
            existingNotification =
              await this.prismaService.approvalNotifications.create({
                data: {
                  message: `New Purchase order ${purchaseOrder.SN} needs approval.`,
                  companyId,
                  userId: user.id,
                  approverId: approver.id,
                  purchaseOrderId: purchaseOrder.id,
                  notifierId: approver.id,
                  type: 'PurchaseOrderApproval',
                },
                include: { purchaseOrder: true },
              });
          }

          const appNotification =
            await this.prismaService.inAppNotifications.create({
              data: {
                message: `New Purchase order ${purchaseOrder.SN} needs approval.`,
                companyId,
                receiverId: approver.id,
                purchaseOrderId: existingOrder.id,
                senderId: user.id,
                type: 'PurchaseOrderApproval',
              },
              include: { purchaseOrder: true },
            });

          await this.eventsGateway.sendNotificationToUser(
            approver.id,
            appNotification,
          );
          await this.mailService.purchaseOrderNotifications(
            existingNotification,
            approver,
            user,
            purchaseOrder,
          );
          await this.prismaService.request.update({
            where: {
              id: updatePurchaseOrderDto.requestId,
            },
            data: {
              state: RequestState.COMPLETED,
              companyId,
            },
          });

          return {
            status: 'Successfully Updated',
            data: purchaseOrder,
          };
        } else if (updatePurchaseOrderDto.departmentIds) {
          let existingDepartments: any[] = [];

          //checks and ensure departmentId is always an array
          const departmentIdArray = Array.isArray(
            updatePurchaseOrderDto.departmentIds,
          )
            ? updatePurchaseOrderDto.departmentIds
            : [updatePurchaseOrderDto.departmentIds];

          // Check if the departments exist
          existingDepartments = await this.prismaService.department.findMany({
            where: { id: { in: departmentIdArray } },
          });

          if (existingDepartments.length !== departmentIdArray.length) {
            const missingDepartmentIds = departmentIdArray.filter(
              (id) =>
                !existingDepartments.some((department) => department.id === id),
            );
            throw new HttpException(
              `Departments with IDs ${missingDepartmentIds.join(
                ', ',
              )} not found`,
              HttpStatus.NOT_FOUND,
            );
          }

          purchaseOrder = await this.prismaService.purchaseOrder.update({
            where: { id: orderId, companyId },
            data: dynamicUpdateData,
          });

          // Associate the task with each department
          await Promise.all(
            existingDepartments.map(async (department) => {
              const departments = await this.prismaService.department.update({
                where: { id: department.id, companyId },
                data: { purchaseOrder: { connect: { id: purchaseOrder.id } } },
                include: { users: true },
              });

              // Notify each user in the department
              await Promise.all(
                departments.users.map(async (userInDepartment) => {
                  const existingNotification =
                    await this.prismaService.approvalNotifications.findFirst({
                      where: {
                        approverId: userInDepartment.id,
                        salesOrderId: purchaseOrder.id,
                      },
                    });

                  if (!existingNotification) {
                    const notification =
                      await this.prismaService.approvalNotifications.create({
                        data: {
                          message: `New Purchase order ${purchaseOrder.SN} needs approval`,
                          companyId,
                          userId: user.id,
                          approverId: userInDepartment.id,
                          purchaseOrderId: purchaseOrder.id,
                          notifierId: userInDepartment.id,
                          type: 'PurchaseOrderApproval',
                        },
                        include: { purchaseOrder: true },
                      });

                    const appNotification =
                      await this.prismaService.inAppNotifications.create({
                        data: {
                          message: `New Purchase order ${purchaseOrder.SN} needs approval`,
                          companyId,
                          receiverId: userInDepartment.id,
                          purchaseOrderId: purchaseOrder.id,
                          senderId: user.id,
                          type: 'PurchaseOrderApproval',
                        },
                        include: { purchaseOrder: true },
                      });

                    await this.eventsGateway.sendNotificationToUser(
                      userInDepartment.id,
                      appNotification,
                    );
                    await this.mailService.purchaseOrderNotifications(
                      notification,
                      userInDepartment,
                      user,
                      purchaseOrder,
                    );
                  }
                }),
              );
            }),
          );

          await this.prismaService.request.update({
            where: {
              id: updatePurchaseOrderDto.requestId,
            },
            data: {
              state: RequestState.COMPLETED,
              companyId,
            },
          });

          return {
            status: 'Successfully Updated',
            data: purchaseOrder,
          };
        }
      } else {
        throw new HttpException(`No fields provided`, HttpStatus.BAD_REQUEST);
      }
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating purchase order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getAllPurchaseOrder(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<PurchaseOrder>> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const purchaseOrder = await paginate(
        this.prismaService.purchaseOrder,
        paginationDto,
        {
          where: { companyId },
          include: {
            request: { where: { companyId } },
            notifications: { where: { companyId } },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      );

      return {
        status: 'Success',
        message: 'Purchase Orders retrieved successfully',
        data: purchaseOrder.data as PurchaseOrder[],
        totalItems: purchaseOrder.totalItems,
        currentPage: purchaseOrder.currentPage,
        totalPages: purchaseOrder.totalPages,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching purchase order',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }
  async getAllOrderConfirmationsWithDetails(userId: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const purchaseOrderConfirmation =
        await this.prismaService.purchaseOrderConfirmation.findMany({
          where: { companyId },
          include: {
            purchaseOrder: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

      return {
        status: 'Success',
        message: 'Confirmation Order retrieved successfully',
        data: purchaseOrderConfirmation,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching purchase order confirmation',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getConfirmationOrderById(userId: number, id: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const confirmOrder =
        await this.prismaService.purchaseOrderConfirmation.findUnique({
          where: { id, companyId },
          include: {
            purchaseOrder: true,
          },
        });

      if (!confirmOrder) {
        throw new HttpException(
          `ConfirmOrder order with id ${id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        status: 'Success',
        message: 'successfully retrived',
        data: confirmOrder,
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching purchase order confirmation',
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
        throw new HttpException(
          'Exceeded maximum attempts to generate unique batch number',
          HttpStatus.BAD_REQUEST,
        );
      }

      console.log(
        `Generating unique batch number for warehouse ${warehouseName}`,
      );
      const timestamps = DateTime.local().toMillis().toString(36);
      const prefix = warehouseName.slice(0, 3).toUpperCase();
      const formattedDate = DateTime.local().toFormat('yyyyLLdd');
      const concatenated = prefix + formattedDate.replace(/-/g, '');
      const timestamp = Date.now().toString(36);
      const randomString = Math.random().toString(36).substring(2, 8);
      // const batchNumber = `${concatenated}-${timestamp}-${randomString}`;

      console.log(`Generated concatenated string: ${concatenated}`);

      const batchNumber = await this.usersservice.generateBatchNumber(
        concatenated,
        'batch',
        userId,
      );

      console.log(`Generated batch number: ${batchNumber}`);

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

      console.log(`Unique batch number ${batchNumber} generated successfully.`);
      return batchNumber;
    } catch (error) {
      console.error('Error generating unique batch number:', error);
      throw error;
    }
  }

  async getAllPurchaseOrderByFiltering(
    userId: number,
    startDate: DateTime,
    endDate: DateTime,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Calculate the start of the day (00:00:00) in the appropriate time zone
      const startOfDay = startDate.startOf('day');

      // Calculate the end of the day (23:59:59.999) in the appropriate time zone
      const endOfDay = endDate.endOf('day');

      const purchaseOrders = await this.prismaService.purchaseOrder.findMany({
        where: {
          companyId,
          AND: [
            { createdAt: { gte: startOfDay.toJSDate() } },
            { createdAt: { lt: endOfDay.toJSDate() } },
          ],
        },
        include: {
          request: { where: { companyId } },
          notifications: { where: { companyId } },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      let totalAmount = 0;
      let totalQuantity = 0;

      // Iterate over each purchase order and calculate total amount and quantity
      purchaseOrders.forEach((purchaseOrder) => {
        const itemDetails: {
          rate: string;
          amount: string;
          quantity: string;
          productId: number;
          productName: string;
          warehouseName: string;
        }[] = purchaseOrder.itemDetails as {
          rate: string;
          amount: string;
          quantity: string;
          productId: number;
          productName: string;
          warehouseName: string;
        }[];

        itemDetails.forEach((item) => {
          totalAmount += Number(item.amount);
          totalQuantity += Number(item.quantity);
        });
      });

      return {
        status: 'Success',
        message: 'Purchase Orders stats successfully retrieved',
        data: {
          totalAmount,
          totalQuantity,
          // purchaseOrders,
        },
      };
    } catch (error) {
      this.logger.error(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching purchase stats',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async sendPurchaseOrderToSupplier(userId: number, id: number): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const purchaseOrder = await this.prismaService.purchaseOrder.findUnique({
        where: { id, companyId },
      });

      if (!purchaseOrder) {
        throw new HttpException(
          `purchaseOrder request with id ${id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const supplierId: number = purchaseOrder.supplierId;
      const supplier = await this.prismaService.supplier.findUnique({
        where: { id: supplierId },
      });

      if (!supplier) {
        throw new HttpException(`Supplier not found`, HttpStatus.NOT_FOUND);
      }

      const itemDetails: {
        rate: string;
        amount: string;
        quantity: string;
        productId: number;
        productName: string;
        warehouseName: string;
      }[] = purchaseOrder.itemDetails as {
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
        <p>S/N: ${purchaseOrder.SN}</p>
        <p>Location: ${purchaseOrder.location}</p>
        <p>Total Price: ${purchaseOrder.totalPrice}</p>
        <p>Supplier Name: ${supplier.companyName ? supplier.companyName : supplier.displayName}</p>
        <p>Supplier Type: ${supplier.supplierType}</p>
        
  
        <p>Thank you for your patronage!</p>
      `;

      if (supplier.companyEmail) {
        // Send email to the customer
        await this.mailService.sendEmailToCustomer(
          supplier.companyEmail,
          `Purchase Order`,
          emailBody,
        );
      } else {
        throw new HttpException(
          `Supplier email address not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        status: 'Success',
        message: 'Purchase order successfully sent',
      };
    } catch (error) {
      this.logger.error(error);
      console.error(
        `Error sending email to supplier: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async createPurchaseOrderConfirmation(
    userId: number,
    createConfirmationDto: CreateOrderConfirmationDto,
  ): Promise<any> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const purchaseOrder = await this.prismaService.purchaseOrder.findUnique({
        where: { id: createConfirmationDto.orderId, companyId },
        include: { supplier: true },
      });

      if (!purchaseOrder) {
        throw new HttpException(
          `Invalid purchase serial number ${createConfirmationDto.orderId}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      await Promise.all(
        createConfirmationDto.itemDetails.map(async (item) => {
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

          let stock = product.stocks.find((stock) => {
            return stock.warehouseName === item.warehouseName.trim();
          });

          if (!stock) {
            this.logger.debug('About to create stock');
            //stock = await this.createStock(companyId, item, user);
          }
        }),
      );

      const transactionResult = await this.prismaService.$transaction(
        async (prisma) => {
          const purchaseOrderConfirmation =
            await prisma.purchaseOrderConfirmation.create({
              data: {
                orderId: purchaseOrder.id,
                purchaseInvoice: createConfirmationDto.purchaseInvoice,
                companyId,
                supplierId: purchaseOrder.supplier.id,
                product: {
                  connect: createConfirmationDto?.itemDetails.map((p) => ({
                    id: Number(p.productId),
                  })),
                },
                itemDetails: createConfirmationDto.itemDetails.map((item) => ({
                  productId: item.productId,
                  productName: item.productName,
                  comment: item.comment,
                  rate: item.rate,
                  received: item.received,
                  unitType: item.unitType,
                  quantity: item.quantity,
                  amount: item.amount,
                  warehouseName: item.warehouseName,
                  unit: item.unit,
                  baseQty: item.baseQty,
                })),
              },
            });

          // Update the purchase order status to COMPLETED
          await prisma.purchaseOrder.update({
            where: {
              id: createConfirmationDto.orderId,
            },
            data: {
              status: RequestState.COMPLETED,
              companyId,
            },
          });

          // Update inventory and handle stock creation within the transaction
          await this.updateInventory(
            createConfirmationDto.itemDetails,
            purchaseOrder,
            companyId,
            user,
            prisma,
          );

          const purchaseTransactions = [];

          // Create or update purchase transactions for each item in the confirmation
          for (const item of createConfirmationDto.itemDetails) {
            const existingTransaction =
              await prisma.purchasesTransaction.findFirst({
                where: {
                  productId: item.productId,
                  warehouseName: item.warehouseName,
                  companyId,
                },
              });

            const existingWarehouse = await prisma.wareHouse.findFirst({
              where: {
                name: {
                  equals: item.warehouseName.trim(),
                  mode: 'insensitive',
                },
                companyId,
              },
            });

            const purchaseTransaction =
              await prisma.purchasesTransaction.create({
                data: {
                  quantity: Number(item.quantity),
                  rate: Number(item.rate),
                  amount: Number(item.amount),
                  productName: item.productName,
                  warehouseName: item.warehouseName,
                  warehouseId: existingWarehouse?.id,
                  productId: item.productId,
                  companyId,
                  supplierId: purchaseOrder.supplier.id,
                  purchaseOrderId: purchaseOrder.id,
                  purchaseRequestId: purchaseOrder.requestId,
                  confirmationId: purchaseOrderConfirmation.id,
                },
              });

            purchaseTransactions.push(purchaseTransaction);
          }

          return {
            status: 'Purchase Confirmation Successful',
            data: purchaseOrderConfirmation,
          };
        },
        { timeout: 200000, isolationLevel: 'Serializable' },
      );

      return transactionResult;
    } catch (error) {
      this.logger.error(error.message);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating purchase order confirmation',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async updateInventory(
    itemDetails: any,
    purchaseOrder: PurchaseOrder,
    companyId: number,
    user: any,
    prisma: Prisma.TransactionClient,
  ) {
    try {
      for (const item of itemDetails) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          include: { stocks: true },
        });

        if (!product) {
          throw new HttpException(
            `Product not found for ID ${item.productId}`,
            HttpStatus.NOT_FOUND,
          );
        }

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
          throw new HttpException(
            `Warehouse not found for stock with warehouseName: ${item.warehouseName}`,
            HttpStatus.NOT_FOUND,
          );
        }

        // Find or create stock for the warehouse
        let stock = product.stocks.find(
          (stock) => stock.warehouseName === item.warehouseName.trim(),
        );

        if (!stock) {
          stock = await this.createStock(
            companyId,
            item,
            user,
            purchaseOrder,
            prisma,
          );
        } else {
          stock = await this.createStock(
            companyId,
            item,
            user,
            purchaseOrder,
            prisma,
          );
        }

        const updatedTotalStock = product.totalStock + Number(item.quantity);
        await prisma.product.update({
          where: { id: product.id },
          data: { totalStock: updatedTotalStock },
        });
      }
    } catch (error) {
      throw error;
    }
  }

  private async createStock(
    companyId: number,
    item: any,
    user: any,
    purchaseOrder: PurchaseOrder,
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
        throw new HttpException(
          `Warehouse not found for stock with warehouseName: ${item.warehouseName} for item ${item.productId}`,
          HttpStatus.NOT_FOUND,
        );
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
          openingStock: String(item.quantity),
          itemName: item.productName,
          warehouseName: warehouse.name.trim(),
          supplierName: purchaseOrder.supplierName,
          batchNumber,
          initialQtyValue: item.quantity,
          purchase: {
            costPrice: item.rate,
          },
          openingStockValue: String(openingStockValue),
          createdBy: user.primaryContactName,
          product: { connect: { id: item.productId } },
          warehouses: { connect: { id: warehouse.id } },
          supplierId: purchaseOrder.supplierId,
        },
        include: { warehouses: true },
      });

      return stock;
    } catch (error) {
      throw error;
    }
  }

  /************************ PURCHASE ORDER END*****************************/
}
