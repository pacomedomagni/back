import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { PrismaService } from 'src/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class WaitlistService {
  constructor(private readonly prismaService: PrismaService) {}

  async createWaitlist(createWaitlistDto: CreateWaitlistDto): Promise<any> {
    try {
      const existingWaitlist = await this.prismaService.waitlist.findFirst({
        where: {
          OR: [
            { email: createWaitlistDto.email },
            { phoneNumber: createWaitlistDto.phoneNumber },
          ],
        },
      });

      if (existingWaitlist) {
        throw new HttpException(
          'User already exists in the waitlist with this email or phone number',
          HttpStatus.BAD_REQUEST,
        );
      }

      const waitlistEntry = await this.prismaService.waitlist.create({
        data: {
          fullName: createWaitlistDto.fullName,
          email: createWaitlistDto.email,
          phoneNumber: createWaitlistDto.phoneNumber,
          companyName: createWaitlistDto.companyName,
          companySize: createWaitlistDto.companySize,
          industry: createWaitlistDto.industry,
          position: createWaitlistDto.position,
        },
      });

      return {
        status: 'Success',
        message: 'Successfully added to waitlist',
        data: waitlistEntry,
      };
    } catch (error) {
      console.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while adding user to waitlist',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }
}
