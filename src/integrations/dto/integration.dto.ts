import { IsNotEmpty, IsNumber } from 'class-validator';

export class IntegrationDto {
  @IsNotEmpty()
  @IsNumber()
  integrationId: number;
}
