import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, HttpException, HttpStatus } from '@nestjs/common';
import { JwtAuthService } from 'src/common';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Prisma } from '@prisma/client';

interface MarkNotificationsAsReadDto {
  notificationIds: number[];
}

interface MarkNotificationAsReadDto {
  notificationId: number;
}

interface DeleteNotificationDto {
  notificationId: number;
}

@WebSocketGateway({
  transports: ['websocket'],
  namespace: '/api/v1/notifications',
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,PATCH',
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  private server: Server;

  private socketMap = new Map<
    number,
    { socketId: string; lastHeartbeat: number }
  >();

  //private socketMap = new Map<number, { socketId: string }>();
  private notificationStorage = new Map<number, any[]>();
  private fetchedNotificationsMap = new Map<number, boolean>();

  constructor(
    private readonly jwtAuthService: JwtAuthService,
    private readonly notification: NotificationsService,
  ) {}

  handleDisconnect(@ConnectedSocket() client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    const userId = Array.from(this.socketMap.entries()).find(
      ([_, value]) => value.socketId === client.id,
    )?.[0];

    if (userId !== undefined) {
      this.socketMap.delete(userId);
    }
  }

  broadcastNotification(notification: Notification) {
    this.server.emit('notifications', notification);
  }

  /**********************START*****************************/
  async sendNotificationToUser(
    userId: number,
    notification: any,
    tx?: Prisma.TransactionClient,
  ) {
    try {
      const socketMeta = this.socketMap.get(userId);

      if (socketMeta) {
        // Mark the current notification as dispatched
        await this.notification.markNotificationAsDispatched(
          notification.id,
          true,
          tx,
        );

        const storedNotifications =
          await this.notification.getUndeliveredNotifications(userId);

        this.logger.log(
          `Sending notification to user_${userId}: ${JSON.stringify(notification)}`,
        );

        this.server
          .to(socketMeta.socketId)
          .emit('notifications', storedNotifications);

        //await this.notification.markNotificationsAsDelivered(notification);
      } else {
        this.logger.log(`User ${userId} is not online at the moment`);

        // Store the notification if the user is offline
        await this.notification.markNotificationAsDispatched(
          notification.id,
          true,
          tx,
        );
      }
    } catch (error) {
      this.logger.error(`error occured: ${error.message}`);
      throw error;
    }
  }

  /**********************END*****************************/
  async handleConnection(@ConnectedSocket() client: Socket) {
    try {
      const authorizationHeader = client.handshake.query
        .authorization as string;
      const token = authorizationHeader.split(' ')[1];

      if (!token) {
        throw new HttpException('Token not provided', HttpStatus.UNAUTHORIZED);
      }

      const payload: any = await this.jwtAuthService.decodeAuthToken(token);
      const userId: number = payload.id;

      if (isNaN(userId)) {
        throw new HttpException('Invalid token', HttpStatus.FORBIDDEN);
      }

      this.logger.log(`Client connected: ${client.id}, User ID: ${userId}`);

      // Map the user ID to the socket ID
      //this.socketMap.set(userId, { socketId: client.id });
      this.socketMap.set(userId, {
        socketId: client.id,
        lastHeartbeat: Date.now(),
      });

      //this.startHeartbeatCheck(client);
      // Fetch notifications for the user
      const storedNotifications =
        await this.notification.getUndeliveredNotifications(userId);
      // Emit fetched notifications to the client
      this.server.to(client.id).emit('onConnect', storedNotifications);
      // Emit fetched notifications to the client
      await this.notification.markNotificationsAsDelivered(storedNotifications);
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('markAllNotificationsAsRead')
  async handleMarkAllNotificationsAsRead(
    @MessageBody() data: MarkNotificationsAsReadDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = Array.from(this.socketMap.entries()).find(
      ([_, value]) => value.socketId === client.id,
    )?.[0];

    if (userId !== undefined) {
      const { notificationIds } = data;

      await this.notification.markNotificationsAsRead(notificationIds);
      this.logger.log(
        `Notifications ${data.notificationIds} marked as read for user ${userId}`,
      );
      const storedNotifications =
        await this.notification.getUndeliveredNotifications(userId);
      client.emit('notifications', storedNotifications);
    } else {
      this.logger.error(`User not found for client: ${client.id}`);
    }
  }

  @SubscribeMessage('markNotificationAsRead')
  async handleMarkNotificationAsRead(
    @MessageBody() data: MarkNotificationAsReadDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = Array.from(this.socketMap.entries()).find(
      ([_, value]) => value.socketId === client.id,
    )?.[0];

    if (userId !== undefined) {
      const { notificationId } = data;

      await this.notification.markNotificationAsRead(notificationId);
      this.logger.log(
        `Notification ${data.notificationId} marked as read for user ${userId}`,
      );
      const storedNotifications =
        await this.notification.getUndeliveredNotifications(userId);
      client.emit('notifications', storedNotifications);
    } else {
      this.logger.error(`User not found for client: ${client.id}`);
    }
  }

  @SubscribeMessage('deleteAllNotifications')
  async handleDeleteAllNotifications(
    @MessageBody() data: MarkNotificationsAsReadDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = Array.from(this.socketMap.entries()).find(
      ([_, value]) => value.socketId === client.id,
    )?.[0];

    if (userId !== undefined) {
      const { notificationIds } = data;

      await this.notification.deleteAllNotifications(notificationIds);
      this.logger.log(
        `Notifications ${data.notificationIds} deleted for user ${userId}`,
      );

      const storedNotifications =
        await this.notification.getUndeliveredNotifications(userId);

      this.logger.log(
        `Sending notification to user_${userId}: ${JSON.stringify(storedNotifications)}`,
      );
      client.emit('notifications', storedNotifications);
    } else {
      this.logger.error(`User not found for client: ${client.id}`);
    }
  }

  @SubscribeMessage('deleteNotification')
  async handleDeleteNotification(
    @MessageBody() data: DeleteNotificationDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = Array.from(this.socketMap.entries()).find(
      ([_, value]) => value.socketId === client.id,
    )?.[0];

    if (userId !== undefined) {
      const { notificationId } = data;

      await this.notification.deleteNotification(notificationId);
      this.logger.log(
        `Notification ${data.notificationId} deleted for user ${userId}`,
      );

      const storedNotifications =
        await this.notification.getUndeliveredNotifications(userId);

      this.logger.log(
        `Sending notification to user_${userId}: ${JSON.stringify(storedNotifications)}`,
      );

      client.emit('notifications', storedNotifications);
    } else {
      this.logger.error(`User not found for client: ${client.id}`);
    }
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(@ConnectedSocket() client: Socket) {
    const userId = Array.from(this.socketMap.entries()).find(
      ([_, value]) => value.socketId === client.id,
    )?.[0];

    if (userId !== undefined) {
      this.socketMap.set(userId, {
        socketId: client.id,
        lastHeartbeat: Date.now(),
      });
    }
  }

  private startHeartbeatCheck(client: Socket) {
    const interval = setInterval(() => {
      const userId = Array.from(this.socketMap.entries()).find(
        ([_, value]) => value.socketId === client.id,
      )?.[0];

      if (userId !== undefined) {
        const socketMeta = this.socketMap.get(userId);
        if (Date.now() - socketMeta.lastHeartbeat > 30000) {
          // 30 seconds timeout
          this.logger.log(
            `No heartbeat from user ${userId}. Disconnecting client: ${client.id}`,
          );
          client.disconnect(true);
          clearInterval(interval);
        }
      }
    }, 10000);
  }
}
