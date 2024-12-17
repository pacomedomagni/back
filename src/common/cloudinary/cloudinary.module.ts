import { Global, Module } from '@nestjs/common';
import { CloudinaryProvider } from './cloudinary.provider';
import { CloudinaryService } from './cloudinary.service';
import { BullModule } from '@nestjs/bull';
import { FileProcessor } from './file.processor';
import { PrismaService } from '../prisma';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'file-upload',
    }),
  ],
  providers: [
    CloudinaryProvider,
    CloudinaryService,
    FileProcessor,
    PrismaService,
  ],
  exports: [CloudinaryProvider, CloudinaryService, BullModule],
})
export class CloudinaryModule {}
