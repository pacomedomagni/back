import { PartialType } from '@nestjs/swagger';
import { TaskCommentDto } from './comment-task.dto';

export class UpdateTaskCommentDto extends PartialType(TaskCommentDto) {}
