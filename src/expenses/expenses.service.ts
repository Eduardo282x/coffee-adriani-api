import { Injectable } from '@nestjs/common';
import { badResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExpensesDTO } from './expenses.dto';
import { calculateInvoiceRemainingUsd } from 'src/common/remaining-calculator';

@Injectable()
export class ExpensesService {

    constructor(private readonly prismaService: PrismaService) {

    }

    private getNormalizedDateRange(expenseFilter: ExpensesDTO) {
        const startDate = new Date(expenseFilter.startDate);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(expenseFilter.endDate);
        endDate.setHours(23, 59, 59, 999);

        return { startDate, endDate };
    }

    private normalizeText(value?: string | null) {
        return (value || '').trim().toLowerCase();
    }

    private isDivisaPayment(payment: any) {
        const methodName = this.normalizeText(payment?.account?.method?.name);
        const accountName = this.normalizeText(payment?.account?.name);
        const bankName = this.normalizeText(payment?.account?.bank);

        const isCashUsd = methodName.includes('efectivo $') || methodName.includes('efectivo usd');
        const isGastoDivisa = accountName.includes('gasto divisa') || bankName.includes('gasto divisa');

        return isCashUsd || isGastoDivisa;
    }

    private parsePaymentAmount(payment: any): number {
        const currency = payment.account?.method?.currency;
        const dolarRate = Number(payment?.dolar?.dolar || 0);
        const isDivisaPayment = this.isDivisaPayment(payment);
        let amountUSD = Number(payment.amount);
        if (currency === 'BS' && !isDivisaPayment) {
            amountUSD = dolarRate > 0 ? Number(payment.amount) / dolarRate : 0;
        }
        return Number(amountUSD.toFixed(2));
    }

    private calculateInvoiceItems(invoiceItems: any[]): number {
        return invoiceItems
            .filter(item => item.type === 'SALE')
            .reduce((sum, item) => sum + (
                item.product.presentation === '1kilo'
                    ? Number(item.quantity) * 0.2
                    : Number(item.quantity)
            ), 0);
    }

    async getExpensesFilter(expenseFilter: ExpensesDTO) {
        try {
            const [invoiceMetrics, payments, paymentsNoAssociatedRaw] = await Promise.all([
                this.getInvoicesWithMetrics(expenseFilter),
                this.getPayments(expenseFilter),
                this.getPaymentsNoAssociated(expenseFilter),
            ]);

            const paymentsNoAssociated = paymentsNoAssociatedRaw as unknown as any[];
            const calculateTotal = paymentsNoAssociated
                .map(pay => Number(pay.amountUSD || 0))
                .reduce((acc, item) => acc + item, 0)

            const invoiceMetricsData = invoiceMetrics as any;

            return {
                invoices: invoiceMetricsData.invoices,
                summary: invoiceMetricsData.summary,
                payments,
                paymentsNoAssociated: {
                    payments: paymentsNoAssociated,
                    total: calculateTotal
                }
            };
        } catch (err) {
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
            return badResponse;
        }
    }

    async getInvoicesWithMetrics(expenseFilter: ExpensesDTO) {
        try {
            const { startDate, endDate } = this.getNormalizedDateRange(expenseFilter);
            const { type } = expenseFilter;

            // 1. Query única: facturas pagadas en el rango con filtro de tipo
            const invoices = await this.prismaService.invoice.findMany({
                where: {
                    status: 'Pagado',
                    InvoicePayment: {
                        some: {
                            createdAt: { gte: startDate, lte: endDate }
                        }
                    },
                    invoiceItems: {
                        every: {
                            product: {
                                type: { contains: type, mode: 'insensitive' }
                            }
                        }
                    }
                },
                include: {
                    client: true,
                    invoiceItems: { include: { product: true } },
                    InvoicePayment: { select: { amount: true } }
                }
            });

            // 2. Pre-fetch batch: products + histories
            const uniqueProductIds = new Set<number>();
            const uniquePairsMap = new Map<string, { name: string; presentation: string }>();

            for (const invoice of invoices) {
                const saleRefDate = invoice.dispatchDate || invoice.createdAt;
                for (const item of invoice.invoiceItems) {
                    uniqueProductIds.add(item.productId);
                    const pairKey = `${item.product.name}|${item.product.presentation}`;
                    if (!uniquePairsMap.has(pairKey)) {
                        uniquePairsMap.set(pairKey, { name: item.product.name, presentation: item.product.presentation });
                    }
                }
            }

            const [allProducts, allHistories] = await Promise.all([
                uniqueProductIds.size > 0
                    ? this.prismaService.product.findMany({
                        where: { id: { in: Array.from(uniqueProductIds) } }
                    })
                    : [],
                uniquePairsMap.size > 0
                    ? this.prismaService.historyProduct.findMany({
                        where: {
                            OR: Array.from(uniquePairsMap.values()).map(p => ({
                                name: p.name,
                                presentation: p.presentation
                            }))
                        },
                        orderBy: { createdAt: 'desc' }
                    })
                    : []
            ]);

            const productMap = new Map<number, any>();
            for (const p of allProducts) productMap.set(p.id, p);

            // Index histories by name|presentation
            const historyIndex = new Map<string, typeof allHistories>();
            for (const h of allHistories) {
                const pairKey = `${h.name}|${h.presentation}`;
                const arr = historyIndex.get(pairKey) || [];
                arr.push(h);
                historyIndex.set(pairKey, arr);
            }

            const findHistoryAtDate = (name: string, presentation: string, atDate: Date) => {
                const entries = historyIndex.get(`${name}|${presentation}`) || [];
                const beforeOrOn = entries.find(e => e.createdAt <= atDate);
                if (beforeOrOn) return beforeOrOn;
                const reversed = [...entries].reverse();
                return reversed.find(e => e.createdAt >= atDate) || null;
            };

            // 3. Referencias para métricas
            const referenceDate = new Date(endDate);
            const startOfDay = new Date(referenceDate); startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(referenceDate); endOfDay.setHours(23, 59, 59, 999);
            const startOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);

            // 4. Calcular por factura
            let totalEarnDay = 0;
            let totalEarnMonth = 0;
            let totalEarnRange = 0;
            let quantityProductsMonth = 0;
            let quantityProductsRange = 0;
            const productSales: Record<number, { name: string; presentation: string; quantity: number }> = {};
            let totalQuantity = 0;

            const result = invoices.map(invoice => {
                const remaining = calculateInvoiceRemainingUsd(invoice.totalAmount, invoice.InvoicePayment);
                const totalItems = this.calculateInvoiceItems(invoice.invoiceItems);
                const hasGiftItems = invoice.invoiceItems.some(item => item.type === 'GIFT');
                const saleRefDate = invoice.dispatchDate || invoice.createdAt;

                // Calcular earn con history lookup
                // Determinar moneda del invoice: buscar la primera InvoicePayment关联ación con payment/account/method
                // Como no tenemos payment en el include, usamos el approach de inferir de los items
                // Simplificación: si unitPriceUSD existe y > 0, asumimos USD
                const firstItem = invoice.invoiceItems[0];
                const isUSD = firstItem && Number(firstItem.unitPriceUSD) > 0;

                let earn = 0;
                for (const item of invoice.invoiceItems) {
                    const history = findHistoryAtDate(item.product.name, item.product.presentation, saleRefDate);
                    const product = history || productMap.get(item.productId);

                    const purchasePrice = Number(product?.purchasePrice || 0);
                    const purchasePriceUSD = Number(product?.purchasePriceUSD || 0);

                    if (isUSD) {
                        earn += (Number(item.unitPriceUSD) - purchasePriceUSD) * Number(item.quantity);
                    } else {
                        earn += (Number(item.unitPrice) - purchasePrice) * Number(item.quantity);
                    }
                }

                earn = Number(earn.toFixed(2));

                // Acumular métricas
                totalEarnRange += earn;
                quantityProductsRange += totalItems;

                if (invoice.dispatchDate >= startOfDay && invoice.dispatchDate <= endOfDay) totalEarnDay += earn;
                if (invoice.dispatchDate >= startOfMonth && invoice.dispatchDate <= endDate) {
                    totalEarnMonth += earn;
                    quantityProductsMonth += totalItems;
                }

                // Product sales
                for (const item of invoice.invoiceItems) {
                    const pid = item.productId;
                    if (!productSales[pid]) {
                        productSales[pid] = { name: item.product.name || 'Desconocido', presentation: item.product.presentation || 'Desconocido', quantity: 0 };
                    }
                    productSales[pid].quantity += Number(item.quantity);
                    totalQuantity += Number(item.quantity);
                }

                return {
                    id: invoice.id,
                    controlNumber: invoice.controlNumber,
                    dispatchDate: invoice.dispatchDate,
                    status: invoice.status,
                    client: invoice.client,
                    totalAmount: Number(invoice.totalAmount),
                    remaining,
                    earn,
                    totalItems: Number(totalItems.toFixed(4)),
                    hasGiftItems,
                    invoiceItems: invoice.invoiceItems.map(item => ({
                        id: item.id,
                        productId: item.productId,
                        quantity: Number(item.quantity),
                        type: item.type,
                        unitPrice: Number(item.unitPrice),
                        unitPriceUSD: Number(item.unitPriceUSD),
                        subtotal: Number(item.subtotal),
                        product: {
                            id: item.product.id,
                            name: item.product.name,
                            presentation: item.product.presentation,
                        }
                    })),
                };
            });

            const filteredInvoices = result.filter(inv => inv.remaining !== 0 || inv.hasGiftItems);

            const productPercentages = Object.entries(productSales)
                .map(([id, data]) => ({
                    productId: Number(id),
                    name: data.name,
                    presentation: data.presentation,
                    quantity: data.quantity,
                    percentage: totalQuantity > 0 ? (data.quantity / totalQuantity * 100).toFixed(2) : '0.00'
                }))
                .sort((a, b) => b.quantity - a.quantity);

            return {
                invoices: filteredInvoices,
                summary: {
                    totalEarnDay: Number(totalEarnDay.toFixed(2)),
                    totalEarnMonth: Number(totalEarnMonth.toFixed(2)),
                    totalEarnRange: Number(totalEarnRange.toFixed(2)),
                    productPercentages,
                    quantityProducts: {
                        totalEarnMonth: Number(quantityProductsMonth.toFixed(4)),
                        totalEarnRange: Number(quantityProductsRange.toFixed(4))
                    }
                }
            };
        } catch (err) {
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
            return badResponse;
        }
    }

    async getPayments(expenseFilter: ExpensesDTO) {
        try {
            const { startDate, endDate } = this.getNormalizedDateRange(expenseFilter);

            const payments = await this.prismaService.payment.findMany({
                where: {
                    account: {
                        name: { contains: 'Gastos' }
                    },
                    InvoicePayment: {
                        some: {
                            createdAt: {
                                gte: startDate,
                                lte: endDate
                            }
                        }
                    }
                },
                include: {
                    account: {
                        include: {
                            method: true
                        }
                    },
                    dolar: true
                }
            })

            const parsePayments = payments.map(payment => ({
                ...payment,
                amountUSD: this.parsePaymentAmount(payment)
            }))

            return parsePayments;
        } catch (err) {
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
            return badResponse;
        }
    }

    async getPaymentsNoAssociated(expenseFilter: ExpensesDTO) {
        try {
            const { startDate, endDate } = this.getNormalizedDateRange(expenseFilter);

            const payments = await this.prismaService.payment.findMany({
                where: {
                    account: {
                        name: { not: 'Gastos' }
                    },
                    paymentDate: {
                        gte: startDate,
                        lte: endDate
                    },
                    InvoicePayment: {
                        none: {}
                    }
                },
                include: {
                    account: {
                        include: {
                            method: true
                        }
                    },
                    dolar: true
                }
            })

            const parsePayments = payments.map(payment => ({
                ...payment,
                amountUSD: this.parsePaymentAmount(payment)
            }));

            return parsePayments;
        } catch (err) {
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
            return badResponse;
        }
    }
}
