import { ProductsService } from 'src/products/products.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';

export interface Dolar {
    change: number;
    color: string;
    image: string;
    last_update: string;
    percent: number;
    price: number;
    price_old: number;
    symbol: string;
    title: string;
}

@Injectable()
export class DolarService {
    constructor(
        private readonly prismaService: PrismaService,
    ) { }

    private readonly logger = new Logger(DolarService.name);
    private readonly productService = new ProductsService(this.prismaService);

    @Cron('0 8,13 * * *')
    async handleDollarRateCheck() {
        try {
            await this.productService.saveDolarAutomatic();
            this.logger.debug(`💵 Tasa BCV actualizada`);
        } catch (error) {
            await this.prismaService.errorMessages.create({
                data: { message: error.message, from: 'DolarService' }
            })
            this.logger.debug('❌ Error al obtener la tasa del dólar BCV', error.message);
        }
    }

    @Cron('0 6 * * *')
    async checkInvoice() {
        const invoices = await this.prismaService.invoice.findMany({
            include: {
                client: true,
                invoiceItems: true
            },
            where: {
                status: {
                    not: {
                        in: ['Pagado', 'Cancelada']
                    }
                }
            }
        })

        invoices.map(async (inv) => {
            if (this.isDateExpired(inv.dispatchDate) && inv.status == 'Creada') {
                await this.prismaService.invoice.update({
                    where: { id: inv.id },
                    data: { status: 'Pendiente' }
                })
            }

            if (this.isDateExpired(inv.dueDate) && inv.status == 'Pendiente') {
                await this.prismaService.invoice.update({
                    where: { id: inv.id },
                    data: { status: 'Vencida' }
                })
            }
        })
    }

    isDateExpired(dueDate: Date): boolean {
        const today = new Date();
        const cleanDueDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
        const cleanToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        return cleanDueDate < cleanToday;
    }
}

export function parseCustomDate(dateStr: string): Date {
    const [datePart, timePart] = dateStr.split(',').map(part => part.trim());

    const [day, month, year] = datePart.split('/').map(Number);
    let [time, meridian] = timePart.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (meridian.toUpperCase() === 'PM' && hours < 12) {
        hours += 12;
    } else if (meridian.toUpperCase() === 'AM' && hours === 12) {
        hours = 0;
    }

    return new Date(year, month - 1, day, hours, minutes);
}
