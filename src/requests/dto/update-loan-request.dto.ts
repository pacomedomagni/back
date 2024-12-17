import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CreateLoanRequestDto } from './create-loan-request.dto';

enum RequestStatus {
  APPROVED = 'APPROVED',
  PENDING = 'PENDING',
  REJECT = 'REJECT',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
}
export class UpdateLoanRequestDto extends PartialType(CreateLoanRequestDto) {
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;

  @IsOptional()
  @IsString()
  comment?: string;
}
