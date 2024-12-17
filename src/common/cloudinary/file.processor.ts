import { Logger } from '@nestjs/common';
import { UploadApiErrorResponse, UploadApiResponse, v2 } from 'cloudinary';
import toStream = require('buffer-to-stream');
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from '../prisma';

@Processor('file-upload')
export class FileProcessor {
  private readonly logger = new Logger(FileProcessor.name);

  constructor(private readonly prismaService: PrismaService) {}

  @Process('fileProcessor')
  async handleFileUpload(job: Job) {
    const { file, entityId, entityType, companyId } = job.data;

    try {
      this.logger.debug(
        `Processing FileUpload job (Attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );

      if (entityType === 'task') {
        if (file.buffer && file.buffer.type === 'Buffer') {
          file.buffer = Buffer.from(file.buffer.data);
        }

        await this.handleTaskFileUpload(file, entityId, companyId);
      } else if (entityType === 'product') {
        const convertedFiles = file.map((file) => {
          if (file.buffer && file.buffer.type === 'Buffer') {
            file.buffer = Buffer.from(file.buffer.data);
          }
          return file;
        });

        await this.handleProductFileUpload(convertedFiles, entityId, companyId);
      }

      this.logger.log(
        `File upload and linking completed for ${entityType} with ID ${entityId}`,
      );
    } catch (error) {
      this.logger.error('File upload failed', error.stack);
      throw new Error('File upload failed');
    }
  }

  private async handleTaskFileUpload(
    file: Express.Multer.File,
    entityId: number,
    companyId: number,
  ) {
    this.logger.debug(
      `Uploading file to Cloudinary for task with ID ${entityId}`,
    );

    const imageLink = await this.uploadToCloudinary(file);

    this.logger.debug(`Creating image record for task with ID ${entityId}`);
    const image = await this.prismaService.image.create({
      data: {
        publicId: imageLink.public_id,
        url: imageLink.url,
        companyId,
      },
    });

    this.logger.debug(
      `Linking image with ID ${image.id} to task with ID ${entityId}`,
    );
    await this.prismaService.task.update({
      where: { id: entityId },
      data: { imageId: image.id },
    });

    this.logger.debug(`Updated task with new image: ${JSON.stringify(image)}`);
  }

  private async handleProductFileUpload(
    files: Express.Multer.File[],
    entityId: number,
    companyId: number,
  ) {
    this.logger.debug(
      `Uploading files to Cloudinary for product with ID ${entityId}`,
    );

    const imagesLinks = await Promise.all(
      files.map(async (file) => {
        return this.uploadToCloudinary(file);
      }),
    );

    this.logger.debug(`Creating image records for product with ID ${entityId}`);
    const createdImages = await Promise.all(
      imagesLinks.map(async (imagesLink) => {
        return this.prismaService.image.create({
          data: {
            publicId: imagesLink.public_id,
            url: imagesLink.url,
            companyId,
          },
        });
      }),
    );

    this.logger.debug(`Linking images to product with ID ${entityId}`);
    await this.prismaService.product.update({
      where: { id: entityId },
      data: {
        image: {
          connect: createdImages.map((image) => ({ id: image.id })),
        },
      },
    });

    this.logger.debug(
      `Updated product with new images: ${JSON.stringify(createdImages)}`,
    );
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
