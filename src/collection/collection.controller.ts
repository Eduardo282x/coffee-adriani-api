import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Res } from '@nestjs/common';
import { CollectionService } from './collection.service';
import { CollectionDTO, MarkDTO, MessageDTO } from './collection.dto';
import { Response } from 'express';

@Controller('collection')
export class CollectionController {

    constructor(private readonly collectionService: CollectionService) {

    }

    @Get()
    async getClientCollection() {
        return await this.collectionService.getClientReminder();
    }
    @Get('/history')
    async getClientReminderHistory() {
        return await this.collectionService.getClientReminderHistory();
    }
    @Get('/add')
    async addClientToCollection() {
        return await this.collectionService.addClientToCollection();
    }
    @Get('/messages')
    async getMessages() {
        return await this.collectionService.getMessages();
    }


    @Get('/export')
    async exportInvoicesExcel(@Res() res: Response) {
        const buffer = await this.collectionService.exportExcelCollection();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Cobranza.xlsx');
        res.send(buffer);
    }

    @Post('/messages')
    async createMessages(@Body() message: MessageDTO) {
        return await this.collectionService.createMessages(message);
    }
    @Post('/send-messages')
    async sendMessages() {
        return await this.collectionService.sendMessages();
    }
    @Put('/message-clients/:id')
    async markMessageClients(@Param('id', ParseIntPipe) id: number) {
        return await this.collectionService.markMessageClients(id);
    }
    @Put('/mark-message')
    async updateMarkMessage(@Body() mark: MarkDTO) {
        return await this.collectionService.updateMarkMessage(mark);
    }
    @Put('/messages/:id')
    async updateMessages(@Param('id', ParseIntPipe) id: number, @Body() message: MessageDTO) {
        return await this.collectionService.updateMessages(id, message);
    }
    @Put('/:id')
    async updateClientCollection(@Param('id', ParseIntPipe) id: number, @Body() data: CollectionDTO) {
        return await this.collectionService.updateClientCollection(id, data);
    }
    @Delete('/messages/:id')
    async deleteMessages(@Param('id', ParseIntPipe) id: number) {
        return await this.collectionService.deleteMessages(id);
    }
}
