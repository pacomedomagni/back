import { IsNotEmpty, IsString } from 'class-validator';

export class CreateEbayDto {
  @IsNotEmpty()
  @IsString()
  code: string;

  @IsNotEmpty()
  @IsString()
  storeName: string;

  @IsNotEmpty()
  @IsString()
  location: string;
}
