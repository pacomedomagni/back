import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/auth/users/users.service';
import { paginate, PrismaService } from 'src/common';
import { firstValueFrom } from 'rxjs';
import axios from 'axios';
import { CreateEbayDto } from './dto/create-ebay.dto';
import { GetAllResponse } from 'src/common/interface';
import { Integration } from '@prisma/client';
import { PaginationDto } from 'src/common/dto';
import { IntegrationDto } from '../dto/integration.dto';

@Injectable()
export class EbayService {
  private ebayApiUrl = this.configService.get('EBAY_API_URL');
  private readonly logger = new Logger(EbayService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private configService: ConfigService,
  ) {}

  // async getAccessToken(code: string, userId: number): Promise<void> {
  //   try {
  //     const user = await this.usersService.findUserWithRelationships(userId);
  //     const companyId =
  //       user.adminCompanyId?.adminID || user.employeeId?.companyId;

  //     const clientId = this.configService.get('EBAY_CLIENT_ID');
  //     const clientSecret = this.configService.get('EBAY_CLIENT_SECRET');
  //     const redirectUri = this.configService.get('EBAY_REDIRECT_URI');

  //     this.logger.debug(`Sending request to eBay API: ${this.ebayApiUrl}`);

  //     const tokenResponse = await firstValueFrom(
  //       this.httpService.post(
  //         `${this.ebayApiUrl}/identity/v1/oauth2/token`,
  //         new URLSearchParams({
  //           grant_type: 'authorization_code',
  //           code,
  //           redirect_uri: redirectUri,
  //         }).toString(),
  //         {
  //           headers: {
  //             'Content-Type': 'application/x-www-form-urlencoded',
  //             Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
  //           },
  //         },
  //       ),
  //     );
  //     this.logger.debug(`Request headers: ${JSON.stringify(tokenResponse)}`);
  //     const {
  //       access_token,
  //       refresh_token,
  //       expires_in,
  //       refresh_token_expires_in,
  //       token_type,
  //     } = tokenResponse.data;

  //     await this.prismaService.ebayCredential.create({
  //       data: {
  //         access_token,
  //         refresh_token,
  //         expires_in: new Date(Date.now() + expires_in * 1000),
  //         refresh_token_expires_in: new Date(
  //           Date.now() + refresh_token_expires_in * 1000,
  //         ),
  //         token_type,
  //         companyId,
  //         userId,
  //       },
  //     });
  //   } catch (error) {
  //     this.logger.debug(error);
  //     throw error;
  //   }
  // }

  async getAccessToken(
    createEbayDto: CreateEbayDto,
    userId: number,
  ): Promise<void> {
    try {
      const { code, location, storeName } = createEbayDto;
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const clientId = this.configService.get('EBAY_CLIENT_ID');
      const clientSecret = this.configService.get('EBAY_CLIENT_SECRET');
      const redirectUri = this.configService.get('EBAY_REDIRECT_URI');

      const tokenResponse = await axios.post(
        `${this.ebayApiUrl}/identity/v1/oauth2/token`,
        null,
        {
          params: {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
          },
          auth: {
            username: clientId,
            password: clientSecret,
          },
        },
      );

      this.logger.debug(
        `Token response: ${JSON.stringify(tokenResponse.data)}`,
      );

      const {
        access_token,
        refresh_token,
        expires_in,
        refresh_token_expires_in,
        token_type,
      } = tokenResponse.data;

      await this.prismaService.integration.create({
        data: {
          integrationType: 'EBAY',
          credentials: {
            access_token,
            refresh_token,
            expires_in: new Date(Date.now() + expires_in * 1000),
            refresh_token_expires_in: new Date(
              Date.now() + refresh_token_expires_in * 1000,
            ),
            token_type,
          },
          companyId,
          userId,
          storeName,
          location,
        },
      });
    } catch (error) {
      this.logger.debug(error);
      throw error;
    }
  }

  private async refreshToken(
    userId: number,
    integrationId: number,
  ): Promise<void> {
    const integration = await this.prismaService.integration.findFirst({
      where: {
        userId,
        id: integrationId,
        integrationType: 'EBAY',
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
    if (!integration) {
      throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
    }

    const credentials = integration.credentials as any;

    if (new Date(credentials.refresh_token_expires_in) <= new Date()) {
      throw new HttpException(
        'Refresh token expired. User needs to reauthorize.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const clientId = this.configService.get('EBAY_CLIENT_ID');
    const clientSecret = this.configService.get('EBAY_CLIENT_SECRET');

    this.logger.debug('Calling refresh token');

    const tokenResponse = await firstValueFrom(
      this.httpService.post(
        `${this.ebayApiUrl}/identity/v1/oauth2/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: credentials.refresh_token,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          },
        },
      ),
    );

    const { access_token, expires_in } = tokenResponse.data;

    await this.prismaService.integration.update({
      where: { id: integration.id },
      data: {
        credentials: {
          ...credentials,
          access_token,
          expires_in: new Date(Date.now() + expires_in * 1000),
        },
      },
    });
  }

  private async getValidAccessToken(
    userId: number,
    integrationId: number,
  ): Promise<string> {
    const integration = await this.prismaService.integration.findFirst({
      where: {
        userId,
        integrationType: 'EBAY',
        id: integrationId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
    if (!integration) {
      throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
    }

    const credentials = integration.credentials as any;

    this.logger.debug(
      `Access token expiry time: ${new Date(credentials.expires_in)}`,
    );
    this.logger.debug(`Current time: ${new Date()}`);
    this.logger.debug(
      `Is access token valid: ${new Date(credentials.expires_in) > new Date()}`,
    );

    if (new Date(credentials.expires_in) > new Date()) {
      this.logger.debug('Access token is valid, returning the token');
      return credentials.access_token;
    }

    this.logger.debug(
      'Access token has expired, checking refresh token expiry',
    );
    await this.refreshToken(userId, integrationId);

    const updatedIntegration = await this.prismaService.integration.findFirst({
      where: {
        userId,
        integrationType: 'EBAY',
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return (updatedIntegration.credentials as any).access_token;
  }

  async fetchProducts(userId: number, integrationId: number): Promise<any> {
    const accessToken = await this.getValidAccessToken(userId, integrationId);

    const productsResponse = await firstValueFrom(
      this.httpService.get(
        `${this.ebayApiUrl}/sell/inventory/v1/inventory_item`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      ),
    );

    return productsResponse.data;
  }

  async fetchOrders(userId: number, integrationId: number): Promise<any> {
    const accessToken = await this.getValidAccessToken(userId, integrationId);

    const ordersResponse = await firstValueFrom(
      this.httpService.get(`${this.ebayApiUrl}/sell/fulfillment/v1/order`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }),
    );

    return ordersResponse.data;
  }

  async getUserIntegrations(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<Integration>> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const integrations = await paginate(
        this.prismaService.integration,
        paginationDto,
        {
          where: {
            companyId,
          },
          include: {
            user: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      );

      return {
        status: 'Success',
        message: 'Integrations retrieved successfully',
        data: integrations.data as Integration[],
        totalItems: integrations.totalItems,
        currentPage: integrations.currentPage,
        totalPages: integrations.totalPages,
      };
    } catch (error) {
      throw new Error(
        `Failed to fetch integrations for user ${userId}: ${error.message}`,
      );
    }
  }

  // async fetchProducts(userId: number, integrationId: number): Promise<any> {
  //   // Check the local database for products
  //   const products = await this.prismaService.product.findMany({
  //     where: {
  //       integrationId,
  //     },
  //   });

  //   // If products are found, return them
  //   if (products.length > 0) {
  //     return products;
  //   }

  //   // If no products are found, fetch from eBay API
  //   const accessToken = await this.getValidAccessToken(userId, integrationId);

  //   const productsResponse = await firstValueFrom(
  //     this.httpService.get(`${this.ebayApiUrl}/sell/inventory/v1/inventory_item`, {
  //       headers: {
  //         Authorization: `Bearer ${accessToken}`,
  //       },
  //     }),
  //   );

  //   const fetchedProducts = productsResponse.data.inventoryItems;

  //   // Save the fetched products to the local database
  //   await this.prismaService.product.createMany({
  //     data: fetchedProducts.map((product: any) => ({
  //       externalId: product.sku,
  //       name: product.product.title,
  //       description: product.product.description,
  //       price: product.product.price.value,
  //       quantity: product.product.availability.shipToLocationAvailability.quantity,
  //       integrationId,
  //     })),
  //   });

  //   return fetchedProducts;
  // }

  //ORDERS
  // async fetchOrders(userId: number, integrationId: number): Promise<any> {
  //   // Check the local database for orders
  //   const orders = await this.prismaService.order.findMany({
  //     where: {
  //       integrationId,
  //     },
  //   });

  //   // If orders are found, return them
  //   if (orders.length > 0) {
  //     return orders;
  //   }

  //   // If no orders are found, fetch from eBay API
  //   const accessToken = await this.getValidAccessToken(userId, integrationId);

  //   const ordersResponse = await firstValueFrom(
  //     this.httpService.get(`${this.ebayApiUrl}/sell/fulfillment/v1/order`, {
  //       headers: {
  //         Authorization: `Bearer ${accessToken}`,
  //       },
  //     }),
  //   );

  //   const fetchedOrders = ordersResponse.data.orders;

  //   // Save the fetched orders to the local database
  //   await this.prismaService.order.createMany({
  //     data: fetchedOrders.map((order: any) => ({
  //       externalId: order.orderId,
  //       status: order.orderFulfillmentStatus,
  //       totalAmount: order.total.value,
  //       integrationId,
  //     })),
  //   });

  //   return fetchedOrders;
  // }
}
