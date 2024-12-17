import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';

import {
  PurchaseOrder,
  Request,
  SalesOrder,
  StockRequest,
  Task,
  User,
} from '@prisma/client';
import { Queue } from 'bull';
import { adminEmailData } from './interface/userData.interface';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  constructor(
    @InjectQueue('mail')
    private readonly mailQueue: Queue,
  ) {}

  private isProduction() {
    return process.env.NODE_ENV === 'production';
  }

  async getQueueStatus() {
    const waiting = await this.mailQueue.getWaitingCount();
    const active = await this.mailQueue.getActiveCount();
    const delayed = await this.mailQueue.getDelayedCount();
    const failed = await this.mailQueue.getFailedCount();
    const completed = await this.mailQueue.getCompletedCount();

    return {
      waiting,
      active,
      delayed,
      failed,
      completed,
    };
  }

  async clearFailedJobs() {
    const failedJobs = await this.mailQueue.getFailed();
    for (const job of failedJobs) {
      await job.remove();
    }
    return { message: 'Failed jobs cleared' };
  }

  async clearCompletedJobs() {
    const completedJobs = await this.mailQueue.getCompleted();
    for (const job of completedJobs) {
      await job.remove();
    }
    return { message: 'completed jobs cleared' };
  }

  async forgotPassword(user: any) {
    this.logger.log(`Adding forgotPassword email sending to queue...`);

    const queue = await this.mailQueue.add(
      'forgotPassword',
      {
        user,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.logger.log(
      `Successfully added forgotPassword email to queue with id ${queue.id}`,
    );
  }

  async sendAdminConfirmation(user: any, randomPassword: string) {
    this.logger.log(
      'Adding ${sendAdminConfirmation} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'sendAdminConfirmation',
      {
        user,
        randomPassword,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${sendAdminConfirmation} email to queue',
      queue.id,
    );
  }

  async sendEmailToCustomer(email: string, subject: string, body: string) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log('Adding email sending to queue...');

    const queue = await this.mailQueue.add(
      'sendEmailToCustomer',
      {
        email,
        subject,
        body,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log('successfully Added email to queue', queue);
  }

  async sendEmployeeConfirmation(
    user: any,
    randomPassword: string,
    userRoles: any,
    organizationName: String,
  ) {
    this.logger.log(
      'Adding ${sendEmployeeConfirmation} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'sendEmployeeConfirmation',
      {
        user,
        randomPassword,
        userRoles,
        organizationName,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${sendEmployeeConfirmation} email to queue',
      queue.id,
    );
  }

  async sendEmployeeInvite(
    user: any,
    randomPassword: string,
    userRoles: any,
    organizationName: String,
  ) {
    this.logger.log('Adding ${sendEmployeeInvite} email sending to queue...');

    const queue = await this.mailQueue.add(
      'sendEmployeeInvite',
      {
        user,
        randomPassword,
        userRoles,
        organizationName,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${sendEmployeeInvite} email to queue',
      queue.id,
    );
  }

  async sendAdminNotification(user: User, adminEmailData: adminEmailData[]) {
    this.logger.log('Adding sendAdminNotification email sending to queue...');

    const queue = await this.mailQueue.add(
      'sendAdminNotification',
      {
        user,
        adminEmailData,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added sendAdminNotification email to queue',
      queue.id,
    );
  }

  async salesOrderNotifications(
    notification: any,
    approver: any,
    user: any,
    salesOrder: SalesOrder,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log('Adding email sending to queue...');

    const queue = await this.mailQueue.add(
      'salesOrderNotifications',
      {
        notification,
        approver,
        user,
        salesOrder,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log('successfully Added email to queue', queue);
  }

  async purchaseOrderNotifications(
    notification: any,
    approver: any,
    user: any,
    purchaseOrder: PurchaseOrder,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log('Adding email sending to queue...');

    const queue = await this.mailQueue.add(
      'purchaseOrderNotifications',
      {
        notification,
        approver,
        user,
        purchaseOrder,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log('successfully Added email to queue', queue);
  }

  async salesRequestNotifications(
    notification: any,
    approver: any,
    user: any,
    request: Request,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log('Adding email sending to queue...');

    const queue = await this.mailQueue.add(
      'salesRequestNotifications',
      {
        notification,
        approver,
        user,
        request,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log('successfully Added email to queue', queue);
  }

  async purchaseRequestNotifications(
    notification: any,
    approver: any,
    user: any,
    request: Request,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log('Adding email sending to queue...');

    const queue = await this.mailQueue.add(
      'purchaseRequestNotifications',
      {
        notification,
        approver,
        user,
        request,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log('successfully Added email to queue', queue);
  }

  async requestApprovalNotifications(
    notification: any,
    requestedUser: any,
    user: any,
    request: Request,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log(
      'Adding ${requestApprovalNotifications} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'requestApprovalNotifications',
      {
        notification,
        requestedUser,
        user,
        request,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${requestApprovalNotifications} email to queue',
      queue.id,
    );
  }

  async requestRejectionNotifications(
    notification: any,
    requestedUser: any,
    user: any,
    request: Request,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log(
      'Adding ${requestRejectionNotifications} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'requestRejectionNotifications',
      {
        notification,
        requestedUser,
        user,
        request,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${requestRejectionNotifications} email to queue',
      queue.id,
    );
  }

  async stockRequestApprovalNotifications(
    notification: any,
    requestedUser: any,
    user: any,
    request: StockRequest,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log(
      'Adding ${stockRequestApprovalNotifications} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'stockRequestApprovalNotifications',
      {
        notification,
        requestedUser,
        user,
        request,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${stockRequestApprovalNotifications} email to queue',
      queue.id,
    );
  }

  async stockRequestRejectionNotifications(
    notification: any,
    requestedUser: any,
    user: any,
    request: StockRequest,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log(
      'Adding ${stockRequestRejectionNotifications} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'stockRequestRejectionNotifications',
      {
        notification,
        requestedUser,
        user,
        request,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${stockRequestRejectionNotifications} email to queue',
      queue.id,
    );
  }

  async salesApprovalNotifications(
    notification: any,
    requestedUser: any,
    user: any,
    sales: SalesOrder,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log(
      'Adding ${salesApprovalNotifications} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'salesApprovalNotifications',
      {
        notification,
        requestedUser,
        user,
        sales,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${salesApprovalNotifications} email to queue',
      queue.id,
    );
  }

  async salesRejectionNotifications(
    notification: any,
    requestedUser: any,
    user: any,
    sales: SalesOrder,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }

    this.logger.log(
      'Adding ${salesRejectionNotifications} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'salesRejectionNotifications',
      {
        notification,
        requestedUser,
        user,
        sales,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${salesRejectionNotifications} email to queue',
      queue.id,
    );
  }

  async purchaseApprovalNotifications(
    notification: any,
    requestedUser: any,
    user: any,
    purchase: PurchaseOrder,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }
    this.logger.log(
      'Adding ${purchaseApprovalNotifications} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'purchaseApprovalNotifications',
      {
        notification,
        requestedUser,
        user,
        purchase,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${purchaseApprovalNotifications} email to queue',
      queue.id,
    );
  }

  async purchaseRejectionNotifications(
    notification: any,
    requestedUser: any,
    user: any,
    purchase: PurchaseOrder,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }
    this.logger.log(
      'Adding ${purchaseRejectionNotifications} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'purchaseRejectionNotifications',
      {
        notification,
        requestedUser,
        user,
        purchase,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${purchaseRejectionNotifications} email to queue',
      queue.id,
    );
  }

  async taskNotifications(
    notification: any,
    receiver: any,
    user: any,
    task: Task,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }
    this.logger.log('Adding ${taskNotifications} email sending to queue...');

    const queue = await this.mailQueue.add(
      'taskNotifications',
      {
        notification,
        receiver,
        user,
        task,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${taskNotifications} email to queue',
      queue.id,
    );
  }

  async transferNotifications(
    notification: any,
    approver: any,
    user: any,
    request: StockRequest,
  ) {
    if (!this.isProduction()) {
      this.logger.log('Skipping email send in non-production environment');
      return;
    }
    this.logger.log(
      'Adding ${transferNotifications} email sending to queue...',
    );

    const queue = await this.mailQueue.add(
      'transferNotifications',
      {
        notification,
        approver,
        user,
        request,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'successfully Added ${transferNotifications} email to queue',
      queue.id,
    );
  }
}
