import { Body, Controller, Get, Post } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { DTOInventory } from './inventory.dto';

@Controller('inventory')
export class InventoryController {

    constructor(private readonly inventoryService: InventoryService) {

    }

    @Get()
    async getInventory() {
        return await this.inventoryService.getInventory();
    }
    @Get('/history')
    async getInventoryHistory() {
        return await this.inventoryService.getInventoryHistory();
    }

    @Post()
    async saveInventory(@Body() inventory: DTOInventory){
        return await this.inventoryService.saveInventory(inventory);
    }
}
