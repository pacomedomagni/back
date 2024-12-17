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
} from 'class-validator';

class ItemDetail {
  @IsNotEmpty()
  @IsString()
  productName: string;

  @IsOptional()
  @IsString()
  unitType?: string;

  @IsNotEmpty()
  @IsString()
  quantity: string;

  @IsNotEmpty()
  @IsString()
  warehouseName: string;

  @IsOptional()
  @IsString()
  rate?: string;

  @IsNotEmpty()
  @IsString()
  amount: string;

  @IsNotEmpty()
  @IsNumber()
  productId: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  baseQty?: string;
}

export class CreateInvoiceDto {
  @IsNotEmpty()
  @IsString()
  customerName: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsNotEmpty()
  @IsNumber()
  customerId: number;

  @IsOptional()
  @IsNumber()
  salesId?: number;

  @IsOptional()
  @IsNumber()
  loanRequestId?: number;

  @IsOptional()
  @IsNumber()
  priceListId?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  productIds?: number[];

  @IsOptional()
  @IsString()
  orderSN?: string;

  @IsOptional()
  @IsString()
  requestNumber?: string;

  @IsNotEmpty()
  @IsString()
  invoiceSN: string;

  @IsNotEmpty()
  @IsDate()
  invoiceDate: Date;

  @IsNotEmpty()
  @IsDate()
  salesDate: Date;

  @IsNotEmpty()
  @IsDate()
  dueDate: Date;

  @IsNotEmpty()
  @IsNumber()
  salesPersonId: number;

  @IsOptional()
  @IsString()
  priceListName?: string;

  @IsOptional()
  @IsString()
  discount?: string;

  @IsOptional()
  @IsString()
  shippingCharges?: string;

  @IsNotEmpty()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  itemDetails: ItemDetail[];

  @IsNotEmpty()
  @IsString()
  totalPrice: string;
}
