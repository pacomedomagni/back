import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma';

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly baseUrl: string;
  private readonly secretKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {
    this.baseUrl = this.configService.get<string>('PAYSTACK_BASEURL');
    this.secretKey = this.configService.get<string>('PAYSTACK_SECRETKEY');
  }

  async validateBankDetails(
    accountNumber: string,
    bankCode: string,
  ): Promise<any> {
    const url = `${this.baseUrl}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`;
    const headers = {
      Authorization: `Bearer ${this.secretKey}`,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { headers }),
      );

      if (!response) {
        console.log('No response', response);
      }

      if (response.data && response.data.data) {
        return response.data.data;
      } else {
        throw new Error('Unexpected response format');
      }
    } catch (error) {
      this.logger.error('Error validating bank details', error);
      throw new HttpException(
        'Could not validate bank details',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  public async getBanks(): Promise<any[]> {
    const url = `${this.baseUrl}/bank`;
    const headers = {
      Authorization: `Bearer ${this.secretKey}`,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { headers }),
      );

      if (
        response.data &&
        response.data.data &&
        Array.isArray(response.data.data)
      ) {
        return response.data.data;
      } else {
        throw new Error('Unexpected response format');
      }
    } catch (error) {
      this.logger.error('Error fetching banks', error);
      throw new HttpException('Could not fetch banks', HttpStatus.BAD_REQUEST);
    }
  }
}
