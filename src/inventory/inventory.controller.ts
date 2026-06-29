import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { DTOInventory, DTOInventorySimple, DTOUpdateHistoryInventory, CreateInventoryEntryDTO, InventoryEntryFilterDTO } from './inventory.dto';

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

    @Put('/history')
    async updateHistoryInventory(@Body() inventory: DTOUpdateHistoryInventory) {
        return await this.inventoryService.updateHistoryInventory(inventory);
    }

    @Post('/history/update-control-number')
    async updateHistoryData() {
        return await this.inventoryService.updateHistoryData();
    }

    @Post('/migrate')
    async migrateHistoryInventory() {
        try {
            return await this.inventoryService.migrateHistoryInventory();
        } catch (error) {
            console.error('Error migrating history inventory:', error);
            throw error;
        }
    }

    @Get('/entries')
    async getInventoryEntries(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('typeMovement') typeMovement?: string,
        @Query('typeProduct') typeProduct?: string,
        @Query('controlNumber') controlNumber?: string,
        @Query('supplierId') supplierId?: string,
    ) {
        return await this.inventoryService.getInventoryEntries({
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 50,
            startDate,
            endDate,
            typeMovement,
            typeProduct,
            controlNumber,
            supplierId: supplierId ? parseInt(supplierId) : undefined,
        });
    }

    @Get('/entries/:id')
    async getInventoryEntryById(@Param('id', ParseIntPipe) id: number) {
        return await this.inventoryService.getInventoryEntryById(id);
    }

    @Post('/entries')
    async createInventoryEntry(@Body() data: CreateInventoryEntryDTO) {
        return await this.inventoryService.createInventoryEntry(data);
    }

    @Put('/entries/:id')
    async updateInventoryEntry(@Param('id', ParseIntPipe) id: number, @Body() data: CreateInventoryEntryDTO) {
        return await this.inventoryService.updateInventoryEntry(id, data);
    }

    @Delete('/entries/:id')
    async deleteInventoryEntry(@Param('id', ParseIntPipe) id: number) {
        return await this.inventoryService.deleteInventoryEntry(id);
    }

    @Get('/enterprise')
    async getEnterpriseEntries(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('controlNumber') controlNumber?: string,
        @Query('supplierId') supplierId?: string,
    ) {
        return await this.inventoryService.getEnterpriseEntries({
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 50,
            startDate,
            endDate,
            controlNumber,
            supplierId: supplierId ? parseInt(supplierId) : undefined,
        });
    }

    @Get('/enterprise/:id')
    async getEnterpriseEntryById(@Param('id', ParseIntPipe) id: number) {
        return await this.inventoryService.getEnterpriseEntryById(id);
    }
}
