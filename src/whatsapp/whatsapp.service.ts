import { Injectable } from '@nestjs/common';
import * as qrcode from 'qrcode-terminal';
import { badResponse, baseResponse, DTOBaseResponse } from 'src/dto/base.dto';
import { Client, LocalAuth } from 'whatsapp-web.js';

@Injectable()
export class WhatsAppService {

    private client: Client;

    async onModuleInit() {
        this.initializeWhatsAppAsync();
    }

    private async initializeWhatsAppAsync() {
        try {
            console.log('Starting WhatsApp initialization...');

            this.client = new Client({
                authStrategy: new LocalAuth(),
                puppeteer: {
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
                }
            });

            this.client.on('qr', qr => {
                console.log('Escanea el QR con tu WhatsApp:');
                qrcode.generate(qr, { small: true });
            });

            this.client.on('ready', () => {
                console.log('WhatsApp Client is ready!');
            });

            this.client.on('disconnected', (reason) => {
                console.log('WhatsApp Client disconnected:', reason);
            });

            await this.client.initialize();

            console.log('WhatsApp initialization completed successfully.');


        } catch (error) {
            console.error('WhatsApp initialization failed:', error);
            // Continuar sin WhatsApp en lugar de crashear toda la app
        }
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
