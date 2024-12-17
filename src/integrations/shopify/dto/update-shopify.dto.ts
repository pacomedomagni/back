import { PartialType } from '@nestjs/swagger';
import { CreateShopifyDto } from './create-shopify.dto';

export class UpdateShopifyDto extends PartialType(CreateShopifyDto) {}
