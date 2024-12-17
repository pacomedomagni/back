import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CreateProductDto, CreateUploadDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CloudinaryService, paginate, PrismaService } from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import { StockDto } from './dto/create-stock.dto';
import { ItemDto } from './dto/create-variance.dto';
import {
  Category,
  Image,
  PackagingMetric,
  Prisma,
  Product,
  Supplier,
  SupplierType,
  User,
} from '@prisma/client';
import { UpdateStockDto } from './dto/update-stock.dto';
import { DateTime } from 'luxon';
import { WinstonLoggerService } from 'src/logger/logger.service';
import { PaginationDto } from 'src/common/dto';
import { GetAllResponse, GetResponse } from 'src/common/interface';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly logger: WinstonLoggerService,
  ) {}

  async createProduct(
    userId: number,
    createProductDto: CreateProductDto,
    files: Array<Express.Multer.File>,
    stockDto: StockDto,
  ) {
    const service = 'createProduct';
    let companyId: number;
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const product = await this.prismaService.product.findFirst({
        where: { name: createProductDto.name, companyId },
      });
      if (product) {
        this.logger.warn(
          `Product with name ${createProductDto.name} already exist`,
          userId,
          service,
        );
        throw new HttpException(
          `Product with name ${createProductDto.name} already exist`,
          HttpStatus.BAD_REQUEST,
        );
      }

      let supplier;
      if (createProductDto.supplierId) {
        supplier = await this.prismaService.supplier.findUnique({
          where: { id: createProductDto.supplierId, companyId },
        });
        if (!supplier) {
          throw new HttpException(
            'Please provide a valid supplier',
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      const warehousePromises = (stockDto.stocks || []).map(async (stock) => {
        const warehouse = await this.prismaService.wareHouse.findFirst({
          where: {
            name: {
              equals: stock.warehouseName.trim(),
              mode: 'insensitive',
            },
            companyId,
          },
        });

        if (!warehouse) {
          this.logger.warn(
            `Warehouse not found for stock with warehouseName: ${stock.warehouseName}`,
            userId,
            service,
          );
          throw new HttpException(
            `Warehouse not found for stock with warehouseName: ${stock.warehouseName}`,
            HttpStatus.NOT_FOUND,
          );
        }

        return warehouse;
      });

      const allWarehouses = await Promise.all(warehousePromises);

      let category = await this.prismaService.category.findFirst({
        where: {
          name: {
            equals: createProductDto.categoryName.trim(),
            mode: 'insensitive',
          },
          companyId,
        },
      });

      // If the category doesn't exist, create it
      if (!category) {
        category = await this.prismaService.category.create({
          data: {
            name: createProductDto.categoryName,
            companyId,
          },
        });
      }

      let metric;
      if (createProductDto.packageMetricId) {
        metric = await this.prismaService.packagingMetric.findUnique({
          where: {
            id: Number(createProductDto.packageMetricId),
            companyId,
          },
        });

        if (!metric) {
          throw new HttpException(
            `Packaging matric not found`,
            HttpStatus.NOT_FOUND,
          );
        }
      }

      const stocks = await Promise.all(
        (stockDto.stocks || []).map(async (stock) => {
          // Find the warehouse for the current stock
          const warehouse = await this.prismaService.wareHouse.findFirst({
            where: {
              name: {
                equals: stock.warehouseName.trim(),
                mode: 'insensitive',
              },
              companyId,
            },
          });

          if (!warehouse) {
            throw new HttpException(
              `Warehouse not found for stock with warehouseName: ${stock.warehouseName}`,
              HttpStatus.NOT_FOUND,
            );
          }

          const batchNumber = await this.generateUniqueBatchNumber(
            companyId,
            warehouse.name,
            user.id,
          );

          // Create the stock with connection to the found warehouse
          return await this.prismaService.stock.create({
            data: {
              companyId,
              openingStock: stock.openingStock,
              openingStockValue: stock.openingStockValue,
              batchNumber,
              sales: stock.sales,
              purchase: stock.purchase,
              initialQtyValue: Number(stock.openingStock),
              itemName: stock.itemName.trim(),
              warehouseName: stock.warehouseName.trim(),
              createdBy: user.primaryContactName,
              warehouses: {
                connect: { id: warehouse.id },
              },
            },
          });
        }),
      );
      // Calculate total opening stock value
      const totalOpeningStockValue = stocks.reduce(
        (total, stock) => total + Number(stock.openingStock),
        0,
      );

      const createdProduct = await this.prismaService.product.create({
        data: {
          companyId,
          name: createProductDto.name,
          unit: createProductDto.unit,
          description: createProductDto.description,
          dimensions: createProductDto.dimensions,
          volume: createProductDto.volume,
          unitType: createProductDto.unitType,
          qtyPKT: createProductDto.qtyPKT,
          weight: createProductDto.weight,
          inventoryTrack: createProductDto.inventoryTrack,
          inventoryAccount: createProductDto.inventoryAccount,
          setInventoryTrack: createProductDto.setInventoryTrack,
          setBaseline: createProductDto.setBaseline,
          baseline: createProductDto.baseline,
          productCode: createProductDto.productCode,
          purchase: createProductDto.purchase,
          sales: createProductDto.sales,
          brand: createProductDto.brand,
          primarySupplier: createProductDto.primarySupplier,
          manufacturer: createProductDto.manufacturer,
          createdBy: user.primaryContactName,
          totalStock: totalOpeningStockValue,
          wareHouses: {
            connect: allWarehouses.map((warehouse) => ({
              id: warehouse.id,
            })),
          },
          stocks: {
            connect: (stocks || [])?.map((stock) => ({
              id: stock.id,
            })),
          },

          image: {
            connect: [],
          },

          categories: {
            connect: { id: category?.id },
          },
          supplierId: supplier?.id ?? null,
          packagingMetricId: metric?.id ?? null,

          // items: {
          //   create: productItems?.map((item) => ({
          //     companyId,
          //     purchase: item?.purchase,
          //     sales: item?.sales,
          //   })),
          // },
        },
        include: { stocks: true, image: true },
      });

      if (Array.isArray(files) && files.length > 0) {
        await this.cloudinaryService.queueFileUpload({
          file: files,
          entityType: 'product',
          entityId: createdProduct.id,
          companyId,
        });
      }

      this.logger.log(
        `Sucessfully created product: ${createdProduct}`,
        userId,
        service,
      );

      return {
        status: 'Success',
        message: 'Product created successfully',
        data: createdProduct,
      };
    } catch (error) {
      this.logger.error(
        'An error occurred while creating product',
        error.stack,
        companyId,
        service,
      );

      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating product',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async uploadProducts(
    userId: number,
    createProductDtos: CreateUploadDto[],
    stockDtos: StockDto[],
  ) {
    const service = 'uploadProductFile';
    let companyId: number;

    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      companyId = user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const productMap = new Map<string, CreateUploadDto>();
      const stockMap = new Map<string, StockDto[]>();

      createProductDtos.forEach((createProductDto) => {
        const productName = createProductDto.name;
        productMap.set(productName, createProductDto);
      });

      stockDtos.forEach((stockDto) => {
        stockDto.stocks.forEach((item) => {
          const productName = item.itemName;
          if (stockMap.has(productName)) {
            stockMap.get(productName).push(stockDto);
          } else {
            stockMap.set(productName, [stockDto]);
          }
        });
      });

      const existingWarehouses = await this.prismaService.wareHouse.findMany({
        where: { companyId },
      });
      const warehouseMap = new Map(
        existingWarehouses.map((warehouse) => [
          warehouse.name.toLowerCase(),
          warehouse,
        ]),
      );

      const results = [];
      let newProductsCreated = false;
      const batchSize = 10;

      const productEntries = Array.from(productMap.entries());
      for (let i = 0; i < productEntries.length; i += batchSize) {
        const batch = productEntries.slice(i, i + batchSize);

        console.log(`Processing batch ${Math.ceil(i / batchSize) + 1}...`);

        for (const [productName, createProductDto] of batch) {
          const existingProduct = await this.prismaService.product.findFirst({
            where: {
              companyId,
              name: {
                equals: productName.trim(),
                mode: 'insensitive',
              },
            },
            include: {
              stocks: true,
              wareHouses: true,
            },
          });

          if (existingProduct) {
            const currentStockDtos = stockMap.get(productName);
            const createdStocks = [];
            const warehouses = [];

            const uniqueWarehouses = new Map<string, boolean>();
            for (const stockDto of currentStockDtos) {
              for (const item of stockDto.stocks) {
                const {
                  warehouseName,
                  openingStock,
                  openingStockValue,
                  sales,
                  purchase,
                } = item;

                // Check if the stock already exists in the warehouse
                // const existingStock = existingProduct.stocks.find(
                //   (stock) =>
                //     stock.itemName.toLowerCase().trim() ===
                //       item.itemName.toLowerCase().trim() &&
                //     stock.warehouseName.toLowerCase().trim() ===
                //       warehouseName.toLowerCase().trim(),
                // );

                const existingStock = existingProduct.stocks.find(
                  (stock) =>
                    stock.itemName.toLowerCase().trim() ===
                      item.itemName.toLowerCase().trim() &&
                    stock.warehouseName.toLowerCase().trim() ===
                      warehouseName.toLowerCase().trim() &&
                    stock.companyId === companyId,
                );

                if (
                  !existingStock &&
                  !uniqueWarehouses.has(warehouseName.toLowerCase())
                ) {
                  let warehouse = warehouseMap.get(warehouseName.toLowerCase());

                  if (!warehouse) {
                    warehouse = await this.prismaService.wareHouse.create({
                      data: {
                        name: warehouseName.trim(),
                        companyId,
                      },
                    });
                    warehouseMap.set(warehouseName.toLowerCase(), warehouse);
                    warehouses.push(warehouse);
                  }

                  const batchNumber = await this.generateUniqueBatchNumber(
                    companyId,
                    warehouse.name,
                    user.id,
                  );
                  const stock = await this.prismaService.stock.create({
                    data: {
                      companyId,
                      openingStock,
                      openingStockValue,
                      sales,
                      purchase,
                      initialQtyValue: Number(openingStock),
                      batchNumber,
                      itemName: item.itemName.trim(),
                      warehouseName: warehouseName.trim(),
                      createdBy: user.primaryContactName,
                      warehouses: {
                        connect: { id: warehouse.id },
                      },
                    },
                  });
                  createdStocks.push(stock);
                  uniqueWarehouses.set(warehouseName.toLowerCase(), true);
                }
              }
            }

            const filteredStocks = createdStocks.filter(
              (stock) => stock !== null,
            );

            const totalStock = filteredStocks
              .flat()
              .reduce(
                (total, stock) => total + Number(stock.openingStock),
                existingProduct.totalStock,
              );

            const updatedProduct = await this.prismaService.product.update({
              where: { id: existingProduct.id },
              data: {
                totalStock,
                wareHouses: {
                  connect: warehouses.map((warehouse) => ({
                    id: warehouse.id,
                    companyId,
                  })),
                },
                stocks: {
                  connect: filteredStocks.map((stock) => ({
                    id: stock.id,
                    companyId,
                  })),
                },
              },
              include: { stocks: true },
            });

            results.push(updatedProduct);
            newProductsCreated = true;
          } else {
            let supplier: Supplier;

            if (createProductDto.primarySupplier) {
              supplier = await this.prismaService.supplier.findFirst({
                where: {
                  companyName: {
                    equals: createProductDto.primarySupplier.trim(),
                    mode: 'insensitive',
                  },
                  companyId,
                },
              });
              if (!supplier) {
                console.log('Supplier not found');
              }
            }

            let category = await this.prismaService.category.findFirst({
              where: {
                name: {
                  equals: createProductDto.categoryName.trim(),
                  mode: 'insensitive',
                },
                companyId,
              },
            });

            if (!category) {
              category = await this.prismaService.category.create({
                data: {
                  name: createProductDto.categoryName.trim(),
                  companyId,
                },
              });
            }

            const warehouses = [];
            const createdStocks = [];

            const currentStockDtos = stockMap.get(productName);
            const uniqueWarehouses = new Map<string, boolean>();
            for (const stockDto of currentStockDtos) {
              for (const item of stockDto.stocks) {
                const {
                  warehouseName,
                  openingStock,
                  openingStockValue,
                  sales,
                  purchase,
                } = item;

                if (!uniqueWarehouses.has(warehouseName.toLowerCase())) {
                  let warehouse = warehouseMap.get(warehouseName.toLowerCase());

                  if (!warehouse) {
                    warehouse = await this.prismaService.wareHouse.create({
                      data: {
                        name: warehouseName.trim(),
                        companyId,
                      },
                    });
                    warehouseMap.set(warehouseName.toLowerCase(), warehouse);
                  }
                  warehouses.push(warehouse);
                  uniqueWarehouses.set(warehouseName.toLowerCase(), true);

                  const batchNumber = await this.generateUniqueBatchNumber(
                    companyId,
                    warehouse.name,
                    user.id,
                  );
                  const stock = await this.prismaService.stock.create({
                    data: {
                      companyId,
                      openingStock,
                      openingStockValue,
                      initialQtyValue: Number(openingStock),
                      sales,
                      purchase,
                      batchNumber,
                      itemName: item.itemName.trim(),
                      warehouseName: warehouseName.trim(),
                      createdBy: user.primaryContactName,
                      warehouses: {
                        connect: { id: warehouse.id },
                      },
                    },
                  });
                  createdStocks.push(stock);
                }
              }
            }

            const filteredStocks = createdStocks.filter(
              (stock) => stock !== null,
            );

            const createdProduct = await this.prismaService.product.create({
              data: {
                companyId,
                name: productName,
                unit: createProductDto.unit,
                description: createProductDto.description,
                dimensions: createProductDto.dimensions,
                volume: createProductDto.volume,
                unitType: createProductDto.unitType,
                qtyPKT: createProductDto.qtyPKT,
                weight: createProductDto.weight,
                inventoryTrack: createProductDto.inventoryTrack,
                inventoryAccount: createProductDto.inventoryAccount,
                setInventoryTrack: createProductDto.setInventoryTrack,
                setBaseline: createProductDto.setBaseline,
                baseline: createProductDto.baseline,
                productCode: createProductDto.productCode,
                purchase: createProductDto.purchase,
                sales: createProductDto.sales,
                brand: createProductDto.brand,
                primarySupplier: supplier
                  ? createProductDto.primarySupplier
                  : null,
                manufacturer: createProductDto.manufacturer,
                createdBy: user.primaryContactName,
                totalStock: filteredStocks
                  .flat()
                  .reduce(
                    (total, stock) => total + Number(stock.openingStock),
                    0,
                  ),
                wareHouses: {
                  connect: warehouses.flat().map((warehouse) => ({
                    id: warehouse.id,
                    companyId,
                  })),
                },
                stocks: {
                  connect: filteredStocks.flat().map((stock) => ({
                    id: stock.id,
                    companyId,
                  })),
                },
                categories: {
                  connect: { id: category?.id, companyId },
                },
                supplierId: supplier?.id ?? null,
              },
              include: { stocks: true },
            });

            results.push(createdProduct);
            newProductsCreated = true;
          }
        }
      }

      if (!newProductsCreated) {
        return {
          status: 'Success',
          message: 'No new products were created',
          data: [],
        };
      }

      return {
        status: 'Success',
        message: `${results.length} Products uploaded successfully`,
        data: results,
      };
    } catch (error) {
      console.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while uploading product',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getAllProducts(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<Product>> {
    const service = 'getAllProducts';
    let companyId: number;
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      if (!companyId) {
        throw new HttpException(
          'Company ID not found for the user',
          HttpStatus.NOT_FOUND,
        );
      }

      const products = await this.prismaService.product.findMany({
        where: { companyId },
        include: {
          stocks: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Check and update total stock for each product
      for (const product of products) {
        await this.checkAndUpdateTotalStock(product.id, companyId);
      }

      const updatedProducts = await paginate(
        this.prismaService.product,
        paginationDto,
        {
          where: { companyId },
          include: {
            image: true,
            stocks: true,
            categories: true,
            supplier: true,
            wareHouses: true,
            packagingMetric: true,
            salesTransaction: true,
            adjustInventory: true,
            purchasesTransaction: true,
            salesOrder: true,
            PurchaseOrder: true,
            salesRequest: true,
            purchaseRequest: true,
            purchaseOrderConfirmation: true,
            invoices: true,
            payment: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      );

      return {
        status: 'Success',
        message: 'Products retrieved successfully',
        data: updatedProducts.data as Product[],
        totalItems: updatedProducts.totalItems,
        currentPage: updatedProducts.currentPage,
        totalPages: updatedProducts.totalPages,
      };
    } catch (error) {
      this.logger.error(
        'Failed to fetch all products',
        error.stack,
        companyId,
        service,
      );
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while getting products',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async deleteProduct(userId: number, productId: number) {
    const service = 'deleteProduct';
    let companyId: number;

    try {
      // Log the initial request to delete the product
      this.logger.log(
        `User ${userId} requested to delete product ${productId}`,
        userId,
        service,
      );

      // Fetch user and determine companyId
      const user = await this.usersService.findUserWithRelationships(userId);
      companyId = user.adminCompanyId?.adminID || user.employeeId?.companyId;

      this.logger.log(
        `User ${userId} is associated with company ${companyId}`,
        companyId,
        service,
      );

      // Check if the product exists and is associated with the correct company
      const product = await this.prismaService.product.findUnique({
        where: { id: productId },
        include: { stocks: true },
      });

      if (!product) {
        this.logger.warn(
          `Product ${productId} not found for company ${companyId}`,
          companyId,
          service,
        );
        throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
      }

      if (product.companyId !== companyId) {
        this.logger.warn(
          `User ${userId} does not have permission to delete product ${productId}`,
          companyId,
          service,
        );
        throw new HttpException(
          'You do not have permission to delete this product',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Log before starting the transaction to delete stocks and product
      this.logger.log(
        `Deleting stocks for product ${productId}`,
        companyId,
        service,
      );

      await this.prismaService.$transaction(async (prisma) => {
        await Promise.all(
          product.stocks.map(async (stock) => {
            await prisma.stock.delete({
              where: { id: stock.id, companyId },
            });
            this.logger.log(
              `Deleted stock ${stock.id} for product ${productId}`,
              companyId,
              service,
            );
          }),
        );

        await prisma.product.delete({
          where: { id: product.id, companyId },
        });
        this.logger.log(`Deleted product ${productId}`, companyId, service);
      });

      this.logger.log(
        `Successfully deleted product ${productId} and associated stocks`,
        companyId,
        service,
      );

      return {
        status: 'Success',
        message: 'Product and associated stocks deleted successfully',
      };
    } catch (error) {
      this.logger.error(
        'Failed to delete product',
        error.stack,
        companyId,
        service,
      );
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'Invalid data provided',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async deleteAllProducts(userId: number) {
    const service = 'deleteAllProducts';
    let companyId: number;

    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      this.logger.log(
        `User ${userId} requested to delete all products`,
        userId,
        service,
      );

      // Use a transaction to ensure atomicity
      await this.prismaService.$transaction(async (prisma) => {
        const productsWithStocks = await prisma.product.findMany({
          where: { companyId },
          include: { stocks: true },
        });

        // Delete each stock associated with the products
        await Promise.all(
          productsWithStocks.flatMap((product) =>
            product.stocks.map((stock) =>
              prisma.stock.delete({
                where: { id: stock.id, companyId },
              }),
            ),
          ),
        );

        // Delete all products
        await prisma.product.deleteMany({
          where: { companyId },
        });
      });

      this.logger.log(
        `Successfully deleted all products and associated stocks`,
        companyId,
        service,
      );

      return {
        status: 'Success',
        message: 'All products and associated stocks deleted successfully',
      };
    } catch (error) {
      this.logger.error(
        'Failed to delete products',
        error.stack,
        companyId,
        service,
      );
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'Invalid data provided',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getProductById(
    userId: number,
    productId: number,
  ): Promise<GetResponse<Product>> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      await this.checkAndUpdateTotalStock(productId, companyId);

      const product = await this.prismaService.product.findUnique({
        where: { id: productId, companyId },
        include: {
          stockBatch: true,
          image: true,
          stocks: true,
          categories: true,
          supplier: true,
          wareHouses: true,
          packagingMetric: true,
          salesTransaction: true,
          adjustInventory: true,
          purchasesTransaction: true,
          salesOrder: true,
          PurchaseOrder: true,
          salesRequest: true,
          purchaseRequest: true,
          purchaseOrderConfirmation: true,
          invoices: true,
          payment: true,
        },
      });

      if (!product) {
        throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
      }

      return {
        status: 'Success',
        data: product,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while getting product',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async checkAndUpdateTotalStock(
    productId: number,
    companyId: number,
  ): Promise<void> {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId, companyId },
      include: { stocks: true },
    });

    if (!product) {
      throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
    }

    const totalOpeningStock: number = product.stocks.reduce(
      (total, stock) => total + Number(stock.openingStock),
      0,
    );

    const totalCommittedQuantity = product.stocks.reduce(
      (acc, curr) => acc + Number(curr.committedQuantity),
      0,
    );

    const totalStock = totalCommittedQuantity + totalOpeningStock;

    if (product.totalStock !== totalStock) {
      // this.logger.debug('different stock');
      await this.prismaService.product.update({
        where: { id: productId },
        data: { totalStock },
      });
    }
  }

  // async updateProduct(
  //   userId: number,
  //   productId: number,
  //   updateProductDto: any,
  // ): Promise<any> {
  //   try {
  //     const user = await this.usersService.findUserWithRelationships(userId);
  //     const companyId =
  //       user.adminCompanyId?.adminID || user.employeeId?.companyId;

  //     // Check if the product exists
  //     const existingProduct = await this.prismaService.product.findUnique({
  //       where: { id: productId, companyId },
  //     });

  //     if (!existingProduct) {
  //       throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
  //     }

  //     // Update the product
  //     const updatedProduct = await this.prismaService.product.update({
  //       where: { id: productId, companyId },
  //       data: {
  //         companyId,
  //         sku: updateProductDto.sku,
  //         name: updateProductDto.name,
  //         volume: updateProductDto.volume,
  //         unitType: updateProductDto.unitType,
  //         qtyPKT: updateProductDto.qtyPKT,
  //         ...updateProductDto,
  //       },
  //       include: {
  //         categories: true,
  //         supplier: true,
  //       },
  //     });

  //     return {
  //       status: 'Successfully updated',
  //       data: updatedProduct,
  //     };
  //   } catch (error) {
  //     if (error instanceof Prisma.PrismaClientValidationError) {
  //       throw new HttpException(
  //         'An error occurred while updating product',
  //         HttpStatus.BAD_REQUEST,
  //       );
  //     }
  //     throw error;
  //   }
  // }

  async editProduct(
    userId: number,
    updateProductDto: UpdateProductDto,
    productId: number,
    files: Array<Express.Multer.File>,
    stockDto: UpdateStockDto,
    itemDto: ItemDto,
  ) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Retrieve the existing product
      const existingProduct = await this.prismaService.product.findUnique({
        where: { id: productId, companyId },
        include: {
          stocks: true,
          image: true,
          categories: true,
          supplier: true,
          wareHouses: true,
        },
      });

      if (!existingProduct) {
        throw new HttpException(
          `Product with id ${productId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      let supplier: Supplier;
      if (updateProductDto.supplierId) {
        supplier = await this.prismaService.supplier.findUnique({
          where: { id: updateProductDto.supplierId, companyId },
        });
        if (!supplier) {
          throw new HttpException(
            'Please provide a valid supplier',
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // Retrieve the new category to connect
      let category: Category;
      if (updateProductDto.categoryId) {
        category = await this.prismaService.category.findFirst({
          where: { id: updateProductDto.categoryId, companyId },
        });

        if (!category) {
          throw new HttpException(
            'Please provide a valid category',
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // If there is an existing category, disconnect it
      if (existingProduct.categories && existingProduct.categories.length > 0) {
        await this.prismaService.product.update({
          where: { id: productId, companyId },
          data: {
            categories: {
              disconnect: existingProduct.categories.map((cat) => ({
                id: cat.id,
              })),
            },
          },
        });
      }

      let metric: PackagingMetric;
      if (updateProductDto.packageMetricId) {
        metric = await this.prismaService.packagingMetric.findUnique({
          where: {
            id: Number(updateProductDto.packageMetricId),
            companyId,
          },
        });

        if (!metric) {
          throw new HttpException(
            `Packaging matric with id ${updateProductDto.packageMetricId} not found`,
            HttpStatus.NOT_FOUND,
          );
        }

        metric = await this.prismaService.packagingMetric.update({
          where: {
            id: Number(updateProductDto.packageMetricId),
            companyId,
          },
          data: {
            packName: updateProductDto.packName,
            unitName: updateProductDto.unitName,
          },
        });
      }

      const warehousePromises = (stockDto.stocks || []).map(async (stock) => {
        const warehouse = await this.prismaService.wareHouse.findFirst({
          where: { name: stock.warehouseName, companyId },
        });

        if (!warehouse) {
          throw new HttpException(
            `Warehouse not found for stock with warehouseName: ${stock.warehouseName}`,
            HttpStatus.NOT_FOUND,
          );
        }

        return warehouse;
      });

      // const warehouses = await Promise.all(warehousePromises);

      // Extract contact IDs from existingSupplier
      //const stockIds = existingProduct.stocks.map((stock) => stock.id);
      //const itemIds = existingProduct.items.map((item) => item.id);

      // Update stocks
      // const updatedStocksPromises = (stockDto.stocks || []).map(
      //   async (stock, index) => {
      //     //console.log('Updating stock....', stockIds[index]);
      //     await this.prismaService.stock.updateMany({
      //       where: { id: stockIds[index], companyId },
      //       data: {
      //         companyId,
      //         openingStock: stock.openingStock,
      //         openingStockValue: stock.openingStockValue,
      //         itemName: stock.itemName,
      //         warehouseName: stock.warehouseName,
      //         createdBy: user.primaryContactName,
      //       },
      //     });
      //   },
      // );

      // await Promise.all(updatedStocksPromises);

      // Calculate total opening stock value
      const totalOpeningStockValue = (stockDto.stocks || []).reduce(
        (total, stock) => total + Number(stock.openingStock),
        0,
      );

      let existingImages: Image[] = [];
      if (existingProduct.image) {
        existingImages = Array.isArray(existingProduct.image)
          ? existingProduct.image
          : [existingProduct.image];
      }

      let imagesLinks = null;
      let createdImages: Image[] = [];

      if (files) {
        // console.log(files);
        imagesLinks = await this.cloudinaryService
          .uploadImages(files)
          .catch((error) => {
            throw new HttpException(error, HttpStatus.BAD_REQUEST);
          });

        // Delete the previous images if they exist
        let imageExist;
        for (const existingImage of existingImages) {
          // console.log(existingImage);
          await this.cloudinaryService.deleteImage(existingImage.publicId);

          // Check if image exists in the database
          imageExist = await this.prismaService.image.findMany({
            where: { id: existingImage.id },
          });
        }

        // Create or update the new images
        createdImages = await Promise.all(
          imagesLinks.map(async (file) => {
            if (imageExist) {
              // Update the existing image
              return await this.prismaService.image.update({
                where: { id: imageExist[0].id },
                data: {
                  publicId: file.public_id,
                  url: file.url,
                  companyId,
                },
              });
            } else {
              // Create a new image
              return await this.prismaService.image.create({
                data: {
                  publicId: file.public_id,
                  url: file.url,
                  companyId,
                },
              });
            }
          }),
        );
      }

      const productWithGroupAndVariances =
        await this.prismaService.product.update({
          where: {
            id: productId,
            companyId,
          },
          data: {
            companyId,
            name: updateProductDto.name ?? existingProduct.name,
            unit: updateProductDto.unit ?? existingProduct.unit,
            dimensions:
              updateProductDto.dimensions ?? existingProduct.dimensions,
            weight: updateProductDto.weight ?? existingProduct.weight,
            description:
              updateProductDto.description ?? existingProduct.description,
            volume: updateProductDto.volume ?? existingProduct.volume,
            unitType: updateProductDto.unitType ?? existingProduct.unitType,
            qtyPKT: updateProductDto.qtyPKT ?? existingProduct.qtyPKT,
            inventoryTrack:
              updateProductDto.inventoryTrack ?? existingProduct.inventoryTrack,
            inventoryAccount:
              updateProductDto.inventoryAccount ??
              existingProduct.inventoryAccount,
            setInventoryTrack:
              updateProductDto.setInventoryTrack ??
              existingProduct.setInventoryTrack,
            setBaseline:
              updateProductDto.setBaseline ?? existingProduct.setBaseline,
            baseline: updateProductDto.baseline ?? existingProduct.baseline,
            productCode:
              updateProductDto.productCode ?? existingProduct.productCode,
            purchase: updateProductDto.purchase ?? existingProduct.purchase,
            sales: updateProductDto.sales ?? existingProduct.sales,
            brand: updateProductDto.brand ?? existingProduct.brand,
            primarySupplier:
              updateProductDto.primarySupplier ??
              existingProduct.primarySupplier,
            manufacturer:
              updateProductDto.manufacturer ?? existingProduct.manufacturer,
            createdBy: user.primaryContactName ?? existingProduct.createdBy,
            totalStock: totalOpeningStockValue ?? existingProduct.totalStock,

            // Warehouses connection
            wareHouses: existingProduct.wareHouses?.length
              ? {
                  connect: existingProduct.wareHouses
                    .filter((warehouse) => warehouse.companyId === companyId) // Ensure valid companyId
                    .map((warehouse) => ({ id: warehouse.id })),
                }
              : undefined,

            // Stocks connection
            stocks: existingProduct.stocks?.length
              ? {
                  connect: existingProduct.stocks
                    .filter((stock) => stock.companyId === companyId) // Ensure valid companyId
                    .map((stock) => ({ id: stock.id, companyId })),
                }
              : undefined,

            // Image connection
            image: createdImages?.length
              ? { connect: createdImages.map((image) => ({ id: image.id })) }
              : undefined,

            // Categories connection
            categories: updateProductDto.categoryId
              ? { connect: { id: updateProductDto.categoryId } }
              : undefined,
          },
        });

      return {
        status: 'Success',
        message: 'Product updated successfully',
        data: productWithGroupAndVariances,
      };
    } catch (error) {
      console.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating product',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async generateUniqueSerialNumber(
    name: string,
    length: number,
  ): Promise<string> {
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = name.toUpperCase() + '-';

    for (let i = 0; i < length; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }

    return result;
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

      const batchNumber = await this.usersService.generateBatchNumber(
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
