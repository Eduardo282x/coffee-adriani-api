import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { N8nInvoicePayload } from './n8n.interfaces';

@Injectable()
export class N8nService {

    constructor(private readonly configService: ConfigService) {}

    private async postWebhook(payload: N8nInvoicePayload): Promise<void> {
        try {
            const url = this.configService.get<string>('N8N_WEBHOOK_URL');

            if (!url) {
                console.warn('N8N_WEBHOOK_URL is not configured');
                return;
            }

            await axios.post(url, payload);
        } catch (error: any) {
            console.error('Failed to send notification to n8n:', error.message);
        }
    }

    async sendInvoiceCreated(payload: N8nInvoicePayload): Promise<void> {
        await this.postWebhook(payload);
    }

    async sendInvoicePaymentAssociated(payload: N8nInvoicePayload): Promise<void> {
        await this.postWebhook(payload);
    }
}
