import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { DTOClients } from './client.dto';

@Controller('clients')
export class ClientsController {

    constructor(private clientService: ClientsService) {
    }

    @Get()
    async getClients() {
        return await this.clientService.getClients();
    }
    @Post()
    async createClients(@Body() client: DTOClients) {
        return await this.clientService.createClients(client);
    }
    @Put('/:id')
    async updateClients(@Param('id') id: string, @Body() client: DTOClients) {
        return await this.clientService.updateClients(Number(id), client);
    }
    @Delete('/:id')
    async deleteClients(@Param('id') id: string) {
        return await this.clientService.deleteClients(Number(id));
    }

    @Get('/blocks')
    async getBlocks() {
        return await this.clientService.getBlocks();
    }
    @Post('/blocks')
    async createBlocks(@Body() client: DTOClients) {
        return await this.clientService.createBlocks(client);
    }
    @Put('/blocks/:id')
    async updateBlocks(@Param('id') id: string, @Body() client: DTOClients) {
        return await this.clientService.updateBlocks(Number(id), client);
    }
    @Delete('/blocks/:id')
    async deleteBlocks(@Param('id') id: string) {
        return await this.clientService.deleteBlocks(Number(id));
    }
}
