import { Test, TestingModule } from '@nestjs/testing';
import { EbayController } from './ebay.controller';
import { EbayService } from './ebay.service';

describe('EbayController', () => {
  let controller: EbayController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EbayController],
      providers: [EbayService],
    }).compile();

    controller = module.get<EbayController>(EbayController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
