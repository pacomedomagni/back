// create-order-confirmation.dto.ts

import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class ItemDetail {
  @IsNotEmpty()
  @IsString()
  productName: string;

  @IsOptional()
  @IsString()
  unitType?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  baseQty?: string;

  @IsNotEmpty()
  @IsNumber()
  quantity: number;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsString()
  @IsOptional()
  comment?: string;

  @IsString()
  @IsOptional()
  rate?: string;

  @IsBoolean()
  @IsOptional()
  received?: boolean;

  @IsString()
  @IsNotEmpty()
  warehouseName: string;

  @IsNotEmpty()
  @IsNumber()
  productId: number;
}

export class CreateOrderConfirmationDto {
  @IsNotEmpty()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  itemDetails: ItemDetail[];

  @IsOptional()
  @IsString()
  purchaseInvoice?: string;

  @IsNotEmpty()
  @IsNumber()
  orderId: number;
}
