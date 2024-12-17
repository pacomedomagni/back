import { IsNotEmpty, IsString, IsEnum, IsOptional } from 'class-validator';

export class TaskCommentDto {
  @IsNotEmpty()
  @IsString()
  comment: string;
}
