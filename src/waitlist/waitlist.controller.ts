import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
} from '@nestjs/common';
import { WaitlistService } from './waitlist.service';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { UpdateWaitlistDto } from './dto/update-waitlist.dto';

@Controller('api/v1/waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Put('create')
  async createWaitlist(@Body() createWaitlistDto: CreateWaitlistDto) {
    return this.waitlistService.createWaitlist(createWaitlistDto);
  }
}
