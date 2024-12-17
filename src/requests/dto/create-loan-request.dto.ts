import {
  IsNotEmpty,
  IsString,
  IsArray,
  IsNumber,
  IsOptional,
  ValidateNested,
  ArrayNotEmpty,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';

class ItemDetailDto {
  @IsNotEmpty()
  @IsNumber()
  productId: number;

  // @IsNotEmpty()
  // @IsNumber()
  // sendingStockId: number;

  @IsNotEmpty()
  @IsString()
  productName: string;

  @IsNotEmpty()
  @IsNumber()
  qtyAvailable: number;

  @IsNotEmpty()
  @IsNumber()
  qtyTransfer: number;

  @IsOptional()
  @IsNumber()
  qtyReturned: number = 0;

  @IsOptional()
  @IsNumber()
  balanceQty: number = 0;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsNotEmpty()
  @IsNumber()
  rate: number;

  @IsNotEmpty()
  @IsString()
  unitType: string;

  @IsNotEmpty()
  @IsString()
  unit: string;

  @IsNotEmpty()
  @IsNumber()
  baseQty: number;
}

export class CreateLoanRequestDto {
  @IsNotEmpty()
  @IsString()
  requestNumber: string;

  @IsNotEmpty()
  @IsDate()
  dateInitiated: Date;

  @IsNotEmpty()
  @IsNumber()
  customerId: number;

  @IsNotEmpty()
  @IsNumber()
  warehouseId: number;

  @IsOptional()
  @IsNumber()
  approverId?: number;

  @IsNotEmpty()
  @IsDate()
  dueDate: Date;

  @IsNotEmpty()
  @IsString()
  price: string;

  @ArrayNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDetailDto)
  itemDetails: ItemDetailDto[];
}
