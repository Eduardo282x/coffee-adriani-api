import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTOBaseResponse } from 'src/dto/base.dto';
import { InvoicesService } from 'src/invoices/invoices.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CollectionDTO, MarkDTO, MessageDTO } from './collection.dto';
import { ResponseInvoice } from 'src/invoices/invoice.dto';
import { WhatsAppService } from 'src/whatsapp/whatsapp.service';
import * as ExcelJS from 'exceljs';

@Injectable()
export class CollectionService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly invoiceService: InvoicesService,
        private readonly whatsAppService: WhatsAppService,
    ) {
    }

    async getClientReminder() {
        try {
            const invoicesExpired: ResponseInvoice = await this.invoiceService.getInvoicesExpired() as ResponseInvoice;

            // Crear un Map para búsquedas O(1) en lugar de find() O(n)
            const invoicesMap = new Map();
            if (invoicesExpired.invoices && invoicesExpired.invoices.length > 0) {
                invoicesExpired.invoices.forEach(inv => {
                    if (inv.client?.id && inv.invoices) {
                        invoicesMap.set(inv.client.id, inv.invoices);
                    }
                });
            }

            const clientReminders = await this.prismaService.clientReminder.findMany({
                include: {
                    client: { include: { block: true } },
                    message: true
                },
                orderBy: {
                    id: 'asc'
                }
            });

            // Procesar solo los clientes que tienen facturas vencidas
            const response = clientReminders
                .map(data => {
                    const clientInvoices = invoicesMap.get(data.clientId);

                    if (!clientInvoices) {
                        return null;
                    }

                    // Calcular total una sola vez
                    const total = clientInvoices.reduce((acc, inv) => acc + Number(inv.totalAmount), 0);

                    return {
                        ...data,
                        invoices: clientInvoices,
                        total
                    };
                })
                .filter(Boolean); // Más eficiente que comparar con null

            return response;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getClientReminderHistory() {
        try {
            const response = await this.prismaService.clientReminderHistory.findMany({
                include: {
                    client: true,
                    message: true
                },
                orderBy: {
                    id: 'desc'
                }
            });

            return response;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async exportExcelCollection() {
        const collection = await this.prismaService.clientReminder.findMany({
            include: {
                client: { include: { block: true, } },
                message: true
            },
            orderBy: {
                id: 'asc'
            }
        });

        const invoicesClients = await this.prismaService.invoice.findMany({
            where: {
                clientId: {
                    in: collection.map(col => col.clientId)
                },
                status: 'Vencida'
            },
            include: {
                client: { include: { block: true } },
            },
            orderBy: {
                clientId: 'asc'
            }
        })

        const workbook = new ExcelJS.Workbook();

        // Hoja 1 - Cobranza
        const ws1 = workbook.addWorksheet('Cobranza');

        const headerCollection = [
            'Cliente', 'Teléfono', 'Bloque', 'Dirección', 'Zona', 'Mensaje', 'Enviar'
        ];

        ws1.addRow(headerCollection);
        ws1.getRow(1).font = { bold: true };

        collection.map(item => {
            const rowData = [
                item.client.name,
                item.client.phone,
                item.client.block.name,
                item.client.address,
                item.client.zone,
                item.message.content,
                item.send ? 'Sí' : 'No'
            ]

            const row = ws1.addRow(rowData);

            row.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: item.send ? 'dbeafe' : 'ffe2e2' },
            };
        })

        const ws2 = workbook.addWorksheet('Facturas');

        const headerInvoices = [
            'N° Control', 'Cliente', 'Teléfono', 'Bloque', 'Dirección', 'Zona', 'Estado', 'Fecha Despacho', 'Fecha Vencimiento', 'Total', 'Debe'
        ];

        ws2.addRow(headerInvoices);
        ws2.getRow(1).font = { bold: true };

        invoicesClients.map(item => {
            const rowData = [
                item.controlNumber,
                item.client.name,
                item.client.phone,
                item.client.block.name,
                item.client.address,
                item.client.zone,
                item.status,
                item.dispatchDate,
                item.dueDate,
                Number(item.totalAmount),
                Number(item.remaining)
            ]
            ws2.addRow(rowData);
        });

        const arrayBuffer = await workbook.xlsx.writeBuffer();
        const buffer = Buffer.from(arrayBuffer); // <-- Conversión correcta
        return buffer;
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
            const today = new Date();
            today.setHours(0, 0, 0, 0); // inicio del día

            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);

            const reminder = await this.prismaService.clientReminder.findMany({
                where: {
                    send: true,
                    OR: [
                        { sentAt: null }, // nunca enviados
                        {
                            NOT: {
                                sentAt: {
                                    gte: today,
                                    lt: tomorrow, // excluye si fue enviado entre el inicio de hoy y mañana
                                },
                            },
                        },
                    ],
                },
                include: {
                    client: true,
                    message: true
                },
            });

            const removeDuplicates = [...new Map(reminder.map(item => [item.client.phone, item])).values()];

            let responseMessages = [];

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
            for (let i = 0; i < removeDuplicates.length; i += chunkSize) {
                chunks.push(removeDuplicates.slice(i, i + chunkSize));
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
                        });

                        await this.prismaService.clientReminderHistory.create({
                            data: {
                                clientId: rem.client.id,
                                messageId: rem.message.id,
                                description: `Cliente ${rem.client.name} numero de teléfono ${rem.client.phone} no valido.`,
                                sended: false,
                                sentAt: new Date()
                            }
                        });

                        return;
                    }

                    try {
                        const response: DTOBaseResponse = await this.whatsAppService.sendMessage(phone, rem.message.content);
                        if (response.success) {
                            responseMessages.push(response);
                            await this.prismaService.clientReminder.update({
                                where: { id: rem.id },
                                data: { sentAt: new Date() }
                            });
                            await this.prismaService.clientReminderHistory.create({
                                data: {
                                    clientId: rem.client.id,
                                    messageId: rem.message.id,
                                    description: '',
                                    sended: true,
                                    sentAt: new Date()
                                }
                            });
                            console.log(`Mensaje enviado a ${rem.client.name}`);
                        } else {
                            await this.prismaService.errorMessages.create({
                                data: {
                                    from: 'CollectionService WhatsApp',
                                    message: response.message
                                }
                            })
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
                    message: `Mensajes enviados exitosamente a ${responseMessages.length} de ${removeDuplicates.length}.`
                }
            })

            baseResponse.message = `Mensajes enviados exitosamente a ${responseMessages.length} de ${removeDuplicates.length}.`
            return baseResponse;
        } catch (err) {
            console.error('Error en envío masivo:', err);
            return { message: 'Error enviando mensajes', error: err.message };
        }
    }
}
