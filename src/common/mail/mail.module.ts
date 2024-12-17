import { Global, Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { MailService } from './mail.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'path';
import { BullModule } from '@nestjs/bull';
import { MailProcessor } from './mail.processor';

@Global()
@Module({
  imports: [
    ConfigModule,
    MailerModule.forRootAsync({
      useFactory: async (configService: ConfigService) => ({
        transport: {
          service: configService.get('MAIL_SERVICE'),
          host: configService.get('MAIL_HOST'),
          port: parseInt(configService.get('MAIL_PORT')),
          secure: false,
          ignoreTLS: true,
          auth: {
            user: configService.get('MAIL_USER'),
            pass: configService.get('MAIL_PASSWORD'),
          },
          pool: true,
          maxConnections: 1,
          rateDelta: 20000,
          rateLimit: 5,
          tls: {
            rejectUnauthorized: false,
          },
          // connectionTimeout: 5000,
          // timeout: 10000,
        },
        defaults: {
          from: `"NoSlag" <${configService.get('MAIL_FROM')}>`,
        },

        template: {
          //dir: process.cwd() + '/dist/common/mail/templates',
          dir: process.cwd() + '/src/common/mail/templates',
          //dir: join(__dirname, 'templates'),

          adapter: new HandlebarsAdapter(),
          options: {
            strict: true,
          },
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'mail',
    }),
  ],
  providers: [MailService, MailProcessor],
  exports: [MailService, BullModule],
})
export class MailModule {}
