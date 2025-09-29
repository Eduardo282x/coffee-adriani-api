import { Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {

    constructor(private readonly notificationsService: NotificationsService) {
        
    }

    @Get()
    async getNotifications() {
        return await this.notificationsService.getNotifications();
    }

    @Put('/mark-read/:id')
    async markAsSeen(@Param('id', ParseIntPipe) id: number) {
        return await this.notificationsService.markAsSeen(id);
    }
}
