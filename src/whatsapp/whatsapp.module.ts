import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
    controllers: [WhatsAppController],
    providers: [WhatsAppService, PrismaService],
    exports: [WhatsAppService]
})
export class WhatsAppModule { }
