// // import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// // import { PrismaClient } from '@prisma/client';

// // @Injectable()
// // export class PrismaService
// //   extends PrismaClient
// //   implements OnModuleDestroy, OnModuleInit
// // {

// //   async onModuleInit() {
// //     await this.$connect();
// //   }

// //   async onModuleDestroy() {
// //     await this.$disconnect();
// //   }
// // }
// import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// import { PrismaClient } from '@prisma/client';
// import { ConfigService } from '@nestjs/config';

// @Injectable()
// export class PrismaService
//   extends PrismaClient
//   implements OnModuleDestroy, OnModuleInit
// {
//   // constructor(private readonly configService: ConfigService) {
//   //   super({
//   //     datasources: [
//   //       {
//   //         url: configService.get<boolean>('IS_STAGING')
//   //           ? configService.get<string>('DATABASE_URL')
//   //           : configService.get<string>('DATABASE_URL2'),
//   //       },
//   //     ],
//   //   });
//   // }

//   constructor(private readonly configService: ConfigService) {
//     super({
//       datasources: {
//         db: {
//           url: configService.get<boolean>('IS_STAGING')
//             ? configService.get<string>('DATABASE_URL')
//             : configService.get<string>('DATABASE_URL2'),
//         },
//       },
//     });
//   }

//   async onModuleInit() {
//     await this.$connect();
//   }

//   async onModuleDestroy() {
//     await this.$disconnect();
//   }
// }
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService extends PrismaClient {
  private stagingDatabaseUrl: string;
  private productionDatabaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    super();
    this.stagingDatabaseUrl = configService.get<string>('DATABASE_URL');
    this.productionDatabaseUrl = configService.get<string>(
      'DATABASE_URL_PRODUCTION',
    );
    this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async useStagingDatabase() {
    this.$disconnect();
    this.$connect();
  }

  async useProductionDatabase() {
    this.$disconnect();
    process.env.DATABASE_URL = this.productionDatabaseUrl;
    this.$connect();
  }
}
