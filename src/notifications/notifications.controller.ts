import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Put,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser, Roles } from 'src/common/decorators';
import { User } from '@prisma/client';
import { JwtGuard } from 'src/common/guards/jwtAuth.guard';
import { PaginationDto } from 'src/common/dto';

@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /************************ DELETE APPROVALS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Delete('delete/:id')
  deleteApprovals(
    @CurrentUser() user: User,
    @Param('id') id: number,
  ): Promise<any> {
    return this.notificationsService.deleteApprovals(user.id, id);
  }

  @UseGuards(JwtGuard)
  @Get()
  findAll(@CurrentUser() user: User, @Query() paginationDto: PaginationDto) {
    return this.notificationsService.findAll(user.id, paginationDto);
  }

  /************************ DELETE Notification *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Delete('inAppNotification/delete/:id')
  deleteNotification(
    @CurrentUser() user: User,
    @Param('id') id: number,
  ): Promise<any> {
    return this.notificationsService.deleteNotification(id);
  }
}
