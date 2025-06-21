import { Body, Controller, Delete, Get, Param, Post, Put, Res } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { DTOBlocks, DTOClients, DTOReportClients } from './client.dto';
import { Response } from 'express';

@Controller('clients')
export class ClientsController {

    constructor(private readonly clientService: ClientsService) {
    }

    @Get()
    async getClients() {
        return await this.clientService.getClients();
    }
    @Get('/parse')
    async formatNumberClients() {
        return await this.clientService.formatNumberClients();
    }
    @Post()
    async createClients(@Body() client: DTOClients) {
        return await this.clientService.createClients(client);
    }
    
    @Post('/report')
    async reportClients(@Body() report: DTOReportClients, @Res() res: Response) {
        try {
            const pdfBuffer = await this.clientService.reportClients(report) as Buffer;

            res.set({
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename=ReporteClientes.pdf',
                'Content-Length': pdfBuffer.length,
            });

            res.end(pdfBuffer);
        } catch (error) {
            console.error('Error generando PDF:', error);
            res.status(500).send('Error generando PDF');
        }
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
    async createBlocks(@Body() block: DTOBlocks) {
        return await this.clientService.createBlocks(block);
    }
    @Put('/blocks/:id')
    async updateBlocks(@Param('id') id: string, @Body() block: DTOBlocks) {
        return await this.clientService.updateBlocks(Number(id), block);
    }
    @Delete('/blocks/:id')
    async deleteBlocks(@Param('id') id: string) {
        return await this.clientService.deleteBlocks(Number(id));
    }
}
