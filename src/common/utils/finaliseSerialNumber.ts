import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { Prisma } from '@prisma/client';

@Injectable()
export class finaliseSerialNumber {
  constructor(private readonly prisma: PrismaService) {}

  async markSerialNumber(
    serialNumber: string,
    companyId: number,
  ): Promise<void> {
    // Extract prefix and current number from the serial number
    const [prefix, currentNumber] = serialNumber.split('-');

    const serialEntry = await this.prisma.serialNumber.findFirst({
      where: {
        prefix,
        currentNumber: parseInt(currentNumber, 10),
        isReserved: true,
        companyId,
      },
    });

    if (serialEntry) {
      // Mark the reserved number as finalized (not reserved)
      await this.prisma.serialNumber.update({
        where: { id: serialEntry.id },
        data: { isReserved: false, companyId },
      });
    } else {
      throw new Error('No reserved serial number found.');
    }
  }
}
