import { Injectable, Logger } from '@nestjs/common';
import { UploadApiErrorResponse, UploadApiResponse, v2 } from 'cloudinary';
import toStream = require('buffer-to-stream');
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  constructor(
    @InjectQueue('file-upload')
    private readonly fileUploadQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  // Uncomment this if you want to test Redis connection
  // onModuleInit() {
  //   this.logger.debug('Initializing Bull queue listeners...');

  //   this.fileUploadQueue.on('failed', (job, error) => {
  //     this.logger.error(`Job failed for ID ${job.id}: ${error.message}`);
  //     this.logger.error(error.stack);
  //   });

  //   this.fileUploadQueue.on('completed', (job) => {
  //     this.logger.log(`Job completed successfully for ID ${job.id}`);
  //   });

  //   this.fileUploadQueue.on('stalled', (job) => {
  //     this.logger.warn(`Job stalled for ID ${job.id}`);
  //   });

  //   this.checkRedisConnection();
  // }

  async getQueueStatus() {
    const waiting = await this.fileUploadQueue.getWaitingCount();
    const active = await this.fileUploadQueue.getActiveCount();
    const delayed = await this.fileUploadQueue.getDelayedCount();
    const failed = await this.fileUploadQueue.getFailedCount();
    const completed = await this.fileUploadQueue.getCompletedCount();

    return {
      waiting,
      active,
      delayed,
      failed,
      completed,
    };
  }

  async clearFailedJobs() {
    const failedJobs = await this.fileUploadQueue.getFailed();
    for (const job of failedJobs) {
      await job.remove();
    }
    return { message: 'Failed jobs cleared' };
  }

  async clearCompletedJobs() {
    const completedJobs = await this.fileUploadQueue.getCompleted();
    for (const job of completedJobs) {
      await job.remove();
    }
    return { message: 'completed jobs cleared' };
  }

  // This is used to check Redis connection
  async checkRedisConnection() {
    try {
      const redisConfig = `redis://:${this.configService.get<string>(
        'REDIS_PASSWORD',
      )}@${this.configService.get<string>(
        'REDIS_HOST',
      )}:${this.configService.get<number>('REDIS_PORT')}`;

      this.logger.debug(`Connecting to Redis: ${redisConfig}`);
      const client = this.fileUploadQueue.client;
      const c = await client.ping();
      this.logger.log('Redis connection is healthy', c);
    } catch (error) {
      this.logger.error('Redis connection failed:', error.message);
    }
  }

  async queueFileUpload({ file, entityType, entityId, companyId }) {
    try {
      this.checkRedisConnection();
      this.logger.debug(`Adding queueFileUpload job to queue...`);

      // Add the job to the queue
      const c = await this.fileUploadQueue.add(
        'fileProcessor',
        {
          file,
          entityType,
          entityId,
          companyId,
        },
        {
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );

      this.logger.verbose('Successfully processed file', c);

      console.log(await this.getQueueStatus());
    } catch (error) {
      this.logger.error('Error while queuing file upload:', error.message);
      this.logger.error(error.stack);
      throw error;
    }
  }

  async uploadImage(
    file: Express.Multer.File,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return this.uploadToCloudinary(file);
  }

  async uploadImages(
    files: Express.Multer.File[],
  ): Promise<(UploadApiResponse | UploadApiErrorResponse)[]> {
    //console.log(files);
    const uploadPromises = files?.map((file) => this.uploadToCloudinary(file));
    return Promise.all(uploadPromises);
  }

  async deleteImage(publicId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      v2.uploader.destroy(publicId, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private uploadToCloudinary(
    file: Express.Multer.File,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return new Promise((resolve, reject) => {
      if (!file.mimetype.startsWith('image')) {
        reject(new Error('Sorry, this file is not an image, please try again'));
        return;
      }

      const upload = v2.uploader.upload_stream(
        { folder: 'noslag' },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        },
      );
      toStream(file.buffer).pipe(upload);
    });
  }
}
