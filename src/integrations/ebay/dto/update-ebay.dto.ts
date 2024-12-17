import { PartialType } from '@nestjs/swagger';
import { CreateEbayDto } from './create-ebay.dto';

export class UpdateEbayDto extends PartialType(CreateEbayDto) {}
