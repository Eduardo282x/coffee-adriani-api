import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ProductsService } from 'src/products/products.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, ProductsService],
  exports: [InventoryService],
})
export class InventoryModule {}
