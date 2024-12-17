import {
  IsArray,
  IsInt,
  ArrayNotEmpty,
  isNotEmpty,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';

export class AddRolesToDepartmentDto {
  @IsInt()
  @IsNotEmpty()
  departmentId: number;

  @IsArray()
  @IsOptional()
  systemRoleIds?: number[];

  @IsArray()
  @IsOptional()
  customRoleIds?: number[];
}
