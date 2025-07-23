import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// import { Client, LocalAuth } from 'whatsapp-web.js';
// import * as qrcode from 'qrcode-terminal';
import axios from 'axios';

@Injectable()
export class WhatsAppService {

    constructor(private readonly configService: ConfigService) {
        
    }
    // private client: Client;

    private readonly localServerUrl = `${this.configService.get<string>('IP_LOCAL')}/send-message`; // cambia <IP_LOCAL> por tu IP real

    async sendMessage(phone: string, message: string): Promise<string> {
        try {
            await axios.post(this.localServerUrl, { phone, message });
            return `Mensaje enviado a ${phone}`;
        } catch (error) {
            console.error(`Error al enviar mensaje a ${phone}:`, error.message);
            throw new Error(`No se pudo enviar el mensaje a ${phone}`);
        }
    }

    // async onModuleInit() {
    //     this.client = new Client({
    //         authStrategy: new LocalAuth(),
    //         puppeteer: {
    //             headless: true,
    //             args: ['--no-sandbox', '--disable-setuid-sandbox'],
    //         },
    //     });

    //     this.client.on('qr', qr => {
    //         console.log('Escanea el QR con tu WhatsApp:');
    //         qrcode.generate(qr, { small: true });
    //     });

    //     this.client.on('ready', () => {
    //         console.log('WhatsApp Client está listo');
    //     });

    //     await this.client.initialize();
    // }

    // async sendMessage(phone: string, message: string): Promise<string> {
    //     const chatId = `${phone}@c.us`;
    //     await this.client.sendMessage(chatId, message);
    //     return `Mensaje enviado a ${phone}`;
    // }
}
