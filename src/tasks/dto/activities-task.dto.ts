import { IsNotEmpty, IsString, IsEnum, IsOptional } from 'class-validator';

export class TaskActivitiesDto {
  @IsOptional()
  @IsString()
  comments?: string;
}
