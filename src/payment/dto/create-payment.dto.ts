import {
  IsString,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  ArrayNotEmpty,
  ValidateNested,
  IsInt,
  IsBoolean,
} from 'class-validator';

enum Status {
  PART_PAYMENT = 'PART_PAYMENT',
  FULL_PAYMENT = 'FULL_PAYMENT',
}

enum PaymentMode {
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
  BALANCE = 'BALANCE',
}

export class CreatePaymentDto {
  @IsNotEmpty()
  @IsString()
  customerName: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  balance?: number;

  @IsNotEmpty()
  @IsNumber()
  customerId: number;

  @IsOptional()
  @IsNumber()
  paymentId?: number;

  @IsNotEmpty()
  @IsNumber()
  invoiceId: number;

  // @IsOptional()
  // @IsString()
  // orderNumber?: string;

  @IsNotEmpty()
  @IsString()
  invoiceNumber: string;

  @IsNotEmpty()
  @IsString()
  invoiceAmount: string;

  @IsNotEmpty()
  @IsDate()
  paymentDate: Date;

  @IsNotEmpty()
  @IsString()
  amountPaid: string;

  @IsNotEmpty()
  @IsBoolean()
  useCustomerBalance: boolean;

  @IsOptional()
  @IsString()
  customerBalanceAmount: string;

  @IsNotEmpty()
  @IsEnum(Status)
  paymentStatus: Status;

  @IsNotEmpty()
  @IsEnum(PaymentMode)
  paymentMode: PaymentMode;
}
