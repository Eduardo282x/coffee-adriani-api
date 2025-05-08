import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOInvoice, IInvoice } from './invoice.dto';
import { ProductsService } from 'src/products/products.service';
import { InventoryService } from 'src/inventory/inventory.service';

@Injectable()
export class InvoicesService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly productService: ProductsService,
        private readonly inventoryService: InventoryService
    ) {

    }

    async getInvoices() {
        const invoices = await this.prismaService.invoice.findMany({
            include: {
                client: {
                    include: { block: true }
                },
                invoiceItems: {
                    include: {
                        product: true
                    }
                }
            }
        })

        const groupedByClient = invoices.reduce((acc, invoice) => {
            const clientId = invoice.client.id;

            if (!acc[clientId]) {
                acc[clientId] = {
                    client: invoice.client,
                    invoices: [],
                };
            }

            const invoiceWithoutClient = { ...invoice };
            delete invoiceWithoutClient.client; // Eliminar la propiedad client del objeto invoice
            acc[clientId].invoices.push(invoiceWithoutClient);

            return acc;
        }, {} as Record<number, { client: typeof invoices[number]['client'], invoices: typeof invoices }>);

        const result = Object.values(groupedByClient);
        return result;
    }

    async getInvoicesFilter(invoice: DTODateRangeFilter) {
        const invoices = await this.prismaService.invoice.findMany({
            include: {
                client: {
                    include: { block: true }
                },
                invoiceItems: {
                    include: {
                        product: true
                    }
                }
            },
            where: {
                dispatchDate: {
                    gte: invoice.startDate,
                    lte: invoice.endDate
                }
            }
        }).then(inv =>
            inv.map(data => {
                return {
                    ...data,
                    totalAmount: data.totalAmount.toFixed(2)
                }
            })
        )

        const groupedByClient = invoices.reduce((acc, invoice) => {
            const clientId = invoice.client.id;

            if (!acc[clientId]) {
                acc[clientId] = {
                    client: invoice.client,
                    invoices: [],
                };
            }

            const invoiceWithoutClient = { ...invoice };
            delete invoiceWithoutClient.client; // Eliminar la propiedad client del objeto invoice
            acc[clientId].invoices.push(invoiceWithoutClient);

            return acc;
        }, {} as Record<number, { client: typeof invoices[number]['client'], invoices: typeof invoices }>);

        const result = Object.values(groupedByClient);
        return result;
    }

    // setStatusPayment(invoice): string {
    //     const total = invoice.payments.reduce((acc, payment) => acc + Number(payment.amount), 0);

    //     if (total === invoice.totalAmount) {
    //         return 'Pagado'
    //     }

    //     if (this.isDateExpired(invoice.dueDate)) {
    //         return 'Vencida'
    //     }

    //     return 'Pendiente'
    // }

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

    async createInvoice(newInvoice: DTOInvoice) {
        try {

            const products = await this.productService.getProducts();
            const inventory = await this.inventoryService.getInventory();

            const productInvalid = newInvoice.details.map(det => {
                const findProduct = inventory.find(prod => prod.productId === det.productId);
                console.log(`Cantidad solicitada: ${det.quantity}, Cantidad en inventario: ${findProduct.quantity}`);
                
                if (det.quantity > findProduct.quantity) {
                    return {
                        product: findProduct.product.name,
                        quantity: findProduct.quantity,
                        amount: det.quantity
                    }
                } else {
                    return null
                }
            })

            if (productInvalid.filter(pro => pro !== null).length > 0) {
                badResponse.message = 'Estos productos exceden la cantidad que existe en inventario.'
                return badResponse;
            }

            const saveInvoice = await this.prismaService.invoice.create({
                data: {
                    clientId: newInvoice.clientId,
                    controlNumber: newInvoice.controlNumber,
                    status: 'Creada',
                    dispatchDate: newInvoice.dispatchDate,
                    dueDate: newInvoice.dueDate,
                    consignment: newInvoice.consignment,
                    totalAmount: 0
                }
            })

            const dataDetailsInvoice = newInvoice.details.map(det => {
                const findProduct = products.find(prod => prod.id === det.productId);
                return {
                    invoiceId: saveInvoice.id,
                    productId: det.productId,
                    quantity: det.quantity,
                    unitPrice: Number(newInvoice.priceUSD ? findProduct.priceUSD : findProduct.price),
                    subtotal: Number(newInvoice.priceUSD ? findProduct.priceUSD : Number(findProduct.price) * det.quantity),
                }
            })

            await this.prismaService.invoiceProduct.createMany({
                data: dataDetailsInvoice
            })

            newInvoice.details.map(async (det) => {
                const findInventory = inventory.find(inv => inv.productId === det.productId);

                if (findInventory) {
                    const dataInventory = {
                        productId: findInventory.productId,
                        quantity: findInventory.quantity - det.quantity,
                        description: `Salida de producto por factura ${saveInvoice.controlNumber}`
                    }
                    await this.inventoryService.updateInventory(dataInventory, findInventory.id)
                }
            })

            await this.prismaService.invoice.update({
                where: { id: saveInvoice.id },
                data: {
                    totalAmount: dataDetailsInvoice.reduce((acc, item) => acc + Number(item.subtotal), 0),
                }
            })

            baseResponse.message = 'Factura creada correctamente';
            return baseResponse;

        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
