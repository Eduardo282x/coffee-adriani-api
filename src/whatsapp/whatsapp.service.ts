import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';

@Injectable()
export class WhatsAppService implements OnModuleInit {
    private client: Client;

    async onModuleInit() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
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

    async sendMessage(phone: string, message: string): Promise<string> {
        const chatId = `${phone}@c.us`;
        await this.client.sendMessage(chatId, message);
        return `Mensaje enviado a ${phone}`;
    }
}
