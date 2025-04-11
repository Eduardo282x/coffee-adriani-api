import { Injectable } from '@nestjs/common';
import { badResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class InvoicesService {

    constructor(private readonly prismaService: PrismaService) {

    }

    async getInvoices() {
        return await this.prismaService.invoice.findMany({
            include: {
                client: true,
            }
        })
    }

    async createInvoice() {
        try {
            const saveInvoice = await this.prismaService.invoice.create({
                data: {
                    clientId: 1,
                    controlNumber: '',
                    status: 'CREATED',
                    dispatchDate: new Date(),
                    dueDate: new Date(),
                    consignment: false,
                    totalAmount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }
            })

            await this.prismaService.invoiceProduct.create({
                data: {
                    invoiceId: saveInvoice.id,
                    productId: 0,
                    quantity: 0,
                    unitPrice: 0,
                    subtotal: 0,
                }
            })

        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
