import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTOBaseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DetProducts, DTOInvoice, IInvoiceWithDetails, OptionalFilterInvoices, ResponseInvoice } from './invoice.dto';
import { ProductsService } from 'src/products/products.service';
import { InventoryService } from 'src/inventory/inventory.service';
import { ClientsService } from 'src/clients/clients.service';
import { ClientExcel, DetInvoiceDataExcel, ExcelTransformV2 } from 'src/excel/excel.interfaces';
import { InvoiceStatus } from '@prisma/client';
// import * as XLSX from 'xlsx';
import * as ExcelJS from 'exceljs';

@Injectable()
export class InvoicesService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly productService: ProductsService,
        private readonly inventoryService: InventoryService,
        private readonly clientService: ClientsService,
    ) {

    }

    async getInvoices(filter?: OptionalFilterInvoices): Promise<ResponseInvoice | DTOBaseResponse> {
        try {
            const where: any = {};
            if (filter && filter.status) {
                where.status = filter.status as InvoiceStatus;
            }

            const dolar = await this.productService.getDolar();
            const invoices = await this.prismaService.invoice.findMany({
                include: {
                    client: {
                        include: { block: true }
                    },
                    invoiceItems: {
                        include: {
                            product: true
                        }
                    },
                    InvoicePayment: {
                        include: { payment: { include: { account: true } } }
                    }
                },
                orderBy: {
                    dispatchDate: 'desc'
                },
                where
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
                // Ensure totalAmountBs is present and as a number (not string)
                const invoiceWithDolar = {
                    ...invoiceWithoutClient,
                    totalAmountBs: Number(Number(invoiceWithoutClient.totalAmount) * Number(dolar.dolar)),
                };
                acc[clientId].invoices.push(invoiceWithDolar);

                return acc;
            }, {} as Record<number, { client: typeof invoices[number]['client'], invoices: any[] }>);

            const result = Object.values(groupedByClient);

            // const invoicesFilter = invoices.filter(item => item.status == 'Creada' || item.status == 'Pendiente' || item.status == 'Vencida')

            // const groupedByProduct = this.groupProductInvoices(invoicesFilter);

            // const totalPackageDet = Object.values(groupedByProduct);
            const totalPackageDetCount = this.groupProductCountInvoices(invoices);

            const totalCashInvoices = invoices.reduce((acc, item) => acc + Number(item.totalAmount), 0)
            const totalCashInvoicesPending = invoices.filter(data => data.status == 'Creada' || data.status == 'Pendiente' || data.status == 'Vencida').reduce((acc, item) => acc + Number(item.remaining), 0)

            // const debt = invoices.filter(data => Number(data.remaining) < 2).reduce((acc, item) => acc + Number(item.totalAmount), 0)
            // const remainingCashInvoices = totalCashInvoices - debt;

            // const debtOld = invoices.filter(data => data.status == 'Creada' || data.status == 'Pendiente' || data.status == 'Vencida').reduce((acc, item) => acc + Number(item.remaining), 0)
            // const paid = totalCashInvoicesPending - debtOld;

            const realPending = totalCashInvoices - totalCashInvoicesPending;

            return {
                invoices: result,
                package: totalPackageDetCount.reduce((acc, item: any) => acc + item.totalQuantity, 0),
                detPackage: totalPackageDetCount,
                payments: {
                    total: totalCashInvoices,
                    totalPending: totalCashInvoicesPending,
                    debt: 0,
                    remaining: realPending,
                },
            };
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoicesPaid() {
        try {
            return await this.getInvoices({ status: 'Pagado' })
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoicesExpired(): Promise<ResponseInvoice | DTOBaseResponse> {
        try {
            return await this.getInvoices({ status: 'Vencida' }) as ResponseInvoice
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoiceWithDetails() {
        try {
            const invoice = await this.prismaService.invoice.findMany({
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
                    status: {
                        notIn: ['Cancelada', 'Pagado']
                    }
                }
            }).then(item => item.map(data => {
                return {
                    ...data,
                    specialPrice: data.invoiceItems.reduce((acc, det) => acc + (Number(det.unitPriceUSD) * det.quantity), 0),
                }
            }))

            if (!invoice) {
                badResponse.message = 'No se han encontrado facturas.'
                return badResponse;
            }

            return invoice;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoicesFilter(invoice: DTODateRangeFilter): Promise<ResponseInvoice | DTOBaseResponse> {
        // const dolar = await this.productService.getDolar();
        try {
            const invoices = await this.prismaService.invoice.findMany({
                include: {
                    client: {
                        include: { block: true }
                    },
                    invoiceItems: {
                        include: {
                            product: true
                        }
                    },
                    InvoicePayment: {
                        include: { payment: { include: { account: true } } }
                    }
                },
                orderBy: {
                    dispatchDate: 'desc'
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
                // const invoiceWithDolar = {
                //     ...invoiceWithoutClient,
                //     totalAmountBs: Number(Number(invoiceWithoutClient.totalAmount) * Number(dolar.dolar)).toFixed(2)
                // }
                acc[clientId].invoices.push(invoiceWithoutClient);

                return acc;
            }, {} as Record<number, { client: typeof invoices[number]['client'], invoices: any[] }>);

            const result = Object.values(groupedByClient);

            // const invoicesFilter = invoices.filter(item => item.status == 'Creada' || item.status == 'Pendiente' || item.status == 'Vencida')

            // const groupedByProduct = this.groupProductInvoices(invoicesFilter);

            // const totalPackageDet = Object.values(groupedByProduct);
            const totalPackageDetCount = this.groupProductCountInvoices(invoices);

            const totalCashInvoices = invoices.reduce((acc, item) => acc + Number(item.totalAmount), 0)
            const totalCashInvoicesPending = invoices.filter(data => data.status == 'Creada' || data.status == 'Pendiente' || data.status == 'Vencida').reduce((acc, item) => acc + Number(item.remaining), 0)

            // const debt = invoices.filter(data => Number(data.remaining) < 2).reduce((acc, item) => acc + Number(item.totalAmount), 0)
            // const remainingCashInvoices = totalCashInvoices - debt;

            // const debtOld = invoices.filter(data => data.status == 'Creada' || data.status == 'Pendiente' || data.status == 'Vencida').reduce((acc, item) => acc + Number(item.remaining), 0)
            // const paid = totalCashInvoicesPending - debtOld;

            const realPending = totalCashInvoices - totalCashInvoicesPending;

            return {
                invoices: result,
                package: totalPackageDetCount.reduce((acc, item: any) => acc + item.totalQuantity, 0),
                detPackage: totalPackageDetCount,
                payments: {
                    total: totalCashInvoices,
                    totalPending: totalCashInvoicesPending,
                    debt: 0,
                    remaining: realPending,
                },
            };
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async checkInvoice() {
        try {
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
            });

            const clientReminderList = await this.prismaService.clientReminder.findMany();

            const invoicesModify = {
                pending: 0,
                expired: 0
            }

            invoices.map(async (inv) => {
                if (this.isDateExpired(inv.dispatchDate) && inv.status == 'Creada') {
                    await this.prismaService.invoice.update({
                        where: { id: inv.id },
                        data: { status: 'Pendiente' }
                    });

                    invoicesModify.pending += 1;
                }

                if (this.isDateExpired(inv.dueDate) && (inv.status == 'Pendiente' || inv.status == 'Creada' || inv.status == 'Vencida')) {
                    await this.prismaService.invoice.update({
                        where: { id: inv.id },
                        data: { status: 'Vencida' }
                    });

                    const findClientReminder = clientReminderList.find(item => item.clientId == inv.clientId);

                    if(findClientReminder){
                        return;
                    }

                    await this.prismaService.clientReminder.create({
                        data: {
                            clientId: inv.clientId,
                            messageId: 1,
                            send: true,
                        }
                    })

                    invoicesModify.expired += 1;
                }
            });

            console.log(invoicesModify);


            baseResponse.message = 'Facturas verificadas y agregadas a cobranza.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    // groupProductInvoices(invoicesFilter) {
    //     return invoicesFilter.reduce((acc, invoice) => {
    //         invoice.invoiceItems.forEach(item => {
    //             const productId = item.product.id;

    //             if (!acc[productId]) {
    //                 acc[productId] = {
    //                     productId: item.product.id,
    //                     product: item.product,
    //                     totalQuantity: 0,
    //                 };
    //             }

    //             acc[productId].totalQuantity += Number(item.quantity);
    //         })
    //         return acc;
    //     }, {} as Record<number, { product: typeof invoicesFilter[number]['invoiceItems'][number]['product'], totalQuantity: number }>);
    // }

    groupProductCountInvoices(invoicesFilter) {
        const calculateProducts = invoicesFilter.reduce((acc, invoice) => {
            const parseRemaining = invoice.status == 'Pagado' ? 0 : Number(invoice.remaining);
            let paidRemaining = Number(invoice.totalAmount) - parseRemaining;

            invoice.invoiceItems.forEach(item => {
                const productId = item.product.id;
                const unitPrice = Number(item.unitPrice);
                let quantity = Number(item.quantity);
                let quantityPaid = 0;

                // Calcular cuántas unidades se han pagado por este producto
                while (quantity > 0 && paidRemaining >= unitPrice) {
                    quantityPaid += 1;
                    paidRemaining -= unitPrice;
                    quantity -= 1;
                }

                // Si queda un pago parcial para una unidad (ej. 0.5 producto)
                if (quantity > 0 && paidRemaining > 0) {
                    const partialFraction = paidRemaining / unitPrice;
                    quantityPaid += partialFraction;
                    paidRemaining -= unitPrice * partialFraction;
                    quantity -= partialFraction;
                }

                // Agregar al acumulador
                if (!acc[productId]) {
                    acc[productId] = {
                        productId: item.product.id,
                        product: item.product,
                        totalQuantity: 0,
                        paidQuantity: 0,
                        total: 0,
                    };
                }

                acc[productId].totalQuantity += Number(item.quantity);
                acc[productId].paidQuantity += quantityPaid;
                acc[productId].total = acc[productId].totalQuantity - quantityPaid;
            });

            return acc;
        }, {} as Record<number, {
            product: typeof invoicesFilter[number]['invoiceItems'][number]['product'],
            totalQuantity: number,
            paidQuantity: number
        }>);
        const parseProducts: DetProducts[] = Object.values(calculateProducts);

        const calculateFinalTotal = parseProducts.map((data: DetProducts) => {
            return {
                ...data,
                total: data.totalQuantity - data.paidQuantity
            }
        })
        return calculateFinalTotal;
    }

    setTotalProducts = (invoices: IInvoiceWithDetails[], type: string) => {
        const totalPackage = invoices.reduce((acc, invoice) => {
            const total = invoice.status === 'Creada' || invoice.status == 'Pendiente'
                ? invoice.invoiceItems.reduce((acc, item) => acc + Number(item.quantity), 0)
                : 0;
            return acc + total;
        }, 0);

    }

    // async checkInvoice() {
    //     const invoices = await this.prismaService.invoice.findMany({
    //         include: {
    //             client: true,
    //             invoiceItems: true
    //         }
    //     })

    //     invoices.map(async (inv) => {
    //         if (this.isDateExpired(inv.dueDate)) {
    //             await this.prismaService.invoice.update({
    //                 where: { id: inv.id },
    //                 data: { status: 'Vencida' }
    //             })
    //         }
    //     })
    // }

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
            const findDuplicateControlNumber = await this.prismaService.invoice.findFirst({
                where: { controlNumber: newInvoice.controlNumber },
                include: { client: true }
            })

            if (findDuplicateControlNumber) {
                badResponse.message = `Ya existe una factura con ese numero de control del cliente ${findDuplicateControlNumber.client.name}`
                return badResponse;
            }

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
                    type: det.type || 'SALE', // Default to 'SALE' if not provided
                    unitPrice: Number(newInvoice.priceUSD ? findProduct.priceUSD : findProduct.price),
                    unitPriceUSD: Number(findProduct.priceUSD),
                    subtotal: Number(newInvoice.priceUSD ? Number(findProduct.priceUSD) * det.quantity : Number(findProduct.price) * det.quantity),
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
            });

            const calculateTotalInvoice = dataDetailsInvoice.filter(item => item.type == 'SALE').reduce((acc, item) => acc + Number(item.subtotal), 0);

            await this.prismaService.invoice.update({
                where: { id: saveInvoice.id },
                data: {
                    totalAmount: calculateTotalInvoice,
                    remaining: calculateTotalInvoice,
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

    async updateInvoice(id: number, newInvoice: DTOInvoice) {
        try {
            const products = await this.productService.getProducts();

            const invoice = await this.prismaService.invoice.findUnique({
                where: { id },
                include: {
                    invoiceItems: true
                }
            });

            if (!invoice) {
                badResponse.message = 'Factura no encontrada';
                return badResponse;
            }

            await this.prismaService.invoice.update({
                where: { id },
                data: {
                    clientId: newInvoice.clientId,
                    controlNumber: newInvoice.controlNumber,
                    dispatchDate: newInvoice.dispatchDate,
                    dueDate: newInvoice.dueDate,
                    consignment: newInvoice.consignment,
                }
            });

            // if (invoice.invoiceItems.length === newInvoice.details.length) {
            const dataDetailsInvoice = newInvoice.details.map(det => {
                const findProduct = products.find(prod => prod.id === det.productId);

                return {
                    invoiceId: id,
                    productId: det.productId,
                    quantity: det.quantity,
                    type: det.type || 'SALE', // Default to 'SALE' if not provided
                    unitPrice: Number(newInvoice.priceUSD ? findProduct.priceUSD : findProduct.price),
                    unitPriceUSD: Number(findProduct.priceUSD),
                    subtotal: Number(newInvoice.priceUSD ? findProduct.priceUSD : Number(findProduct.price) * det.quantity),
                }
            });

            await this.prismaService.invoiceProduct.deleteMany({
                where: { invoiceId: id }
            })

            await this.prismaService.invoiceProduct.createMany({
                data: dataDetailsInvoice
            });

            const totalAmount = dataDetailsInvoice.filter(item => item.type == 'SALE').reduce((acc, item) => acc + Number(item.subtotal), 0)

            await this.prismaService.invoice.update({
                data: {
                    totalAmount: totalAmount,
                    remaining: totalAmount
                },
                where: { id }
            })

            baseResponse.message = 'Factura actualizada correctamente';
            return baseResponse;

        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async updateInvoiceDet() {
        try {
            const getDetailsInvoice = await this.prismaService.invoiceProduct.findMany();
            const historyProduct = await this.prismaService.historyProduct.findMany();

            let notFound = 0;
            getDetailsInvoice.map(async (item) => {
                const findProductHistory = historyProduct.find(data =>
                    Number(data.price).toFixed(2) === Number(item.unitPrice).toFixed(2)
                )

                if (!findProductHistory || !findProductHistory.priceUSD) {
                    notFound += 1;
                } else {
                    await this.prismaService.invoiceProduct.update({
                        data: { unitPriceUSD: findProductHistory.priceUSD },
                        where: { id: item.id }
                    })
                }
            })

            console.log(getDetailsInvoice.length);
            console.log(notFound);

            baseResponse.message = 'Detalles actualizados.'
            return baseResponse;

        } catch (err) {
            badResponse.message = err.message;
            return badResponse
        }
    }

    async markPayed(id: number) {
        try {
            await this.prismaService.invoice.update({
                where: { id },
                data: { status: 'Pagado' }
            })
            baseResponse.message = 'Factura marcada como pagada.'
            return baseResponse;
        } catch (err) {
            baseResponse.message = err.message;
            return badResponse
        }
    }
    async markPending(id: number) {
        try {
            await this.prismaService.invoice.update({
                where: { id },
                data: { status: 'Pendiente' }
            })
            baseResponse.message = 'Factura marcada como pendiente.'
            return baseResponse;
        } catch (err) {
            baseResponse.message = err.message;
            return badResponse
        }
    }

    async deleteInvoice(id: number) {
        try {
            const invoice = await this.prismaService.invoice.findFirst({
                where: { id }
            });

            if (!invoice) {
                badResponse.message = 'Factura no encontrada';
                return badResponse;
            }

            const findInvoicePayment = await this.prismaService.invoicePayment.findFirst({
                where: { invoiceId: id }
            })

            if (findInvoicePayment) {
                badResponse.message = 'Esta factura ya se encuentra paga.';
                return badResponse;
            }

            const detInvoice = await this.prismaService.invoiceProduct.findMany({
                where: { invoiceId: id }
            });

            detInvoice.map(async (det) => {
                const findInventory = await this.prismaService.inventory.findFirst({
                    where: { productId: det.productId }
                });

                if (findInventory) {
                    await this.prismaService.inventory.update({
                        where: { id: findInventory.id },
                        data: { quantity: findInventory.quantity + det.quantity }
                    })
                    await this.prismaService.historyInventory.create({
                        data: {
                            productId: findInventory.productId,
                            quantity: det.quantity,
                            description: `Devolución de producto por cancelación de factura ${invoice.controlNumber}`,
                            movementType: 'IN'
                        }
                    })
                }
            })

            await this.prismaService.invoiceProduct.deleteMany({
                where: { invoiceId: invoice.id }
            })

            await this.prismaService.invoice.delete({
                where: { id: invoice.id }
            })

            baseResponse.message = 'Factura eliminada correctamente';
            return baseResponse;

        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    // ----------------------------------------------------------------

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
                unitPriceUSD: data.unitPrice,
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

    async exportInvoicesToExcelWithExcelJS(dateRange?: DTODateRangeFilter): Promise<Buffer> {
        const where: any = {};
        if (dateRange?.startDate && dateRange?.endDate) {
            where.dispatchDate = {
                gte: dateRange.startDate,
                lte: dateRange.endDate,
            };
        }

        const invoices = await this.prismaService.invoice.findMany({
            where,
            include: {
                client: { include: { block: true } },
                invoiceItems: { include: { product: true } },
                InvoicePayment: {
                    include: {
                        payment: {
                            include: {
                                account: { include: { method: true } },
                                dolar: true
                            },
                        },
                    },
                },
            },
            orderBy: { dispatchDate: 'desc' },
        });

        const productsMap: Map<string, { total: number; price: number }> = new Map();
        invoices.forEach((inv) => {
            inv.invoiceItems.forEach(({ product, quantity, unitPrice }) => {
                const key = product.name;
                const current = productsMap.get(key);
                if (!current) {
                    productsMap.set(key, { total: quantity, price: Number(unitPrice) });
                } else {
                    current.total += quantity;
                    productsMap.set(key, current);
                }
            });
        });

        const productNames = Array.from(productsMap.keys());

        const workbook = new ExcelJS.Workbook();

        // Hoja 1 - Facturas
        const ws1 = workbook.addWorksheet('Facturas');

        const baseHeaders = [
            'N° Control', 'Cliente', 'Bloque', 'Dirección', 'Zona', 'Fecha', 'Vence', 'Total', 'Debe', 'Estado'
        ];

        const productHeaders = productNames.flatMap(name => [`${name}`, `Precio`]);
        const finalHeaders = [...baseHeaders, ...productHeaders, 'Total de bultos', 'Monto', 'Abono'];

        ws1.addRow(finalHeaders);
        ws1.getRow(1).font = { bold: true };

        invoices.forEach(inv => {
            const totalBultos = inv.invoiceItems.reduce((sum, i) => sum + i.quantity, 0);
            const abono = Number(inv.totalAmount) - Number(inv.remaining);

            const rowData: (string | number | Date)[] = [
                inv.controlNumber,
                inv.client.name,
                inv.client.block.name,
                inv.client.address,
                inv.client.zone,
                inv.dispatchDate,
                inv.dueDate,
                Number(inv.totalAmount),
                Number(inv.remaining),
                inv.status,
            ];

            // Agregar los productos por nombre (cantidad y precio)
            for (const productName of productNames) {
                const found = inv.invoiceItems.find(item => item.product.name === productName);
                rowData.push(found ? found.quantity : '');
                rowData.push(found ? Number(found.unitPrice) : 0);
            }

            rowData.push(totalBultos);
            rowData.push(''); // Monto vacío
            rowData.push(abono);

            const row = ws1.addRow(rowData);

            // Formato de fecha
            row.getCell(6).numFmt = 'dd/mm/yyyy';
            row.getCell(7).numFmt = 'dd/mm/yyyy';

            // Color por estado
            const colorMap = {
                Creada: 'dbeafe',
                Pendiente: 'ffedd4',
                Vencida: 'ffe2e2',
                Pagado: 'dbfce7',
                Cancelada: 'ffe2e2',
            };
            const fillColor = colorMap[inv.status as keyof typeof colorMap];
            if (fillColor) {
                row.getCell(10).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: fillColor },
                };
            }
        });

        // Hoja 2 - Pagos
        const ws2 = workbook.addWorksheet('Pagos');
        const pagosHeaders = [
            'Cuenta', 'Factura', 'Cantidad', 'Cantidad USD', 'Cantidad Bs', 'Tasa Dolar', 'Referencia',
            ...productNames.flatMap(name => [`${name}`, 'Precio']),
            'Total de bultos',
        ];

        ws2.addRow(pagosHeaders);
        ws2.getRow(1).font = { bold: true };

        invoices.forEach(inv => {
            inv.InvoicePayment.forEach(({ payment }) => {
                const currency = payment.account.method.currency;
                const usdAmount = currency === 'USD' ? Number(payment.amount) : Number(payment.amount) / Number(payment.dolar.dolar);
                const bsAmount = currency === 'BS' ? Number(payment.amount) : Number(payment.amount) * Number(payment.dolar.dolar);

                const rowData: (string | number)[] = [
                    payment.account.name,
                    inv.controlNumber,
                    `${Number(payment.amount).toFixed(2)} ${currency === 'USD' ? '$' : 'Bs'}`,
                    usdAmount,
                    bsAmount,
                    Number(payment.dolar.dolar),
                    payment.reference,
                ];

                for (const productName of productNames) {
                    const found = inv.invoiceItems.find(item => item.product.name === productName);
                    rowData.push(found ? found.quantity : '');
                    rowData.push(found ? Number(found.unitPrice) : 0);
                }

                const totalBultos = inv.invoiceItems.reduce((sum, i) => sum + i.quantity, 0);
                rowData.push(totalBultos);

                const row = ws2.addRow(rowData);
                if (currency === 'USD') {
                    row.eachCell(cell => {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'dbeafe' },
                        };
                    });
                }
            });
        });

        const arrayBuffer = await workbook.xlsx.writeBuffer();
        const buffer = Buffer.from(arrayBuffer); // <-- Conversión correcta
        return buffer;
    }

}
