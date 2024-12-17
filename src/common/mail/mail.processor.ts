import { MailerService } from '@nestjs-modules/mailer';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PurchaseOrder,
  Request,
  SalesOrder,
  StockRequest,
  Task,
  User,
  WareHouse,
} from '@prisma/client';
import { Job } from 'bull';
import { EventEmitter } from 'events';

EventEmitter.defaultMaxListeners = 30;

@Processor('mail')
export class MailProcessor {
  private readonly logger = new Logger(MailProcessor.name);
  constructor(
    private mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  @Process('forgotPassword')
  async forgotPassword(job: Job) {
    try {
      const { user } = job.data;
      this.logger.log(
        `Processing forgotPassword job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );

      await this.mailerService.sendMail({
        to: user.companyEmail,
        subject: 'Password Recovery',
        template: './forgotPassword',
        context: {
          name: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          otp: user.otp,
        },
      });

      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('sendAdminConfirmation')
  async sendAdminConfirmation(job: Job) {
    try {
      this.logger.debug(
        `Processing sendAdminConfirmation job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const { user, randomPassword } = job.data;
      const url = `${this.configService.get('BASEURL')}/auth/customPassword`;

      await this.mailerService.sendMail({
        to: user.user?.companyEmail,
        subject: `Welcome to ${user.company?.organizationName}! Confirm your Email`,
        template: 'adminconfirmation',
        context: {
          name: user.user?.primaryContactName,
          organizationName: user.company?.organizationName,
          companyAddress: user.company?.companyAddress,
          companyEmail: user.user?.companyEmail,
          generatedPassword: randomPassword,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('sendAdminNotification')
  async sendAdminNotification(job: Job) {
    try {
      this.logger.debug(
        `Processing sendAdminNotification job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const { user, adminEmailData } = job.data;

      // Iterate through adminEmailData and send each user's details
      await this.mailerService.sendMail({
        to: user?.companyEmail,
        subject: `New user(s) added`,
        template: 'adminusersdetails',
        context: {
          name: user?.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          usersData: adminEmailData,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('sendEmailToCustomer')
  async sendEmailToCustomer(job: Job) {
    try {
      const { email, subject, body } = job.data;
      this.logger.log(
        `Processing sendEmailToCustomer job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      this.logger.log('Receives email from queue');
      await this.mailerService.sendMail({
        to: email,
        subject: subject,
        html: body,
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('sendEmployeeConfirmation')
  async sendEmployeeConfirmation(job: Job) {
    try {
      const { user, randomPassword, userRoles, organizationName } = job.data;

      this.logger.log(
        `Processing sendEmployeeConfirmation job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/auth/signup/employee`;

      await this.mailerService.sendMail({
        to: user.employeeUser?.companyEmail
          ? user.employeeUser?.companyEmail
          : user?.companyEmail,
        subject: `Invitation`,
        template: './employeeinviteConfirmation',
        context: {
          name: user.employeeUser?.primaryContactName
            ? user.employeeUser?.primaryContactName
            : user?.primaryContactName,
          organizationName,
          companyEmail: user.employeeUser?.companyEmail
            ? user.employeeUser?.companyEmail
            : user?.companyEmail,
          generatedPassword: randomPassword,
          roles: userRoles,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('sendEmployeeInvite')
  async sendEmployeeInvite(job: Job) {
    try {
      const { user, randomPassword, userRoles, organizationName } = job.data;

      this.logger.log(
        `Processing sendEmployeeInvite job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/auth/signup/employee`;

      await this.mailerService.sendMail({
        to: user.employeeUser?.companyEmail
          ? user.employeeUser?.companyEmail
          : user?.companyEmail,
        subject: `Invitation`,
        template: './employeeinvite',
        context: {
          name: user.employeeUser?.primaryContactName
            ? user.employeeUser?.primaryContactName
            : user?.primaryContactName,
          organizationName,
          companyEmail: user.employeeUser?.companyEmail
            ? user.employeeUser?.companyEmail
            : user?.companyEmail,
          generatedPassword: randomPassword,
          roles: userRoles,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('salesOrderNotifications')
  async salesOrderNotifications(job: Job) {
    try {
      const { user, notification, approver, salesOrder } = job.data;
      this.logger.log(
        `Processing salesOrderNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: approver.companyEmail,
        subject: `Sales Order Approval Required - Order: ${salesOrder.SN}`,
        template: './salesOrder',
        context: {
          approverName: approver.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          salesOrder,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('purchaseOrderNotifications')
  async purchaseOrderNotifications(job: Job) {
    try {
      const { user, notification, approver, purchaseOrder } = job.data;
      this.logger.log(
        `Processing purchaseOrderNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: approver.companyEmail,
        subject: `Purchase Order Approval Required - Order: ${purchaseOrder.SN}`,
        template: './purchaseOrder',
        context: {
          approverName: approver.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          purchaseOrder,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('salesRequestNotifications')
  async salesRequestNotifications(job: Job) {
    try {
      const { user, notification, approver, request } = job.data;
      this.logger.log(
        `Processing salesRequestNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: approver.companyEmail,
        subject: `Sales Request Approval Required - Request: ${request.REQ}`,
        template: './salesRequest',
        context: {
          approverName: approver.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          request,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('purchaseRequestNotifications')
  async purchaseRequestNotifications(job: Job) {
    try {
      const { user, notification, approver, request } = job.data;
      this.logger.log(
        `Processing purchaseRequestNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: approver.companyEmail,
        subject: `Purchase Request Approval Required - Request: ${request.REQ}`,
        template: './purchaseRequest',
        context: {
          approverName: approver.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          request,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('requestApprovalNotifications')
  async requestApprovalNotifications(job: Job) {
    try {
      const { user, notification, requestedUser, request } = job.data;
      this.logger.log(
        `Processing requestApprovalNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: requestedUser.companyEmail,
        subject: `New Request Approval - Request: ${request.REQ}`,
        template: './requestApproval',
        context: {
          requesterName: requestedUser.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          request,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('requestRejectionNotifications')
  async requestRejectionNotifications(job: Job) {
    try {
      const { user, notification, requestedUser, request } = job.data;
      this.logger.log(
        `Processing requestRejectionNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: requestedUser.companyEmail,
        subject: `New Sales Rejection - Sales: ${request.REQ}`,
        template: './requestRejection',
        context: {
          requesterName: requestedUser.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          request,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('stockRequestApprovalNotifications')
  async stockRequestApprovalNotifications(job: Job) {
    try {
      const { user, notification, requestedUser, request } = job.data;
      this.logger.log(
        `Processing stockRequestApprovalNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: requestedUser.companyEmail,
        subject: `New Request Approval - Request: ${request.requestNumber}`,
        template: './stockRequestApproval',
        context: {
          requesterName: requestedUser.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          request,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('stockRequestRejectionNotifications')
  async stockRequestRejectionNotifications(job: Job) {
    try {
      const { user, notification, requestedUser, request } = job.data;
      this.logger.log(
        `Processing stockRequestApprovalNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: requestedUser.companyEmail,
        subject: `New transfer Rejection - Stock: ${request.requestNumber}`,
        template: './stockRequestRejection',
        context: {
          requesterName: requestedUser.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          request,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('salesApprovalNotifications')
  async salesApprovalNotifications(job: Job) {
    try {
      const { user, notification, requestedUser, sales } = job.data;
      this.logger.log(
        `Processing salesApprovalNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: requestedUser.companyEmail,
        subject: `New Sales Approval - Sales: ${sales.SN}`,
        template: './salesApproval',
        context: {
          requesterName: requestedUser.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          sales,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('salesRejectionNotifications')
  async salesRejectionNotifications(job: Job) {
    try {
      const { user, notification, requestedUser, sales } = job.data;
      this.logger.log(
        `Processing salesRejectionNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: requestedUser.companyEmail,
        subject: `New Sales Rejection - Sales: ${sales.SN}`,
        template: './salesRejection',
        context: {
          requesterName: requestedUser.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          sales,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('purchaseApprovalNotifications')
  async purchaseApprovalNotifications(job: Job) {
    try {
      const { user, notification, requestedUser, purchase } = job.data;
      this.logger.log(
        `Processing purchaseApprovalNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: requestedUser.companyEmail,
        subject: `New Purchase Approval - Sales: ${purchase.SN}`,
        template: './purchaseApproval',
        context: {
          requesterName: requestedUser.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          purchase,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('purchaseRejectionNotifications')
  async purchaseRejectionNotifications(job: Job) {
    try {
      const { user, notification, requestedUser, purchase } = job.data;
      this.logger.log(
        `Processing purchaseRejectionNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: requestedUser.companyEmail,
        subject: `New Purchase Rejection - Purchase: ${purchase.SN}`,
        template: './purchaseApproval',
        context: {
          requesterName: requestedUser.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          purchase,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('taskNotifications')
  async taskNotifications(job: Job) {
    try {
      const { user, notification, receiver, task } = job.data;
      this.logger.log(
        `Processing taskNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: receiver.companyEmail,
        subject: `New Task Added - Task: ${task.taskSN}`,
        template: './task',
        context: {
          requesterName: receiver.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          task,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @Process('transferNotifications')
  async transferNotifications(job: Job) {
    try {
      const { user, notification, request, approver } = job.data;
      this.logger.log(
        `Processing transferNotifications job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
      const url = `${this.configService.get('BASEURL')}/dashboard/selfService/approvals`;
      await this.mailerService.sendMail({
        to: approver.companyEmail,
        subject: `New Transfer Approval`,
        template: './transferApproval',
        context: {
          approverName: approver.primaryContactName,
          senderName: user.primaryContactName,
          organizationName: user.adminCompanyId?.organizationName,
          notification,
          request,
          url,
        },
      });
      this.logger.verbose('Email successfully triggered');
    } catch (error) {
      this.logger.error('Email sending error', error);
      throw error;
    }
  }

  @OnQueueFailed()
  async handleFailedJob(job: Job, err: Error) {
    this.logger.error(
      `Failed job ${job.id} of type ${job.name}: ${err.message}`,
      err.stack,
    );

    // Send notification to admin
    const adminEmail =
      this.configService.get('ADMIN_EMAIL') || 'ignatiuzzfrank@gmail.com';
    try {
      await this.mailerService.sendMail({
        to: adminEmail,
        subject: `Job Failure Notification - ${job.name}`,
        template: './jobFailure',
        context: {
          jobId: job.id,
          jobName: job.name,
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts,
          errorMessage: err.message,
          errorStack: err.stack,
        },
      });
      this.logger.log(
        `Failure notification email sent to admin: ${adminEmail}`,
      );
    } catch (emailErr) {
      this.logger.error(
        `Failed to send failure notification email to admin: ${adminEmail}`,
        emailErr.stack,
      );
    }
  }
}
