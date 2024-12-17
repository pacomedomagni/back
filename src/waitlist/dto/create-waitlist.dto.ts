import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateWaitlistDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsNotEmpty()
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsString()
  @IsNotEmpty()
  companySize: string;

  @IsString()
  @IsNotEmpty()
  industry: string;

  @IsString()
  @IsNotEmpty()
  position: string;

  // @Matches(/^(\+234|0)[789]\d{9}$/, {
  //   message: 'phoneNumber must be a valid phone number',
  // })
}
