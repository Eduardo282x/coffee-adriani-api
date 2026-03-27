import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { DTOInventory, DTOInventorySimple } from './inventory.dto';

@Controller('inventory')
export class InventoryController {

    constructor(private readonly inventoryService: InventoryService) {

    }

    @Get()
    async getInventory() {
        return await this.inventoryService.getInventory();
    }
    @Get('/history')
    async getInventoryHistory(
        @Query('page', ParseIntPipe) page: number,
        @Query('limit', ParseIntPipe) limit: number,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('typeMovement') typeMovement?: 'IN' | 'OUT' | 'EDIT' | '',
        @Query('typeProduct') typeProduct?: string,
        @Query('controlNumber') controlNumber?: string,
    ) {
        return await this.inventoryService.getInventoryHistory({page, limit, startDate, endDate, typeMovement, typeProduct, controlNumber});
    }

    @Post()
    async saveInventory(@Body() inventory: DTOInventory) {
        return await this.inventoryService.saveInventory(inventory);
    }

    @Put('/:id')
    async updateAmountInventory(@Body() inventory: DTOInventorySimple, @Param('id') id: string) {
        return await this.inventoryService.updateAmountInventory(inventory, Number(id));
    }

    @Post('/history/update-control-number')
    async updateHistoryData() {
        return await this.inventoryService.updateHistoryData();
    }
}
