import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOInvoice, IInvoice } from './invoice.dto';
import { ProductsService } from 'src/products/products.service';
import { InventoryService } from 'src/inventory/inventory.service';
import { ClientsService } from 'src/clients/clients.service';
import { ClientExcel, DetInvoiceDataExcel, ExcelTransformV2 } from 'src/excel/excel.controller';
import { InvoiceStatus } from '@prisma/client';

@Injectable()
export class InvoicesService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly productService: ProductsService,
        private readonly inventoryService: InventoryService,
        private readonly clientService: ClientsService,
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
        }).then(inv => {
            return inv.map(data => {
                return {
                    ...data,
                    totalAmount: data.totalAmount.toFixed(2)
                }
            })
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
                const totalPackage = invoices.reduce((acc, invoice) => {
            const total = invoice.status === 'Creada' || invoice.status == 'Pendiente' 
            ? invoice.invoiceItems.reduce((acc, item) => acc + Number(item.quantity), 0)
            : 0;
            return acc + total;
        }, 0);

        return {
            invoices: result,
            package: totalPackage
        };
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

        const totalPackage = invoices.reduce((acc, invoice) => {
            const total = invoice.status === 'Creada' || invoice.status == 'Pendiente' 
            ? invoice.invoiceItems.reduce((acc, item) => acc + Number(item.quantity), 0)
            : 0;
            return acc + total;
        }, 0);

        return {
            invoices: result,
            package: totalPackage
        };
    }

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

    async findInvoiceWithoutDetails() {
        const invoices = await this.prismaService.invoice.findMany({
            where: {
                invoiceItems: {
                    none: {}
                }
            },
            include: {
                client: true,
                invoiceItems: true
            }
        })

        return invoices;
    }

    async InvoiceValidateTotal() {
        const invoices = await this.prismaService.invoice.findMany({
            include: {
                client: true,
                invoiceItems: true
            }
        })

        const invoicesFailed = invoices.map(inv => {
            const total = inv.invoiceItems.reduce((acc, item) => acc + Number(item.subtotal), 0);

            if (total.toFixed(2) !== inv.totalAmount.toFixed(2)) {
                return {
                    ...inv,
                    totalAmount: total
                }
            }
        })

        return invoicesFailed.filter(inv => inv != null);
    }

    async createInvoice(newInvoice: DTOInvoice) {
        try {

            const products = await this.productService.getProducts();
            const inventory = await this.inventoryService.getInventory();

            const productInvalid = newInvoice.details.map(det => {
                const findProduct = inventory.find(prod => prod.productId === det.productId);

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
                    remaining: dataDetailsInvoice.reduce((acc, item) => acc + Number(item.subtotal), 0),
                }
            })

            baseResponse.message = 'Factura creada correctamente';
            return baseResponse;

        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async syncInvoiceExcel(invoices: ExcelTransformV2[]) {
        const existingInvoices = await this.prismaService.invoice.findMany();

        // Normalizamos los controlNumbers existentes con padding
        const existingControlNumbers = new Set(
            existingInvoices.map(inv => inv.controlNumber.toString().padStart(4, '0'))
        );

        // Filtramos solo los que no existen aún
        const newInvoices = invoices.filter(inv => {
            const controlNum = inv.controlNumber.toString().padStart(4, '0');
            return !existingControlNumbers.has(controlNum);
        });

        // Si no hay facturas nuevas, salimos
        if (newInvoices.length === 0) {
            return {
                success: false,
                message: 'Todas las facturas ya existen en la base de datos.',
            };
        }

        // return await this.validateClient(invoices);

        try {
            const clients = await this.clientService.getClients();

            const dataInvoice = invoices.map((data, index) => {
                const findClient = clients.find(item => item.name.toLowerCase().trim() == data.client.toLowerCase().trim());

                if (!findClient) {
                    throw new Error(`Cliente no encontrado para la factura #${data.controlNumber} (cliente: ${data.client})`);
                }

                return {
                    consignment: data.consignment,
                    controlNumber: data.controlNumber.toString().padStart(4, '0'),
                    dispatchDate: new Date(data.dispatchDate),
                    dueDate: new Date(data.dueDate),
                    status: 'Creada' as InvoiceStatus,
                    totalAmount: data.totalAmount,
                    clientId: findClient.id,
                    remaining: data.totalAmount
                }
            })

            await this.prismaService.invoice.createMany({
                data: dataInvoice
            });

            baseResponse.message = 'Facturas guardadas exitosamente.';
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async validateClient(invoice: ExcelTransformV2[]) {
        const clients = await this.clientService.getClients();

        const dataInvoice = invoice.map(data => {
            const findClient = clients.find(item => item.name.trim() == data.client.trim());

            return {
                consignment: data.consignment,
                controlNumber: data.controlNumber.toString().padStart(4, '0'),
                dispatchDate: new Date(data.dispatchDate),
                dueDate: new Date(data.dueDate),
                status: 'Creada' as InvoiceStatus,
                totalAmount: data.totalAmount,
                clientId: findClient ? findClient.id : 0,
                remaining: data.totalAmount
            }
        })
        return dataInvoice
    }

    findDuplicateControlNumbers(data: ExcelTransformV2[]): ExcelTransformV2[] {
        const countMap = new Map<number, number>();
        const duplicates: ExcelTransformV2[] = [];

        // Contamos cuántas veces aparece cada controlNumber
        for (const item of data) {
            countMap.set(item.controlNumber, (countMap.get(item.controlNumber) || 0) + 1);
        }

        // Filtramos los elementos que están duplicados
        for (const item of data) {
            if (countMap.get(item.controlNumber)! > 1) {
                duplicates.push(item);
            }
        }

        return duplicates;
    };

    async syncDetInvoiceExcel(devInvoice: DetInvoiceDataExcel[]) {

        const validDevInvoice = devInvoice.filter(d => d.product && d.invoice);
        const products = await this.productService.getProducts();
        const invoices = await this.prismaService.invoice.findMany();

        const findDuplicate = this.findDuplicateInvoiceProducts(validDevInvoice);
        if (findDuplicate.duplicates.length > 0) {
            return {
                data: findDuplicate
            }
        }

        const dataDetInvoice = validDevInvoice.map(data => {
            const findProduct = products.find(item => item.name.toString().toLowerCase().trim() == data.product.toString().toLowerCase().trim());
            const findInvoice = invoices.find(item => item.controlNumber.toString().padStart(4, '0') == data.invoice.toString().padStart(4, '0'));

            if (!findInvoice || !findProduct) {
                throw new Error(`Producto no encontrado para la factura #${data.invoice} (producto: ${data.product})`);
            }

            return {
                invoiceId: findInvoice.id,
                productId: findProduct.id,
                quantity: data.quantity,
                subtotal: data.subtotal,
                unitPrice: data.unitPrice,
            }
        })

        try {
            await this.prismaService.invoiceProduct.createMany({
                data: dataDetInvoice
            });

            baseResponse.message = 'Facturas y detalles agregados exitosamente.'
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { from: 'InvoiceServiceExcel', message: err.message }
            })
            badResponse.message = `Ah ocurrido un error ${err.message}`
            return badResponse;
        }
    }

    async syncClientExcelLocal(client: ClientExcel[]) {
        const parseDataClient = client.map(cli => {
            return {
                name: cli.name,
                rif: cli.rif ? cli.rif.toString() : 'J',
                address: cli.address ? cli.address : '',
                phone: cli.phone ? cli.phone.toString().padStart(11, '0') : '',
                zone: cli.zone,
                blockId: cli.blockId,
                active: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            }
        })

        try {
            await this.prismaService.client.createMany({
                data: parseDataClient
            })
            baseResponse.message = 'Clientes agregados exitosamente';
            return baseResponse;
        } catch (err) {
            return {
                message: err.message,
                success: false,
                data: parseDataClient
            }
        }
    }

    findDuplicateInvoiceProducts(data: DetInvoiceDataExcel[]) {
        const seen = new Map<string, number>();
        const duplicates: DetInvoiceDataExcel[] = [];

        for (const item of data) {
            const key = `${item.invoice}-${item.product.trim().toLowerCase()}`;

            if (seen.has(key)) {
                duplicates.push(item);
            } else {
                seen.set(key, 1);
            }
        }

        // Lista de invoice únicos que tienen productos duplicados
        const duplicateInvoices = Array.from(
            new Set(duplicates.map(d => d.invoice))
        );

        return {
            duplicates,         // Registros exactos duplicados
            duplicateInvoices,  // Lista de invoice con productos repetidos
        };
    }

}
