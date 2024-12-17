import { PartialType } from '@nestjs/swagger';
import { CustomRoleDto } from './custom-role.dto';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateRoleDto extends PartialType(CustomRoleDto) {
  @IsOptional()
  @IsInt()
  userId?: number;

  @IsArray()
  @IsOptional()
  systemRoleIds?: number[];

  @IsArray()
  @IsOptional()
  customRoleIds?: number[];
}
