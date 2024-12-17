import {
  IsArray,
  IsInt,
  ArrayNotEmpty,
  IsString,
  IsNotEmpty,
} from 'class-validator';

export class AddUsersToDepartmentDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  userIds: number[];

  @IsInt()
  departmentId: number;
}
