import { Injectable, HttpStatus, HttpException } from '@nestjs/common';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  CloudinaryService,
  MailService,
  PrismaService,
  finaliseSerialNumber,
} from 'src/common';
import { UsersService } from 'src/auth/users/users.service';
import { Prisma, Task } from '@prisma/client';
import { TaskActivitiesDto } from './dto/activities-task.dto';
import { TaskCommentDto } from './dto/comment-task.dto';
import { UpdateTaskCommentDto } from './dto/update-task-comment.dto';
import { EventsGateway } from 'src/events/events.gateway';
// import { InjectQueue } from '@nestjs/bull';
// import { Queue } from 'bull';

@Injectable()
export class TasksService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly mailService: MailService,
    private readonly eventsGateway: EventsGateway,
    private readonly finaliseSerialNumber: finaliseSerialNumber,
  ) {}
  async createTask(
    userId: number,
    createTaskDto: CreateTaskDto,
    file?: Express.Multer.File,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const existingTask = await this.prismaService.task.findFirst({
        where: { taskSN: createTaskDto.taskSN, companyId },
      });

      if (existingTask) {
        throw new HttpException(
          `Task already created with this task serial number ${createTaskDto.taskSN} `,
          HttpStatus.BAD_REQUEST,
        );
      }
      let task: Task;

      if (createTaskDto.userId) {
        const approver = await this.prismaService.user.findUnique({
          where: { id: createTaskDto.userId },
        });

        if (!approver) {
          throw new HttpException(
            'Assigned user does not exist',
            HttpStatus.BAD_REQUEST,
          );
        }

        task = await this.prismaService.task.create({
          data: {
            companyId,
            taskSN: createTaskDto.taskSN,
            name: createTaskDto.name,
            priority: createTaskDto.priority,
            state: createTaskDto.state,
            appliesTo: createTaskDto.appliesTo,
            assignedBy: user.primaryContactName,
            duration: createTaskDto.duration,
            description: createTaskDto.description,
            notes: createTaskDto.notes,
            userId: createTaskDto.userId,
            approverId: approver.id,
            //imageId: image?.id,
          },
          include: {
            user: { include: { image: true } },
          },
        });

        if (file) {
          await this.cloudinaryService.queueFileUpload({
            file,
            entityType: 'task',
            entityId: task.id,
            companyId,
          });
        }

        const notification =
          await this.prismaService.systemNotifications.create({
            data: {
              message: `New Task added ${task.taskSN}.`,
              companyId,
              userId: user.id,
              approverId: approver.id,
              taskId: task.id,
              receiverId: approver.id,
              type: 'TaskAssigned',
            },
            include: { task: true },
          });

        const appNotification =
          await this.prismaService.inAppNotifications.create({
            data: {
              message: `New Task added ${task.taskSN}`,
              companyId,
              taskId: task.id,
              receiverId: approver.id,
              senderId: user.id,
              type: 'TaskAssigned',
            },
            include: { task: true },
          });

        // Send real-time WebSocket notification
        this.eventsGateway.sendNotificationToUser(approver.id, appNotification);

        //Send email notification
        await this.mailService.taskNotifications(
          notification,
          approver,
          user,
          task,
        );
      }

      // Ensure departmentIds is always an array
      let existingDepartments: any[] = [];
      if (createTaskDto.departmentIds) {
        const departmentIdArray = Array.isArray(createTaskDto.departmentIds)
          ? createTaskDto.departmentIds
          : [createTaskDto.departmentIds];

        // Check if the departments exist
        existingDepartments = await this.prismaService.department.findMany({
          where: { id: { in: departmentIdArray } },
        });

        if (existingDepartments.length !== departmentIdArray.length) {
          const missingDepartmentIds = departmentIdArray.filter(
            (id) =>
              !existingDepartments.some((department) => department.id === id),
          );
          throw new HttpException(
            `Departments with IDs ${missingDepartmentIds.join(', ')} not found`,
            HttpStatus.NOT_FOUND,
          );
        }

        task = await this.prismaService.task.create({
          data: {
            companyId,
            taskSN: createTaskDto.taskSN,
            name: createTaskDto.name,
            priority: createTaskDto.priority,
            state: createTaskDto.state,
            appliesTo: createTaskDto.appliesTo,
            assignedBy: user.primaryContactName,
            duration: createTaskDto.duration,
            description: createTaskDto.description,
            notes: createTaskDto.notes,
            userId: createTaskDto.userId,
            //imageId: image?.id,
          },
          include: { image: { where: { companyId } } },
        });

        if (file) {
          await this.cloudinaryService.queueFileUpload({
            file,
            entityType: 'task',
            entityId: task.id,
            companyId,
          });
        }

        // Associate the task with each department
        await Promise.all(
          existingDepartments.map(async (department) => {
            const departments = await this.prismaService.department.update({
              where: { id: department.id, companyId },
              data: { tasks: { connect: { id: task.id } } },
              include: { users: true },
            });

            // Notify each user in the department
            await Promise.all(
              departments.users.map(async (userInDepartment) => {
                const notification =
                  await this.prismaService.systemNotifications.create({
                    data: {
                      message: `New Task added ${task.taskSN}.`,
                      companyId,
                      userId: user.id,
                      approverId: userInDepartment.id,
                      taskId: task.id,
                      receiverId: userInDepartment.id,
                      type: 'TaskAssigned',
                    },
                    include: { task: true },
                  });

                const appNotification =
                  await this.prismaService.inAppNotifications.create({
                    data: {
                      message: `New Task added ${task.taskSN}`,
                      companyId,
                      taskId: task.id,
                      receiverId: userInDepartment.id,
                      senderId: user.id,
                      type: 'TaskAssigned',
                    },
                    include: { salesOrder: true },
                  });

                this.eventsGateway.sendNotificationToUser(
                  userInDepartment.id,
                  appNotification,
                );
                //Send email notification
                await this.mailService.taskNotifications(
                  notification,
                  userInDepartment,
                  user,
                  task,
                );
              }),
            );
          }),
        );
      }

      if (task) {
        await this.finaliseSerialNumber.markSerialNumber(
          createTaskDto.taskSN,
          companyId,
        );
      }

      return {
        status: 'Success',
        message: 'Task created successfully',
        data: task,
      };
    } catch (error) {
      console.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating task',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async updateTaskState(
    userId: number,
    TaskId: number,
    updateTaskDto: UpdateTaskDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      // Check if the Order exists
      const existingTask = await this.prismaService.task.findUnique({
        where: { id: TaskId, companyId },
        // include: { request: { where: { companyId } } },
      });

      if (!existingTask) {
        throw new HttpException(
          `Task with id number ${TaskId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Capture changes in a variable to log them later
      const changes = [];
      let actions = [];
      const dynamicUpdateData: Record<string, any> = {};

      // Iterate over the fields in updateTaskDto to determine which fields were updated
      for (const field in updateTaskDto) {
        if (updateTaskDto[field] !== existingTask[field]) {
          dynamicUpdateData[field] = updateTaskDto[field];
          changes.push(
            `Updated ${field} from '${existingTask[field]}' to '${updateTaskDto[field]}'`,
          );
          actions.push(field);
        }
      }

      const updateTask = await this.prismaService.task.update({
        where: { id: TaskId, companyId },
        data: {
          state: dynamicUpdateData.state,
        },
        include: {
          image: { where: { companyId } },
          user: { where: { image: { companyId } } },
          departments: {
            include: {
              users: { include: { image: { where: { companyId } } } },
            },
          },
        },
      });

      const verb = changes.length > 1 ? 'were' : 'was';
      const actionDescription = `${actions.join(', ')} ${verb} updated by ${user.primaryContactName}`;

      await this.prismaService.taskActivities.create({
        data: {
          companyId,
          userId,
          taskId: updateTask.id,
          //comments: taskActivitiesDto.comments,
          action: actionDescription,
          changes: changes.join('; '),
        },
      });

      return {
        status: 'Successfully updated Task',
        data: updateTask,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating task',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async getAllTasks(userId: number): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const tasks = await this.prismaService.task.findMany({
        where: { companyId },
        include: {
          image: { where: { companyId } },
          user: { include: { image: true } },
          comment: {
            where: { companyId },
            include: { user: { include: { image: true } } },
            orderBy: {
              createdAt: 'desc',
            },
          },
          departments: {
            include: {
              users: { include: { image: { where: { companyId } } } },
            },
          },
          activities: {
            where: { companyId },
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        status: 'Success',
        message: 'Tasks retrieved successfully',
        data: tasks,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching task',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async geTaskById(userId: number, id: number): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const task = await this.prismaService.task.findUnique({
        where: { id, companyId },
        include: {
          image: { where: { companyId } },
          user: { include: { image: true } },
          comment: {
            where: { companyId },
            include: { user: { include: { image: true } } },
            orderBy: {
              createdAt: 'desc',
            },
          },
          departments: {
            include: {
              users: { where: { image: { companyId } } },
            },
          },
          activities: {
            where: { companyId },
            orderBy: {
              createdAt: 'desc',
            },
          },
          //notifications: { where: { companyId } },
        },
      });

      if (!task) {
        throw new HttpException(
          `Task with id ${id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        status: 'Success',
        message: 'Task retrieved successfully',
        data: task,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while fetching task',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async updateTask(
    userId: number,
    taskId: number,
    updateTaskDto: UpdateTaskDto,
    taskActivitiesDto: TaskActivitiesDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const existingTask = await this.prismaService.task.findUnique({
        where: { id: taskId, companyId },
      });

      if (!existingTask) {
        throw new HttpException(
          `Task with id number ${taskId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Capture changes in a variable to log them later
      const changes = [];
      let actions = [];
      const dynamicUpdateData: Record<string, any> = {};

      // Iterate over the fields in updateTaskDto to determine which fields were updated
      for (const field in updateTaskDto) {
        if (updateTaskDto[field] !== existingTask[field]) {
          dynamicUpdateData[field] = updateTaskDto[field];
          changes.push(
            `Updated ${field} from '${existingTask[field]}' to '${updateTaskDto[field]}'`,
          );
          actions.push(field);
        }
      }

      let task: Task;

      if (Object.keys(dynamicUpdateData).length > 0) {
        if (updateTaskDto.userId) {
          const approver = await this.prismaService.user.findUnique({
            where: {
              id: updateTaskDto.userId,
              companyId,
            },
          });

          if (!approver) {
            throw new HttpException(
              'Assigned approver does not exist',
              HttpStatus.NOT_FOUND,
            );
          }

          task = await this.prismaService.task.update({
            where: { id: taskId, companyId },
            data: dynamicUpdateData,
            include: {
              image: { where: { companyId } },
              user: { where: { image: { companyId } } },
              departments: {
                include: {
                  users: { include: { image: { where: { companyId } } } },
                },
              },
            },
          });

          const verb = changes.length > 1 ? 'were' : 'was';
          const actionDescription = `${actions.join(', ')} ${verb} updated by ${user.primaryContactName}`;

          await this.prismaService.taskActivities.create({
            data: {
              companyId,
              userId,
              taskId: task.id,
              comments: taskActivitiesDto.comments,
              action: actionDescription,
              changes: changes.join('; '),
            },
          });

          const notification =
            await this.prismaService.systemNotifications.create({
              data: {
                message: `New Task added ${task.taskSN}.`,
                companyId,
                userId: user.id,
                approverId: approver.id,
                taskId: task.id,
                receiverId: approver.id,
                type: 'TaskAssigned',
              },
              include: { task: true },
            });

          const appNotification =
            await this.prismaService.inAppNotifications.create({
              data: {
                message: `New Task added ${task.taskSN}`,
                companyId,
                taskId: task.id,
                receiverId: approver.id,
                senderId: user.id,
                type: 'TaskAssigned',
              },
              include: { task: true },
            });

          // Send real-time WebSocket notification
          this.eventsGateway.sendNotificationToUser(
            approver.id,
            appNotification,
          );

          await this.mailService.taskNotifications(
            notification,
            approver,
            user,
            task,
          );

          return {
            status: 'Successfully Updated',
            data: task,
          };
        } else if (updateTaskDto.departmentIds) {
          let existingDepartments: any[] = [];

          //checks and ensure departmentId is always an array
          const departmentIdArray = Array.isArray(updateTaskDto.departmentIds)
            ? updateTaskDto.departmentIds
            : [updateTaskDto.departmentIds];

          // Check if the departments exist
          existingDepartments = await this.prismaService.department.findMany({
            where: { id: { in: departmentIdArray } },
          });

          if (existingDepartments.length !== departmentIdArray.length) {
            const missingDepartmentIds = departmentIdArray.filter(
              (id) =>
                !existingDepartments.some((department) => department.id === id),
            );
            throw new HttpException(
              `Departments with IDs ${missingDepartmentIds.join(
                ', ',
              )} not found`,
              HttpStatus.NOT_FOUND,
            );
          }

          task = await this.prismaService.task.update({
            where: { id: taskId, companyId },
            data: dynamicUpdateData,
          });

          // Associate the task with each department
          await Promise.all(
            existingDepartments.map(async (department) => {
              const departments = await this.prismaService.department.update({
                where: { id: department.id, companyId },
                data: { tasks: { connect: { id: task.id } } },
                include: { users: true },
              });

              // Notify each user in the department
              await Promise.all(
                departments.users.map(async (userInDepartment) => {
                  const notification =
                    await this.prismaService.systemNotifications.create({
                      data: {
                        message: `New Task Added ${task.taskSN}.`,
                        companyId,
                        userId: user.id,
                        approverId: userInDepartment.id,
                        taskId: task.id,
                        receiverId: userInDepartment.id,
                        type: 'TaskAssigned',
                      },
                      include: { task: true },
                    });

                  const appNotification =
                    await this.prismaService.inAppNotifications.create({
                      data: {
                        message: `New Task added ${task.taskSN}`,
                        companyId,
                        taskId: task.id,
                        receiverId: userInDepartment.id,
                        senderId: user.id,
                        type: 'TaskAssigned',
                      },
                      include: { task: true },
                    });

                  // Send real-time WebSocket notification
                  this.eventsGateway.sendNotificationToUser(
                    userInDepartment.id,
                    appNotification,
                  );

                  await this.mailService.taskNotifications(
                    notification,
                    userInDepartment,
                    user,
                    task,
                  );
                }),
              );
            }),
          );

          return {
            status: 'Successfully Updated',
            data: task,
          };
        }
      } else {
        throw new HttpException(`No fields provided`, HttpStatus.BAD_REQUEST);
      }
    } catch (error) {
      console.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating task',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async comment(userId: number, id: number, taskCommentDto: TaskCommentDto) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const task = await this.prismaService.task.findUnique({
        where: { id, companyId },
        include: {
          image: true,
        },
      });

      if (!task) {
        throw new HttpException(
          `Task with id ${id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const comments = await this.prismaService.taskComment.create({
        data: {
          comment: taskCommentDto.comment,
          taskId: task.id,
          userId: user.id,
          companyId,
        },
        include: { task: true },
      });

      if (!comments) {
        throw new HttpException(
          `Error creating comment`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return {
        status: 'Success',
        message: 'Comment published successfully',
        data: comments,
      };
    } catch (error) {
      console.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while creating comment',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async deleteComment(userId: number, commentId: number) {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const comment = await this.prismaService.taskComment.findUnique({
        where: { id: commentId, companyId },
      });

      if (!comment) {
        throw new HttpException('comment not found', HttpStatus.NOT_FOUND);
      }

      if (comment.companyId !== companyId) {
        throw new HttpException(
          'You do not have permission to delete this comment',
          HttpStatus.UNAUTHORIZED,
        );
      }

      await this.prismaService.$transaction(async (prisma) => {
        await prisma.taskComment.delete({
          where: { id: comment.id, companyId },
        });
      });

      return {
        status: 'Success',
        message: 'Comment deleted successfully',
      };
    } catch (error) {
      console.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'Invalid data provided',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  async editComment(
    userId: number,
    commentId: number,
    updateTaskCommentDto: UpdateTaskCommentDto,
  ): Promise<any> {
    try {
      const user = await this.usersService.findUserWithRelationships(userId);
      const companyId =
        user.adminCompanyId?.adminID || user.employeeId?.companyId;

      const existingComment = await this.prismaService.taskComment.findUnique({
        where: { id: commentId, companyId },
      });

      if (!existingComment) {
        throw new HttpException(
          `Comment with id ${commentId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Check if data is provided for update
      if (!Object.keys(updateTaskCommentDto).length) {
        return {
          status: 'No Updates',
          data: [],
        };
      }

      const updatedComment = await this.prismaService.taskComment.update({
        where: { id: commentId, companyId },
        data: {
          comment: updateTaskCommentDto.comment,
        },
      });

      return {
        status: 'Comment Updated',
        data: updatedComment,
      };
    } catch (error) {
      console.log(error);
      if (error instanceof Prisma.PrismaClientValidationError) {
        throw new HttpException(
          'An error occurred while updating comment',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }
}
