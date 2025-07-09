import { Body, Controller, Post } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppDTO } from './whatsapp.dto';

@Controller('whatsApp')
export class WhatsAppController {

    constructor(private readonly whatsAppService: WhatsAppService) {
        
    }

    @Post('/send')
    async sendMessageWhatsApp(@Body() message: WhatsAppDTO) {
        return await this.whatsAppService.sendMessage(message.phone, message.message);
    }
}
