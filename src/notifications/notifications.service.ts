import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { paginate, PrismaService } from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import {
  ApprovalNotifications,
  InAppNotifications,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PaginationDto } from 'src/common/dto';
import { GetAllResponse } from 'src/common/interface';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersservice: UsersService,
  ) {}

  async findAll(
    userId: number,
    paginationDto: PaginationDto,
  ): Promise<GetAllResponse<ApprovalNotifications>> {
    try {
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const unreadNotifications = await paginate(
        this.prismaService.approvalNotifications,
        paginationDto,
        {
          where: {
            notifierId: userId,
            companyId,
          },
          include: {
            salesOrder: { where: { companyId } },
            purchaseOrder: { where: { companyId } },
            request: { where: { companyId } },
            loanRequest: { include: { customer: true, wareHouse: true } },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      );

      return {
        status: 'Success',
        message: 'Notifications retrieved',
        data: unreadNotifications.data as ApprovalNotifications[],
        totalItems: unreadNotifications.totalItems,
        currentPage: unreadNotifications.currentPage,
        totalPages: unreadNotifications.totalPages,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching approval',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async deleteApprovals(userId: number, id: number) {
    try {
      // Check if the user exists with associated relationships
      const user = await this.usersservice.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const approvals =
        await this.prismaService.approvalNotifications.findUnique({
          where: { id, companyId },
        });

      if (!approvals) {
        throw new HttpException('Approvals not found', HttpStatus.NOT_FOUND);
      }

      await this.prismaService.approvalNotifications.delete({
        where: {
          id,
          companyId,
        },
      });

      return {
        status: 'Success',
        message: 'Approval deleted successfully',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while deleting approval',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getUndeliveredNotifications(approverId: number): Promise<any[]> {
    try {
      const user =
        await this.usersservice.findUserWithRelationships(approverId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Fetch distinct notifications
      const notifications =
        await this.prismaService.inAppNotifications.findMany({
          where: {
            receiverId: approverId,
            //delivered: false,
            dispatched: true,
            companyId,
          },
          include: {
            request: { where: { companyId } },
            salesOrder: { where: { companyId } },
            purchaseOrder: { where: { companyId } },
            stockRequest: { where: { companyId } },
            task: { where: { companyId } },
            loanRequest: { include: { customer: true, wareHouse: true } },
          },
          distinct: ['id'],
          orderBy: { createdAt: 'desc' },
        });

      return notifications;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching notifications',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async markNotificationsAsDelivered(notifications: any[]): Promise<void> {
    const uniqueNotificationIds = new Map<number, boolean>();
    const uniqueSysNotificationIds = new Map<number, boolean>();
    const uniqueAppNotificationIds = new Map<number, boolean>();

    for (const notification of notifications) {
      // Check if notification ID is already processed at the top level
      if (!uniqueNotificationIds.has(notification.id)) {
        uniqueNotificationIds.set(notification.id, true);

        // Check if notification ID is already processed for SystemNotifications
        if (!uniqueSysNotificationIds.has(notification.id)) {
          uniqueSysNotificationIds.set(notification.id, true);

          // Mark system notification as delivered
          const existingNotification =
            await this.prismaService.inAppNotifications.findUnique({
              where: { id: notification.id },
            });
          if (existingNotification) {
            await this.prismaService.inAppNotifications.update({
              where: { id: notification.id },
              data: { delivered: true },
            });
          }
        }
      }
    }
  }

  async markNotificationAsDispatched(
    notificationId: number,
    dispatched: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      const prismaClient = tx || this.prismaService;

      // Find the notification by ID within the transaction.
      const notification = await prismaClient.inAppNotifications.findUnique({
        where: { id: notificationId },
      });

      if (notification) {
        await prismaClient.inAppNotifications.update({
          where: { id: notificationId },
          data: { dispatched },
        });

        return;
      }

      throw new HttpException('Notification not found', HttpStatus.NOT_FOUND);
    } catch (error) {
      console.error('Error marking notification as dispatched:', error);
      throw error;
    }
  }

  async markNotificationsAsRead(notifications: any[]): Promise<void> {
    try {
      const uniqueNotificationIds = new Map<number, boolean>();
      const uniqueSysNotificationIds = new Map<number, boolean>();
      const uniqueAppNotificationIds = new Map<number, boolean>();

      for (const notification of notifications) {
        // Check if notification ID is already processed at the top level
        if (!uniqueNotificationIds.has(notification)) {
          uniqueNotificationIds.set(notification, true);

          // Check if notification ID is already processed for SystemNotifications
          if (!uniqueSysNotificationIds.has(notification)) {
            uniqueSysNotificationIds.set(notification, true);

            // Mark system notification as delivered
            const existingNotification =
              await this.prismaService.inAppNotifications.findUnique({
                where: { id: notification },
              });
            if (existingNotification) {
              await this.prismaService.inAppNotifications.update({
                where: { id: notification },
                data: { read: true },
              });
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while marking notifications as read',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async markNotificationAsRead(notificationId: number): Promise<void> {
    try {
      const notification =
        await this.prismaService.inAppNotifications.findUnique({
          where: { id: notificationId },
        });

      if (notification) {
        await this.prismaService.inAppNotifications.update({
          where: { id: notificationId },
          data: { read: true },
        });
        return;
      }

      throw new HttpException('Notification not found', HttpStatus.NOT_FOUND);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while marking notification as read',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async deleteAllNotifications(notificationIds: number[]): Promise<void> {
    try {
      const uniqueNotificationIds = new Set(notificationIds);

      for (const notificationId of uniqueNotificationIds) {
        const existingNotification =
          await this.prismaService.inAppNotifications.findUnique({
            where: { id: notificationId },
            include: { company: true },
          });

        if (existingNotification) {
          await this.prismaService.inAppNotifications.delete({
            where: {
              id: notificationId,
              companyId: existingNotification.company.adminID,
            },
          });
        }
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while deleting notifications',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async deleteNotification(notificationId: number): Promise<any> {
    try {
      const notification =
        await this.prismaService.inAppNotifications.findUnique({
          where: { id: notificationId },
          include: { company: true },
        });
      // Check this...
      if (notification) {
        await this.prismaService.inAppNotifications.delete({
          where: {
            id: notificationId,
            companyId: notification.company.adminID,
          },
        });
        return {
          status: 'Success',
          message: 'Notifications deleted',
        };
      }

      throw new HttpException('Notification not found', HttpStatus.NOT_FOUND);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while deleting notification',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }
}
