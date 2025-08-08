import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { InvoicesService } from 'src/invoices/invoices.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CollectionDTO, MarkDTO, MessageDTO } from './collection.dto';
import { IInvoice, ResponseInvoice } from 'src/invoices/invoice.dto';
import { WhatsAppService } from 'src/whatsapp/whatsapp.service';

@Injectable()
export class CollectionService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly invoiceService: InvoicesService,
        private readonly whatsAppService: WhatsAppService,
        private readonly configService: ConfigService,
    ) {
    }

    async getClientReminder() {
        try {
            const invoicesExpired: ResponseInvoice = await this.invoiceService.getInvoicesExpired() as ResponseInvoice;

            const response = await this.prismaService.clientReminder.findMany({
                include: {
                    client: { include: { block: true, } },
                    message: true
                },
                orderBy: {
                    id: 'asc'
                }
            }).then(item => item.map(data => {
                const arrayInvoices = invoicesExpired.invoices && invoicesExpired.invoices.length > 0 ? invoicesExpired.invoices : []
                const findClient = arrayInvoices.find(inv => inv.client.id == data.clientId);

                if (!findClient || !findClient.invoices) {
                    return null;
                }
                return {
                    ...data,
                    invoices: findClient.invoices,
                    total: findClient.invoices.reduce((acc, inv) => acc + Number(inv.totalAmount), 0)
                }
            }));

            return response.filter(data => data !== null);
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getMessages() {
        return await this.prismaService.message.findMany({
            orderBy: { id: 'asc' }
        });
    }
    async createMessages(message: MessageDTO) {
        try {
            await this.prismaService.message.create({
                data: {
                    title: message.title,
                    content: message.content
                }
            });

            baseResponse.message = 'Mensaje guardado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
    async updateMessages(id: number, message: MessageDTO) {
        try {
            await this.prismaService.message.update({
                where: { id },
                data: {
                    title: message.title,
                    content: message.content
                }
            });

            baseResponse.message = 'Mensaje actualizado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
    async deleteMessages(id: number) {
        try {
            await this.prismaService.message.delete({
                where: { id },
            });

            baseResponse.message = 'Mensaje eliminado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async markMessageClients(messageId: number) {
        try {
            const findMessageSelected = await this.prismaService.message.findFirst({ where: { id: messageId } })

            await this.prismaService.clientReminder.updateMany({
                data: {
                    messageId
                }
            });

            baseResponse.message = `Mensajes ${findMessageSelected.title} marcado para todos.`
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async updateMarkMessage(mark: MarkDTO) {
        try {
            await this.prismaService.clientReminder.updateMany({
                data: {
                    send: mark.send,
                }
            });

            baseResponse.message = `Mensajes marcados para ${mark.send ? 'Enviar' : 'No enviar'}.`
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async updateClientCollection(id: number, data: CollectionDTO) {
        try {
            await this.prismaService.clientReminder.update({
                where: { id },
                data: {
                    messageId: data.messageId,
                    send: data.send
                }
            });

            baseResponse.message = 'Mensaje actualizado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async addClientToCollection() {
        try {
            const invoicesExpired = await this.invoiceService.getInvoicesExpired() as unknown as ResponseInvoice;
            const clientList = invoicesExpired.invoices.map((inv) => {
                return {
                    clientId: inv.client.id,
                    messageId: 1,
                    send: true
                }
            })
            await this.prismaService.clientReminder.createMany({
                data: clientList
            })
            baseResponse.message = 'Clientes agregados a la cobranza'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async sendMessages() {
        try {
            const reminder = await this.prismaService.clientReminder.findMany({
                where: { send: true, sentAt: { not: new Date() } },
                include: {
                    client: true,
                    message: true
                }
            });

            let responseMessages = [];
            const getUrlWhatsApp = await this.prismaService.settings.findFirst({ where: { name: 'whatsApp' } })

            if (!getUrlWhatsApp || getUrlWhatsApp.value.trim() == '') {
                badResponse.message = 'No se encontró una url para whatsApp.'
                return badResponse;
            }

            const adjustPhone = (phone: string): string | null => {
                if (typeof phone !== 'string') return null;
                if (phone.includes('-')) return null;
                if (phone.length <= 5) return null;

                if (phone.startsWith('0') && phone.length === 11) {
                    return '58' + phone.slice(1);
                }
                return phone;
            };

            const chunkSize = 30;
            const delayBetweenChunks = 90_000; // 1.5 minutos

            const delay = (ms: number) =>
                new Promise(resolve => setTimeout(resolve, ms));

            // Agrupar en lotes de 30
            const chunks = [];
            for (let i = 0; i < reminder.length; i += chunkSize) {
                chunks.push(reminder.slice(i, i + chunkSize));
            }

            for (let i = 0; i < chunks.length; i++) {
                const group = chunks[i];

                const promises = group.map(async rem => {
                    const phone: string | null = adjustPhone(rem.client.phone);

                    if (phone == null) {
                        await this.prismaService.errorMessages.create({
                            data: {
                                from: 'CollectionService WhatsApp',
                                message: `Error al enviar mensaje al cliente ${rem.client.name} numero de teléfono ${rem.client.phone} no valido.`
                            }
                        })

                        return;
                    }

                    try {
                        // const response = await this.whatsAppService.sendMessage(phone, rem.message.content);
                        const response = await axios.post(getUrlWhatsApp.value, { phone, message: rem.message.content });
                        if (response) {
                            responseMessages.push(response);
                            await this.prismaService.clientReminder.update({
                                where: { id: rem.id },
                                data: { sentAt: new Date() }
                            });
                            console.log(`Mensaje enviado a ${rem.client.name}`);
                        }

                    } catch (err) {
                        console.error(`Error enviando a ${rem.client.name}: ${err.message}`);
                    }
                });

                await Promise.all(promises);

                // No esperar después del último grupo
                if (i < chunks.length - 1) {
                    console.log(`Esperando ${delayBetweenChunks / 1000} segundos para siguiente lote...`);
                    await delay(delayBetweenChunks);
                }
            }

            await this.prismaService.errorMessages.create({
                data: {
                    from: 'CollectionServiceWhatApp Success',
                    message: `Mensajes enviados exitosamente a ${responseMessages.length} de ${reminder.length}.`
                }
            })

            baseResponse.message = `Mensajes enviados exitosamente a ${responseMessages.length} de ${reminder.length}.`
            return baseResponse;
        } catch (err) {
            console.error('Error en envío masivo:', err);
            return { message: 'Error enviando mensajes', error: err.message };
        }
    }


    // async sendReminder(clientId: number) {
    //     const reminder = await this.prismaService.clientReminder.findFirst({
    //         where: { clientId, send: true },
    //         include: {
    //             client: true,
    //             message: true
    //         }
    //     });

    //     if (!reminder) throw new Error('No hay recordatorio configurado.');

    //     const phone = reminder.client.phone; // Asegúrate de tener el formato +58...
    //     const message = reminder.message.content;

    //     const result = await this.sendWhatsAppMessage(phone, message);
    //     // const result = await this.whatsAppService.sendMessage(phone, message);

    //     await this.prismaService.clientReminder.update({
    //         where: { id: reminder.id },
    //         data: { sentAt: new Date() }
    //     });

    //     return result;
    // }

    async sendWhatsAppMessage(phone: string, message: string) {
        const WHATSAPP_TOKEN = this.configService.get<string>('WHATSAPP_TOKEN');
        const WHATSAPP_PHONE_ID = this.configService.get<string>('WHATSAPP_PHONE_ID');

        try {
            const url = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`;

            const response = await axios.post(
                url,
                {
                    messaging_product: 'whatsapp',
                    to: phone,
                    type: 'text',
                    text: {
                        body: message
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('Error al enviar mensaje por WhatsApp:', error.response?.data || error.message);
            throw error;
        }
    }

    async sendWhatsAppMessageTwilio(phone: string, message: string) {
        const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
        const authToken = this.configService.get<string>('TWILIO_ACCOUNT_TOKEN');
        const phoneNumberProvider = this.configService.get<string>('TWILIO_NUMBER_TEXT');

        try {
            const client = require('twilio')(accountSid, authToken);

            client.messages
                .create({
                    body: message,
                    from: `whatsapp:+${phoneNumberProvider}`,
                    to: `whatsapp:+${phone}`
                })
                .then(message => console.log(message.sid))
                .done();

            // return response.data;
        } catch (error) {
            console.error('Error al enviar mensaje por WhatsApp:', error.response?.data || error.message);
            throw error;
        }
    }
}
