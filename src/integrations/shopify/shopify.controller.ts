// import {
//   Controller,
//   Get,
//   Post,
//   Body,
//   Patch,
//   Param,
//   Delete,
// } from '@nestjs/common';
// import { ShopifyService } from './shopify.service';
// import { CreateShopifyDto } from './dto/create-shopify.dto';
// import { UpdateShopifyDto } from './dto/update-shopify.dto';

// @Controller('api/v1/shopify')
// export class ShopifyController {
//   constructor(private readonly shopifyService: ShopifyService) {}

//   // @Get('products')
//   // async getProducts() {
//   //   return this.shopifyService.getProducts();
//   // }

//   // @Post('products')
//   // async createProduct(@Body() productData: any) {
//   //   return this.shopifyService.createProduct(productData);
//   // }

//   // @Post()
//   // create(@Body() createShopifyDto: CreateShopifyDto) {
//   //   return this.shopifyService.create(createShopifyDto);
//   // }

//   // @Get()
//   // findAll() {
//   //   return this.shopifyService.findAll();
//   // }

//   // @Get(':id')
//   // findOne(@Param('id') id: string) {
//   //   return this.shopifyService.findOne(+id);
//   // }

//   // @Patch(':id')
//   // update(@Param('id') id: string, @Body() updateShopifyDto: UpdateShopifyDto) {
//   //   return this.shopifyService.update(+id, updateShopifyDto);
//   // }

//   // @Delete(':id')
//   // remove(@Param('id') id: string) {
//   //   return this.shopifyService.remove(+id);
//   // }
// }

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ShopifyService } from './shopify.service';
import * as crypto from 'crypto';
import { JwtGuard } from 'src/common/guards/jwtAuth.guard';
import { CurrentUser, Roles } from 'src/common/decorators';
import { User } from '@prisma/client';

@Controller('api/v1/shopify')
export class ShopifyController {
  constructor(private readonly shopifyService: ShopifyService) {}

  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('integrate')
  async install(@Query('shop') shop: string, @Res() res: Response) {
    if (!shop) {
      return res.status(400).send('Missing shop parameter');
    }
    const state = crypto.randomBytes(16).toString('hex');

    const installUrl = this.shopifyService.getInstallUrl(shop, state);
    console.log(installUrl);
    res.cookie('state', state);
    res.redirect(installUrl);
  }
  //https://test.noslag.com/?hmac=7ef7d573ff41f8c124052944a0727bb3691652052447905584d2ac6372acba87&host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvbm9zbGFn&shop=noslag.myshopify.com&timestamp=1716938936
  @UseGuards(JwtGuard)
  @Roles('ADMIN', 'EMPLOYEE')
  @Get('callback')
  async callback(
    @Query() query: any,
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { shop, hmac, code } = query;
    //const stateCookie = req.cookies['state'];
    // console.log('stateCookie ', stateCookie);
    // if (state !== stateCookie) {
    //   return res.status(403).send('Request origin cannot be verified');
    // }

    // if (!this.shopifyService.verifyHmac(query)) {
    //   return res.status(400).send('HMAC validation failed');
    // }

    const accessToken = await this.shopifyService.getAccessToken(shop, code);
    console.log('accessToken ', accessToken);
    await this.shopifyService.storeAccessToken(shop, accessToken, user.id);

    res.status(200).send('Shopify integration successful');
  }

  @Get('products')
  async getProducts(
    @Query('shop') shop: string,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const products = await this.shopifyService.getProducts(shop, user.id);
    res.status(200).json(products);
  }

  @Get('orders')
  async getOrders(
    @Query('shop') shop: string,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const orders = await this.shopifyService.getOrders(shop, user.id);
    res.status(200).json(orders);
  }

  @Post('products')
  async createProduct(
    @Query('shop') shop: string,
    @CurrentUser() user: User,
    @Body() productData: any,
    @Res() res: Response,
  ) {
    const product = await this.shopifyService.createProduct(
      shop,
      productData,
      user.id,
    );
    res.status(201).json(product);
  }
}
