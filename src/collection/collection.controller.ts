import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { CollectionService } from './collection.service';
import { CollectionDTO, MarkDTO, MessageDTO } from './collection.dto';


@Controller('collection')
export class CollectionController {

    constructor(private readonly collectionService: CollectionService) {

    }

    @Get()
    async getClientCollection() {
        return await this.collectionService.getClientReminder();
    }
    @Get('/add')
    async addClientToCollection() {
        return await this.collectionService.addClientToCollection();
    }
    @Get('/messages')
    async getMessages() {
        return await this.collectionService.getMessages();
    }
    @Post('/messages')
    async createMessages(@Body() message: MessageDTO) {
        return await this.collectionService.createMessages(message);
    }
    @Post('/send-messages')
    async sendMessages() {
        return await this.collectionService.sendMessages();
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
}
