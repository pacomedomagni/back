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

class ItemDetail {
  @IsNotEmpty()
  @IsNumber()
  productId: number;

  @IsNotEmpty()
  @IsString()
  productName: string;

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
  @IsString()
  warehouseName: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;
}

export class ReturnLoanDto {
  @ArrayNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDetail)
  itemDetails: ItemDetail[];

  @IsNotEmpty()
  @IsString()
  note: string;
}
