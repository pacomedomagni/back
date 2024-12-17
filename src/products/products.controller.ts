import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  UploadedFiles,
  Put,
  Headers,
  Query,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDto, CreateUploadDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtGuard } from 'src/common/guards/jwtAuth.guard';
import { CurrentUser, Permissions, Roles } from 'src/common/decorators';
import { User } from '@prisma/client';
import { StockDto } from './dto/create-stock.dto';
import { ItemDto, VarianceDto } from './dto/create-variance.dto';
import { PaginationDto } from 'src/common/dto';

@Controller('api/v1/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /************************ CREATE PRODUCT *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createProduct')
  @Put('create')
  @UseInterceptors(FilesInterceptor('files'))
  create(
    @CurrentUser() user: User,
    @Body() createProductDto: CreateProductDto,
    @Body() stockDto: StockDto,
    @Body() varianceDto: VarianceDto,
    @Body() itemDto: ItemDto,
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5000000 }),
          //new FileTypeValidator({ fileType: 'image/jpeg' }),
        ],
        fileIsRequired: false,
      }),
    )
    files: Array<Express.Multer.File>,
  ) {
    return this.productsService.createProduct(
      user.id,
      createProductDto,
      files,
      stockDto,
      //itemDto,
    );
  }

  /************************ UPLOAD PRODUCT *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('createProduct')
  @Put('upload-product')
  uploadProductFile(
    @CurrentUser() user: User,
    @Body() createProductDto: CreateUploadDto[],
    @Body() stockDtos: StockDto[],
    @Body() itemDto: ItemDto,
  ) {
    return this.productsService.uploadProducts(
      user.id,
      createProductDto,
      stockDtos,
    );
  }

  /************************ GET ALL PRODUCTS *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  // @Permissions('createProduct')
  @Get('get-all')
  getAllProducts(
    @CurrentUser() user: User,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.productsService.getAllProducts(user.id, paginationDto);
  }

  /************************ GET PRODUCT BY ID *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  //@Permissions('viewProduct')
  @Get(':productId')
  getProductById(
    @CurrentUser() user: User,
    @Param('productId') productId: number,
  ): Promise<any> {
    return this.productsService.getProductById(user.id, productId);
  }

  /************************ DELETE PRODUCT *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('deleteProduct')
  @Delete('delete/:productId')
  deleteProduct(
    @CurrentUser() user: User,
    @Param('productId') productId: number,
  ): Promise<any> {
    return this.productsService.deleteProduct(user.id, productId);
  }

  /************************ DELETE ALL PRODUCT *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('deleteProduct')
  @Delete('delete-all')
  deleteAllProducts(@CurrentUser() user: User): Promise<any> {
    console.log('SECOND ');
    return this.productsService.deleteAllProducts(user.id);
  }

  /************************ UPDATE PRODUCT *****************************/
  // @UseGuards(JwtGuard)
  // @Roles('ADMIN', 'EMPLOYEE')
  // @Permissions('updateProduct')
  // @Put(':productId')
  // updateProduct(
  //   @CurrentUser() user: User,
  //   @Param('productId') productId: number,
  //   @Body() updateProductDto: UpdateProductDto,
  // ): Promise<any> {
  //   return this.productsService.updateProduct(
  //     user.id,
  //     productId,
  //     updateProductDto,
  //   );
  // }

  /************************ EDIT PRODUCT *****************************/
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Permissions('updateProduct')
  @Put('edit/:productId')
  @UseInterceptors(FilesInterceptor('files'))
  editProduct(
    @CurrentUser() user: User,
    @Param('productId') productId: number,
    @Body() updateProductDto: UpdateProductDto,
    @Body() stockDto: StockDto,
    @Body() itemDto: ItemDto,
    @Headers('content-length') contentLength: number,
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          //new MaxFileSizeValidator({ maxSize: 500 }),
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          // new FileTypeValidator({ fileType: 'image/jpeg' }),
        ],
        fileIsRequired: false,
      }),
    )
    files: Array<Express.Multer.File>,
  ): Promise<any> {
    return this.productsService.editProduct(
      user.id,
      updateProductDto,
      productId,
      files,
      stockDto,
      itemDto,
    );
  }
}
