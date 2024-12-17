import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as crypto from 'crypto';
import { lastValueFrom } from 'rxjs';
import { PrismaService } from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class ShopifyService {
  private CLIENT_ID = this.configService.get<string>('CLIENT_ID');
  private CLIENT_SECRET = this.configService.get<string>('CLIENT_SECRET');
  private SCOPES = this.configService.get<string>('SHOPIFY_SCOPES');
  private FORWARDING_ADDRESS =
    this.configService.get<string>('FORWARDING_ADDRESS');

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly httpService: HttpService,
    private configService: ConfigService,
  ) {}

  getInstallUrl(shop: string, state: string): string {
    // const redirectUri = `${this.FORWARDING_ADDRESS}/shopify/callback`;
    // return `https://${shop}/admin/oauth/authorize?client_id=${this.CLIENT_ID}&scope=${this.SCOPES}&state=${state}&redirect_uri=${redirectUri}`;

    const redirectUri = this.configService.get<string>('SHOPIFY_REDIRECT_URI');
    const scopes = this.configService.get<string>('SHOPIFY_SCOPES');
    return `https://${shop}/admin/oauth/authorize?client_id=${this.CLIENT_ID}&scope=${scopes}&redirect_uri=${redirectUri}`;
  }

  async getAccessToken(shop: string, code: string): Promise<string> {
    const accessTokenRequestUrl = `https://${shop}/admin/oauth/access_token`;
    console.log('Access Token Request URL:', accessTokenRequestUrl);

    const accessTokenPayload = {
      client_id: this.CLIENT_ID,
      client_secret: this.CLIENT_SECRET,
      code,
    };

    try {
      const response = await axios.post(
        accessTokenRequestUrl,
        accessTokenPayload,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
      console.log(response);
      if (response.status === 200) {
        return response.data.access_token;
      } else {
        console.error(
          'Unexpected response status:',
          response.status,
          response.data,
        );
        throw new Error('Failed to retrieve access token');
      }
    } catch (error) {
      console.error('Axios error:', error);
      throw error;
    }
  }

  verifyHmac(query: any): boolean {
    const { hmac, ...rest } = query;
    const message = new URLSearchParams(rest).toString();
    const generatedHash = crypto
      .createHmac('sha256', this.CLIENT_SECRET)
      .update(message)
      .digest('hex');
    console.log(message, generatedHash, hmac);
    return generatedHash === hmac;
  }

  async storeAccessToken(shop: string, accessToken: string, userId: number) {
    const user = await this.usersService.findUserWithRelationships(userId);
    const companyId =
      user.adminCompanyId?.adminID || user.employeeId?.companyId;
  }

  async getStoredAccessToken(
    shop: string,
    email: string,
    companyId: number,
  ): Promise<string> {
    return '';
  }

  async getProducts(shop: string, userId: number): Promise<any> {
    const user = await this.usersService.findUserWithRelationships(userId);
    const companyId =
      user.adminCompanyId?.adminID || user.employeeId?.companyId;

    const accessToken = await this.getStoredAccessToken(
      shop,
      user.companyEmail,
      companyId,
    );
    console.log(accessToken);
    const response = await lastValueFrom(
      this.httpService.get(`https://${shop}/admin/api/2021-01/products.json`, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
        },
      }),
    );
    return response.data.products;
  }

  async getOrders(shop: string, userId: number): Promise<any> {
    const user = await this.usersService.findUserWithRelationships(userId);
    const companyId =
      user.adminCompanyId?.adminID || user.employeeId?.companyId;

    const accessToken = await this.getStoredAccessToken(
      shop,
      user.companyEmail,
      companyId,
    );
    const response = await lastValueFrom(
      this.httpService.get(`https://${shop}/admin/api/2021-01/orders.json`, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
        },
      }),
    );
    return response.data.orders;
  }

  async createProduct(
    shop: string,
    userId: number,
    productData: any,
  ): Promise<any> {
    const user = await this.usersService.findUserWithRelationships(userId);
    const companyId =
      user.adminCompanyId?.adminID || user.employeeId?.companyId;

    const accessToken = await this.getStoredAccessToken(
      shop,
      user.companyEmail,
      companyId,
    );
    const response = await lastValueFrom(
      this.httpService.post(
        `https://${shop}/admin/api/2021-01/products.json`,
        { product: productData },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
          },
        },
      ),
    );
    return response.data.product;
  }
}
