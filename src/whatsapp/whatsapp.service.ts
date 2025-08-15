import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { badResponse, baseResponse, DTOBaseResponse } from 'src/dto/base.dto';
// import axios from 'axios';
// import { badResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { Client, LocalAuth } from 'whatsapp-web.js';

@Injectable()
export class WhatsAppService {

    constructor(private readonly prismaService: PrismaService) {

    }
    private client: Client;

    // private readonly localServerUrl = `${this.configService.get<string>('IP_LOCAL')}/send-message`; // cambia <IP_LOCAL> por tu IP real

    // async sendMessage(phone: string, message: string) {
    //     const getUrlWhatsApp = await this.prismaService.settings.findFirst({ where: { name: 'whatsApp' } })

    //     if (!getUrlWhatsApp || getUrlWhatsApp.value.trim() == '') {
    //         badResponse.message = 'No se encontró una url para whatsApp.'
    //         return badResponse;
    //     }

    //     try {
    //         await axios.post(getUrlWhatsApp.value, { phone, message });
    //         return `Mensaje enviado a ${phone}`;
    //     } catch (error) {
    //         console.error(`Error al enviar mensaje a ${phone}:`, error.message);
    //         throw new Error(`No se pudo enviar el mensaje a ${phone}`);
    //     }
    // }

    async onModuleInit() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                // headless: true,
                // args: ['--no-sandbox', '--disable-setuid-sandbox'],
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor'
                ]
            },
        });

        this.client.on('qr', qr => {
            console.log('Escanea el QR con tu WhatsApp:');
            qrcode.generate(qr, { small: true });
        });

        this.client.on('ready', () => {
            console.log('WhatsApp Client está listo');
        });

        await this.client.initialize();
    }

    async sendMessage(phone: string, message: string): Promise<DTOBaseResponse> {
        try {
            const chatId = `${phone}@c.us`;
            await this.client.sendMessage(chatId, message);
            baseResponse.message = `Mensaje enviado a ${phone}`;
            return baseResponse;
        } catch (err) {
            badResponse.message = `Ha ocurrido un error ${err}`;
            return badResponse;
        }
    }
}
