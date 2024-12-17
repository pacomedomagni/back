import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UploadedFile,
  ParseFilePipeBuilder,
  HttpStatus,
  UseInterceptors,
  Put,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { User } from '@prisma/client';
import { CurrentUser, Permissions, Roles } from 'src/common/decorators';
import { JwtGuard } from 'src/common/guards/jwtAuth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { TaskActivitiesDto } from './dto/activities-task.dto';
import { TaskCommentDto } from './dto/comment-task.dto';
import { UpdateTaskCommentDto } from './dto/update-task-comment.dto';

@Controller('api/v1/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /************************ CREATE TASK *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  // @Permissions('updateProduct')
  @UseInterceptors(FileInterceptor('file'))
  @Put('create-task')
  createItemGroup(
    @CurrentUser() user: User,
    @Body() createTaskDto: CreateTaskDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        // .addFileTypeValidator({
        //   fileType: 'jpeg',
        // })
        .addMaxSizeValidator({
          maxSize: 5000000,
        })
        .build({
          fileIsRequired: false,
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
    file: Express.Multer.File,
  ) {
    //
    //console.log(file);
    return this.tasksService.createTask(user.id, createTaskDto, file);
  }

  /************************ GET TASKS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('createProduct')
  @Get('get-tasks')
  getAllTasks(@CurrentUser() user: User) {
    return this.tasksService.getAllTasks(user.id);
  }

  /************************ GET TASK BY ID *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get(':id')
  geTaskById(@CurrentUser() user: User, @Param('id') id: number): Promise<any> {
    return this.tasksService.geTaskById(user.id, id);
  }

  /************************ EDIT TASKS*****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('approver')
  @Put(':id')
  updateTask(
    @CurrentUser() user: User,
    @Param('id') id: number,
    @Body() updateTaskDto: UpdateTaskDto,
    @Body() taskActivitiesDto: TaskActivitiesDto,
  ): Promise<any> {
    return this.tasksService.updateTask(
      user.id,
      id,
      updateTaskDto,
      taskActivitiesDto,
    );
  }

  /************************ UPDATE TASKS STATE*****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('approver')
  @Patch('state/:id')
  updateTaskState(
    @CurrentUser() user: User,
    @Param('id') id: number,
    @Body() updateTaskDto: UpdateTaskDto,
  ): Promise<any> {
    return this.tasksService.updateTaskState(user.id, id, updateTaskDto);
  }

  /************************ COMMENT TASK *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Put('comment/:taskId')
  commentPost(
    @CurrentUser() user: User,
    @Param('taskId') taskId: number,
    @Body() taskCommentDto: TaskCommentDto,
  ) {
    return this.tasksService.comment(user.id, taskId, taskCommentDto);
  }

  /************************ DELETE COMMENT *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Delete('comment/delete/:commentId')
  deleteProduct(
    @CurrentUser() user: User,
    @Param('commentId') commentId: number,
  ): Promise<any> {
    return this.tasksService.deleteComment(user.id, commentId);
  }

  /************************ UPDATE COMMENT *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Patch('comment/update/:commentId')
  editComment(
    @CurrentUser() user: User,
    @Param('commentId') commentId: number,
    @Body() taskCommentDto: UpdateTaskCommentDto,
  ): Promise<any> {
    return this.tasksService.editComment(user.id, commentId, taskCommentDto);
  }
}
