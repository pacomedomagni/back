import { IsNotEmpty, IsString } from 'class-validator';

export class MetricDto {
  @IsNotEmpty()
  @IsString()
  packName: string;

  @IsNotEmpty()
  @IsString()
  unitName: string;
}
