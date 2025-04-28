import { ProductsService } from 'src/products/products.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from 'src/prisma/prisma.service';
import { InvoicesService } from 'src/invoices/invoices.service';

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
            const rate = await this.fetchDollarRateFromBCV();
            this.logger.debug(`💵 Tasa BCV actualizada: ${rate}`);
        } catch (error) {
            this.logger.debug('❌ Error al obtener la tasa del dólar BCV', error.message);
        }
    }

    @Cron('0 6 * * *')
    async checkInvoice() {
        const invoices = await this.prismaService.invoice.findMany({
            include: {
                client: true,
                invoiceItems: true
            }
        })

        invoices.map(async (inv) => {
            if (this.isDateExpired(inv.dueDate)) {
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

    private async fetchDollarRateFromBCV() {
        const response: Dolar = await axios.get('https://pydolarve.org/api/v2/tipo-cambio?currency=usd&format_date=default&rounded_price=true').then(res => res.data);
        await this.productService.saveDolar(response);
        return response.price;
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
