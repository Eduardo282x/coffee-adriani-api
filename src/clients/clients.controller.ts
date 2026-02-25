import { Body, Controller, Delete, Get, InternalServerErrorException, Param, Post, Put, Res } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { DTOBlocks, DTOClients, DTOReportClients } from './client.dto';
import { Response } from 'express';
import { FastifyReply } from 'fastify';

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
    @Get('/excel')
    async getClientExcel(@Res({ passthrough: true }) res: FastifyReply) {
        const buffer = await this.clientService.getClientExcel();
        res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.header('Content-Disposition', 'attachment; filename=clientes.xlsx');
        return buffer;
    }
    @Post()
    async createClients(@Body() client: DTOClients) {
        return await this.clientService.createClients(client);
    }

    @Post('/report')
    async reportClients(@Body() report: DTOReportClients, @Res({ passthrough: true }) res: FastifyReply) {
        try {
            const pdfBuffer = await this.clientService.reportClients(report) as Buffer;


            // Configuramos los headers
            res.header('Content-Type', 'application/pdf');
            res.header('Content-Disposition', 'attachment; filename=ReporteClientes.pdf');
            res.header('Content-Length', pdfBuffer.length);
            // En Fastify con { passthrough: true }, simplemente retornamos el buffer.
            // NestJS y el adaptador de Fastify se encargan del resto.
            return pdfBuffer;
        } catch (error) {
            console.error('Error generando PDF:', error);
        // Importante: Si lanzas una excepción de NestJS, el passthrough lo manejará mejor
        throw new InternalServerErrorException('Error generando PDF');
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
