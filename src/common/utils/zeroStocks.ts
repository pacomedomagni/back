// import { Injectable } from '@nestjs/common';

// @Injectable()
// export class zeroStocks {
//   public async delete(prismaService, companyId: number) {
//     try {
//       const zeroStocks = await prismaService.stock.findMany({
//         where: {
//           companyId,
//           openingStock: { lte: '0' },
//           committedQuantity: { lte: 0 },
//           active: false,
//         },
//       });
//       console.log('zeroStocks', zeroStocks);
//       if (zeroStocks.length > 0) {
//         await prismaService.stock.deleteMany({
//           where: {
//             id: { in: zeroStocks.map((stock) => stock.id) },
//           },
//         });

//         console.log(`Deleted ${zeroStocks.length} empty/zero stocks.`);
//       }
//     } catch (error) {
//       console.error('Error deleting zero stocks:', error);
//     }
//   }

//   public async updateActiveZeroStock(
//     prismaService,
//     productId: number,
//     companyId: number,
//     status: boolean,
//   ) {
//     try {
//       const zeroStocks = await prismaService.stock.findMany({
//         where: {
//           companyId,
//           active: false,
//           openingStock: { lte: '0' },
//           committedQuantity: { lte: 0 },
//           product: {
//             some: {
//               id: productId,
//             },
//           },
//         },
//       });

//       if (zeroStocks.length > 0) {
//         await prismaService.stock.updateMany({
//           where: {
//             id: { in: zeroStocks.map((stock) => stock.id) },
//           },
//           data: { active: status },
//         });

//         console.log(`Updated ${zeroStocks.length} zero stocks to active.`);
//       }
//     } catch (error) {
//       console.error('Error updating zero stocks to active:', error);
//     }
//   }
// }
