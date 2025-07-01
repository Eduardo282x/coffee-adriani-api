import { Injectable } from '@nestjs/common';
import { badResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExpensesDTO } from './expenses.dto';

@Injectable()
export class ExpensesService {

    constructor(private readonly prismaService: PrismaService) {

    }

    async getExpensesFilter(expenseFilter: ExpensesDTO) {
        try {
            const invoices = await this.getInvoicesRemaining(expenseFilter);
            const invoicesEarns = await this.getInvoicesEarn(expenseFilter);
            const payments = await this.getPayments(expenseFilter);

            return {
                invoicesEarns,
                invoices: invoices,
                payments: payments
            };
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoicesEarn(expenseFilter: ExpensesDTO) {
        try {
            const invoices = await this.prismaService.invoice.findMany({
                where: {
                    status: 'Pagado',
                    dispatchDate: {
                        gte: expenseFilter.startDate,
                        lte: expenseFilter.endDate,
                    },
                },
                include: {
                    invoiceItems: {
                        include: {
                            product: true
                        }
                    },
                    InvoicePayment: {
                        include: {
                            payment: {
                                include: {
                                    account: {
                                        include: {
                                            method: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            const historyProducts = await this.prismaService.historyProduct.findMany({});

            let totalMonthGain = 0;
            const dailyTotals: Record<number, number> = {};
            const productSales: Record<string, number> = {};

            for (const invoice of invoices) {
                let invoiceGain = 0;

                for (const item of invoice.invoiceItems) {
                    const history = historyProducts.find(h => h.name === item.product.name && h.presentation === item.product.presentation);
                    if (!history) continue;

                    const totalQty = Number(item.quantity);
                    let gainPerItem = 0;

                    const isUSD = invoice.InvoicePayment.some(ip => ip.payment.account.method.currency === 'USD');
                    if (isUSD) {
                        gainPerItem = (Number(item.unitPriceUSD) - Number(history.purchasePriceUSD)) * totalQty;
                    } else {
                        gainPerItem = (Number(item.unitPrice) - Number(history.purchasePrice)) * totalQty;
                    }

                    invoiceGain += gainPerItem;

                    const key = `${item.product.name} - ${item.product.presentation}`;
                    productSales[key] = (productSales[key] || 0) + totalQty;
                }

                totalMonthGain += invoiceGain;

                const day = new Date(invoice.dispatchDate).getDate();
                dailyTotals[day] = (dailyTotals[day] || 0) + invoiceGain;
            }

            const date = new Date(expenseFilter.startDate);
            const year = date.getFullYear();
            const month = date.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            const dailyData = Array.from({ length: daysInMonth }, (_, i) => {
                const dia = i + 1;
                return {
                    dia,
                    ganancias: Number((dailyTotals[dia] || 0).toFixed(2)),
                    meta: 0,
                };
            });

            const ganancias = dailyData.map(da => Number(da.ganancias))
            const minEarns = Math.min(...ganancias);
            const maxEarns = Math.max(...ganancias);
            const average = (maxEarns + minEarns) / 2

            const parseDailyDataMeta = dailyData.map(gains => {
                return {
                    ...gains,
                    meta: average
                }
            })


            const totalProducts = Object.entries(productSales).reduce((acc, [, value]) => acc + value, 0);
            const productPercentage = Object.entries(productSales).map(([name, qty]) => ({
                name,
                percentage: Number(((qty / totalProducts) * 100).toFixed(2)),
            })).sort((a, b) => b.percentage - a.percentage);

            return {
                resumen: {
                    totalMonthGain: Number(totalMonthGain.toFixed(2)),
                    productPercentage,
                },
                dailyData: parseDailyDataMeta,
            };
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoicesEarnV2(expenseFilter: ExpensesDTO) {
        // 1. Obtener todos los pagos de facturas (InvoicePayment) con su factura, productos y pagos
        const invoicePayments = await this.prismaService.invoicePayment.findMany({
            include: {
                invoice: {
                    include: {
                        invoiceItems: {
                            include: { product: true }
                        },
                        client: true,
                    }
                },
                payment: {
                    include: {
                        account: {
                            include: {
                                method: true
                            }
                        }
                    }
                },
            },
            where: {
                createdAt: {
                    gte: expenseFilter.startDate,
                    lte: expenseFilter.endDate,
                },
            }
        });

        // 2. Agrupar ventas de productos
        const productSales: Record<number, { name: string, quantity: number }> = {};
        let totalQuantity = 0;

        for (const ip of invoicePayments) {
            for (const item of ip.invoice.invoiceItems) {
                if (!productSales[item.productId]) {
                    // Buscar nombre del producto (puedes optimizar esto si tienes muchos productos)
                    const product = await this.prismaService.product.findUnique({ where: { id: item.productId } });
                    productSales[item.productId] = { name: product?.name || 'Desconocido', quantity: 0 };
                }
                productSales[item.productId].quantity += item.quantity;
                totalQuantity += item.quantity;
            }
        }

        // Calcular porcentaje de ventas por producto
        const productPercentages = Object.entries(productSales).map(([id, data]) => ({
            productId: Number(id),
            name: data.name,
            quantity: data.quantity,
            percentage: totalQuantity > 0 ? (data.quantity / totalQuantity * 100).toFixed(2) : '0.00'
        })).sort((a, b) => b.quantity - a.quantity);

        // 3. Calcular ganancias individuales y totales
        let totalEarnDay = 0;
        let totalEarnMonth = 0;
        const invoiceEarns: any[] = [];

        // Agrupar por día y mes
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        for (const ip of invoicePayments) {
            let earn = 0;
            for (const item of ip.invoice.invoiceItems) {
                // Buscar el precio histórico del producto en el momento de la venta
                const history = await this.prismaService.historyProduct.findFirst({
                    where: {
                        name: item.product.name,
                        presentation: item.product.presentation,
                        price: item.product.price,
                        priceUSD: item.product.priceUSD,
                        createdAt: { lte: ip.createdAt }
                    },
                    orderBy: { createdAt: 'desc' }
                });

                // Si no hay histórico, usar el producto actual
                const product = history || await this.prismaService.product.findUnique({ where: { id: item.productId } });

                // Determinar si fue pagado en USD o BS
                if (ip.payment.account.method.currency === 'USD') {
                    earn += (Number(item.unitPriceUSD) - Number(product.purchasePriceUSD)) * item.quantity;
                } else {
                    earn += (Number(item.unitPrice) - Number(product.purchasePrice)) * item.quantity;
                }
            }

            invoiceEarns.push({
                invoiceId: ip.invoiceId,
                controlNumber: ip.invoice.controlNumber,
                client: ip.invoice.client.name,
                earn,
                createdAt: ip.createdAt
            });

            // Sumar a los totales del día y mes
            if (ip.createdAt >= startOfDay) totalEarnDay += earn;
            if (ip.createdAt >= startOfMonth) totalEarnMonth += earn;
        }

        return {
            productPercentages,
            invoiceEarns,
            totalEarnDay,
            totalEarnMonth
        };
    }

    async getInvoicesRemaining(expenseFilter: ExpensesDTO) {
        try {
            const invoices = await this.prismaService.invoice.findMany({
                where: {
                    status: 'Pagado',
                    remaining: {
                        not: 0
                    },
                    dispatchDate: {
                        gte: expenseFilter.startDate,
                        lte: expenseFilter.endDate
                    }
                },
                include: { client: true }
            })

            return invoices;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getPayments(expenseFilter: ExpensesDTO) {
        try {
            const payments = await this.prismaService.payment.findMany({
                where: {
                    account: {
                        name: { contains: 'Gastos' }
                    },
                    paymentDate: {
                        gte: expenseFilter.startDate,
                        lte: expenseFilter.endDate
                    }
                },
                include: {
                    account: {
                        include: {
                            method: true
                        }
                    }
                }
            })

            return payments;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getEarning() {
        try {
            const invoicesPayed = await this.prismaService.invoice.findMany({
                where: {
                    status: 'Pagado'
                },
                include: {
                    invoiceItems: { include: { product: true } }
                }
            })

            return invoicesPayed;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
