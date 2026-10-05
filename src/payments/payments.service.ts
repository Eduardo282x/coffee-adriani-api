import { Injectable } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import {
  badResponse,
  baseResponse,
  createBadResponse,
  DashboardExcel,
  DTODateRangeFilter,
} from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  AccountsDTO,
  PayDisassociateDTO,
  PayInvoiceDTO,
  PaymentDTO,
} from './payment.dto';
import { ProductsService } from 'src/products/products.service';
import { BankData } from './payments.data';
import {
  calculateInvoiceRemainingUsd,
  calculatePaymentRemaining,
  isInvoiceSettled,
  round2,
  toNumber,
} from 'src/common/remaining-calculator';
import { InvoicesService } from 'src/invoices/invoices.service';
import {
  isPendingConfirmationMethod,
  looksLikeLegacyExpenseAccount,
} from 'src/common/business-rules';
import { InvoiceStatus } from 'src/generated/prisma/enums';

interface PaymentFilterPaginate extends PaymentFilter {
  page: number;
  limit: number;
}

interface PaymentFilter {
  startDate?: string;
  endDate?: string;
  accountId?: number;
  methodId?: number;
  associated?: boolean;
  type?: string;
  accountType?: string;
  typeDescription?: string;
  paymentType?: string;
  search?: string;
  credit?: 'credit' | 'noCredit';
}

const SPANISH_WEEKDAYS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

interface InvoiceAnalysisRow {
  controlNumber: string;
  client: string;
  block: string;
  zone: string;
  blockId: number;
  status: string;
  dispatchDate: Date;
  dueDate: Date;
  totalBultos: number;
  totalBultosPagados: number;
  totalAmount: number;
  remaining: number;
  date: string;
  day: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly productService: ProductsService,
    private readonly invoicesService: InvoicesService,
  ) {}

  private getStartOfDayUtc(date: string) {
    return new Date(`${date}T00:00:00.000Z`);
  }

  private getEndOfDayUtc(date: string) {
    return new Date(`${date}T23:59:59.999Z`);
  }

  private toDateKeyUTC(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // NUEVOS MÉTODOS OPTIMIZADOS EN PaymentsService

  async getPaymentsPaginated(filters: PaymentFilterPaginate) {
    try {
      const {
        page,
        limit,
        startDate,
        endDate,
        accountId,
        methodId,
        associated,
        type,
        typeDescription,
        accountType,
        paymentType,
        credit,
        search,
      } = filters;
      const skip = (page - 1) * limit;

      // Construir where clause dinámicamente
      const where: any = {
        deleted: false,
        type: { notIn: ['SUPPLIER', 'PERSONAL_EXPENSES'] },
      };

      if (startDate && endDate) {
        where.paymentDate = {
          gte: this.getStartOfDayUtc(startDate),
          lte: this.getEndOfDayUtc(endDate),
        };
      }

      if (accountId) {
        where.accountId = accountId;
      }

      if (credit) {
        if (credit == 'credit') {
          where.InvoicePayment = {
            some: {},
          };
        } else {
          where.InvoicePayment = {
            none: {},
          };
          // Los pagos sin relación con facturas se filtran por type INCOME
          where.type = 'INCOME';
        }
      }

      // `type` y `search` antes escribian ambos en `where.OR`, de modo que
      // combinar los dos filtros hacia que el segundo pise al primero y el
      // filtro por tipo de producto se perdiera en silencio. Ahora se acumulan
      // en una lista AND.
      const andFilters: Prisma.PaymentWhereInput[] = [];

      if (type) {
        andFilters.push({
          OR: [
            { InvoicePayment: { none: {} } },
            {
              InvoicePayment: {
                some: {
                  invoice: {
                    invoiceItems: { some: { product: { type: type } } },
                  },
                },
              },
            },
          ],
        });
      }

      if (search) {
        const searchAsNumber = parseFloat(search);
        const isValidNumber = !isNaN(searchAsNumber);

        andFilters.push({
          OR: [
            {
              account: {
                name: { contains: search, mode: 'insensitive' },
              },
            },
            {
              InvoicePayment: {
                some: {
                  invoice: {
                    client: {
                      name: { contains: search, mode: 'insensitive' },
                    },
                  },
                },
              },
            },
            {
              reference: { contains: search, mode: 'insensitive' },
            },
            // `amount` es Decimal(10,2): un rango de 1 unidad capturaba
            // "100" junto con "100.99". Se acota a 2 decimales.
            ...(isValidNumber
              ? [{ amount: { gte: searchAsNumber, lt: searchAsNumber + 1 } }]
              : []),
          ],
        });
      }

      if (andFilters.length > 0) {
        where.AND = andFilters;
      }

      if (typeDescription) {
        where.description = {
          contains: typeDescription,
          mode: 'insensitive',
        };
      }

      if (methodId) {
        where.account = {
          methodId: methodId,
        };
      }

      if (accountType) {
        where.type = accountType;
      }

      if (associated !== undefined) {
        if (associated) {
          where.InvoicePayment = {
            some: {},
          };
        } else {
          where.InvoicePayment = {
            none: {},
          };
          // Los pagos sin asociar a facturas se filtran por type INCOME
          where.type = 'INCOME';
        }
      }

      if (paymentType) {
        where.type = paymentType;
      }

      const paymentSelect = {
        id: true,
        amount: true,
        reference: true,
        description: true,
        paymentDate: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        accountId: true,
        type: true,
        dolar: {
          select: { id: true, dolar: true, date: true },
        },
        account: {
          select: {
            id: true,
            name: true,
            bank: true,
            method: {
              select: { id: true, name: true, currency: true },
            },
          },
        },
        InvoicePayment: {
          // Si viene `type`, traer sólo las asociaciones cuyo invoice
          // tenga items con productos de ese tipo.
          where: type
            ? {
                invoice: {
                  invoiceItems: {
                    some: { product: { type: type } },
                  },
                },
              }
            : undefined,
          select: {
            id: true,
            invoiceId: true,
            paymentId: true,
            amount: true,
            createdAt: true,
            invoice: {
              select: {
                id: true,
                controlNumber: true,
                dispatchDate: true,
                dueDate: true,
                totalAmount: true,
                consignment: true,
                status: true,
                deleted: true,
                client: {
                  select: {
                    id: true,
                    name: true,
                    rif: true,
                    block: {
                      select: { id: true, name: true },
                    },
                  },
                },
              },
            },
          },
        },
      } satisfies Prisma.PaymentSelect;

      /**
       * `credit === 'credit'` es un filtro DERIVADO (tiene asociaciones y le
       * queda saldo). Antes se aplicaba despues de `skip/take`, lo que
       * devolvia paginas vacias, `totalCount` sin filtrar y `totalPages`
       * calculado sobre el largo de la pagina (siempre 1).
       *
       * Prisma no puede expresar "monto - suma(asignaciones) > 0" como filtro
       * de relacion, asi que se resuelve en dos fases: una lectura ligera de
       * solo los campos necesarios para evaluar el predicado, y luego la
       * carga completa unicamente de la pagina pedida.
       */
      let payments: Array<{
        id: number;
        amount: Prisma.Decimal;
        reference: string;
        description: string;
        paymentDate: Date;
        status: unknown;
        createdAt: Date;
        updatedAt: Date;
        accountId: number;
        type: unknown;
        dolar: { id: number; dolar: Prisma.Decimal; date: Date };
        account: {
          id: number;
          name: string;
          bank: string;
          method: { id: number; name: string; currency: string };
        };
        InvoicePayment: Array<{ amount: Prisma.Decimal }>;
      }>;
      let totalCount: number;

      if (credit === 'credit') {
        const candidates = await this.prismaService.payment.findMany({
          where,
          orderBy: { paymentDate: 'desc' },
          select: {
            id: true,
            amount: true,
            dolar: { select: { dolar: true } },
            account: { select: { method: { select: { currency: true } } } },
            InvoicePayment: { select: { amount: true } },
          },
        });

        const creditedIds = candidates
          .filter((candidate) => {
            if (candidate.InvoicePayment.length === 0) return false;
            const balance = calculatePaymentRemaining(
              candidate.amount,
              candidate.account.method.currency as 'USD' | 'BS',
              candidate.dolar.dolar,
              candidate.InvoicePayment,
            );
            return balance.remainingOriginal > 0;
          })
          .map((candidate) => candidate.id);

        totalCount = creditedIds.length;
        const pageIds = creditedIds.slice(skip, skip + limit);

        payments =
          pageIds.length > 0
            ? await this.prismaService.payment.findMany({
                where: { id: { in: pageIds } },
                select: paymentSelect,
              })
            : [];

        // Restaurar el orden global (paymentDate desc) de la pagina.
        const order = new Map(pageIds.map((id, index) => [id, index]));
        payments.sort(
          (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
        );
      } else {
        [payments, totalCount] = await Promise.all([
          this.prismaService.payment.findMany({
            select: paymentSelect,
            where,
            orderBy: { paymentDate: 'desc' },
            skip,
            take: limit,
          }),
          this.prismaService.payment.count({ where }),
        ]);
      }

      const processedPayments = payments.map((data) => {
        const filteredInvoicePayments = data.InvoicePayment;
        const paymentBalance = calculatePaymentRemaining(
          data.amount,
          data.account.method.currency as 'USD' | 'BS',
          data.dolar.dolar,
          filteredInvoicePayments,
        );

        return {
          ...data,
          InvoicePayment: filteredInvoicePayments,
          associated: filteredInvoicePayments.length > 0,
          amount: toNumber(data.amount).toFixed(2),
          amountUSD: (data.account.method.currency === 'USD'
            ? toNumber(data.amount)
            : toNumber(data.dolar.dolar) > 0
              ? toNumber(data.amount) / toNumber(data.dolar.dolar)
              : 0
          ).toFixed(2),
          amountBs: (data.account.method.currency === 'BS'
            ? toNumber(data.amount)
            : toNumber(data.amount) * toNumber(data.dolar.dolar)
          ).toFixed(2),
          remaining: paymentBalance.remainingOriginal.toFixed(2),
          remainingUSD: paymentBalance.remainingUSD.toFixed(2),
          credit:
            filteredInvoicePayments.length > 0 &&
            paymentBalance.remainingOriginal > 0,
        };
      });

      const totalPages = Math.ceil(totalCount / limit);
      const hasNext = page < totalPages;
      const hasPrev = page > 1;

      return {
        payments: processedPayments,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasNext,
          hasPrev,
        },
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Error al obtener pagos paginados: ${errMsg}`);
    }
  }

  async getPaymentsStatistics(filters: PaymentFilter) {
    try {
      const {
        startDate,
        endDate,
        accountId,
        methodId,
        associated,
        type,
        typeDescription,
        credit,
        search,
      } = filters;

      // Construir where clause dinámicamente
      const where: any = {
        // Las estadísticas de ingresos solo consideran pagos INCOME
        deleted: false,
        type: 'INCOME',
      };

      if (startDate && endDate) {
        where.paymentDate = {
          gte: this.getStartOfDayUtc(startDate),
          lte: this.getEndOfDayUtc(endDate),
        };
      }

      if (credit) {
        if (credit == 'credit') {
          where.InvoicePayment = {
            some: {},
          };
        } else {
          where.InvoicePayment = {
            none: {},
          };
          where.type = 'INCOME';
        }
      }

      // `type` y `search` antes escribian ambos en `where.OR`, de modo que
      // combinar los dos filtros hacia que el segundo pise al primero y el
      // filtro por tipo de producto se perdiera en silencio. Ahora se acumulan
      // en una lista AND.
      const andFilters: Prisma.PaymentWhereInput[] = [];

      if (type) {
        andFilters.push({
          OR: [
            { InvoicePayment: { none: {} } },
            {
              InvoicePayment: {
                some: {
                  invoice: {
                    invoiceItems: { some: { product: { type: type } } },
                  },
                },
              },
            },
          ],
        });
      }

      if (search) {
        const searchAsNumber = parseFloat(search);
        const isValidNumber = !isNaN(searchAsNumber);

        andFilters.push({
          OR: [
            {
              account: {
                name: { contains: search, mode: 'insensitive' },
              },
            },
            {
              InvoicePayment: {
                some: {
                  invoice: {
                    client: {
                      name: { contains: search, mode: 'insensitive' },
                    },
                  },
                },
              },
            },
            {
              reference: { contains: search, mode: 'insensitive' },
            },
            // `amount` es Decimal(10,2): un rango de 1 unidad capturaba
            // "100" junto con "100.99". Se acota a 2 decimales.
            ...(isValidNumber
              ? [{ amount: { gte: searchAsNumber, lt: searchAsNumber + 1 } }]
              : []),
          ],
        });
      }

      if (andFilters.length > 0) {
        where.AND = andFilters;
      }
      if (typeDescription) {
        where.description = {
          contains: typeDescription,
          mode: 'insensitive',
        };
      }
      if (accountId) {
        where.accountId = accountId;
      }

      if (methodId) {
        where.account = {
          methodId: methodId,
        };
      }

      if (associated !== undefined) {
        if (associated) {
          where.InvoicePayment = {
            some: {},
          };
        } else {
          where.InvoicePayment = {
            none: {},
          };
          // Los pagos sin asociar a facturas se filtran por type INCOME
          where.type = 'INCOME';
        }
      }

      const payments = await this.prismaService.payment.findMany({
        include: {
          dolar: true,
          account: {
            include: { method: true },
          },
          InvoicePayment: {
            include: {
              invoice: {
                include: {
                  client: { include: { block: true } },
                  invoiceItems: { include: { product: true } },
                },
              },
            },
          },
        },
        where,
      });

      // Si se proporcionó `type`, mantener sólo las InvoicePayment cuya
      // factura contiene productos de ese tipo. Esto evita contar/mostrar
      // facturas de otros tipos cuando un pago está asociado a varias.
      const processedPayments = payments.map((data) => {
        const filteredInvoicePayments = type
          ? data.InvoicePayment.filter(
              (ip: any) =>
                !!ip.invoice &&
                Array.isArray(ip.invoice.invoiceItems) &&
                ip.invoice.invoiceItems.some(
                  (ii: any) => ii.product?.type === type,
                ),
            )
          : data.InvoicePayment;
        return {
          ...data,
          InvoicePayment: filteredInvoicePayments,
        } as any;
      });

      // InvoicePayment original (sin filtrar por tipo) para calcular remaining real
      const originalInvoicePayments = new Map<number, any[]>();
      payments.forEach((p) =>
        originalInvoicePayments.set(p.id, p.InvoicePayment),
      );

      // const paymentInvoiceWithoutType = payments.filter((data) =>
      //   data.InvoicePayment.some(
      //     (ip: any) =>
      //       !!ip.invoice &&
      //       Array.isArray(ip.invoice.invoiceItems) &&
      //       ip.invoice.invoiceItems.every(
      //         (ii: any) => ii.product?.type !== type,
      //       ),
      //   ),
      // );

      // console.log(`Facturas de tipo seleccionado: ${paymentInvoiceWithType.length}`);
      // console.log(`Facturas sin tipo seleccionado: ${paymentInvoiceWithoutType.length}`);
      // console.log(`Monto total de facturas sin tipo seleccionado: ${paymentInvoiceWithoutType.reduce((acc, data) => acc + Number(data.amount), 0)}`);
      // console.log(`Facturas sin tipo: ${[...new Set(controlNumberInvoicesWihoutType)].join(', ')}`);
      // console.log(`Suma de las facturas sin tipo: ${sumInvoiceWithoutType}`);

      // Calcular estadísticas
      const totalAmountBs = processedPayments
        .filter((item) => item.account.method.currency === 'BS')
        .reduce((acc, data) => acc + Number(data.amount), 0);

      const totalAmountBsInUSD = processedPayments
        .filter((item) => item.account.method.currency === 'BS')
        .reduce(
          (acc, data) => acc + Number(data.amount) / Number(data.dolar.dolar),
          0,
        );

      const totalAmountUSD = processedPayments
        .filter((item) => item.account.method.currency === 'USD')
        .reduce((acc, data) => acc + Number(data.amount), 0);

      const totalRemainingBs = processedPayments
        .filter((item) => item.account.method.currency === 'BS')
        .reduce(
          (acc, data) =>
            acc +
            calculatePaymentRemaining(
              data.amount,
              data.account.method.currency,
              data.dolar.dolar,
              originalInvoicePayments.get(data.id) || [],
            ).remainingOriginal,
          0,
        );

      const totalRemainingBsInUSD = processedPayments
        .filter((item) => item.account.method.currency === 'BS')
        .reduce(
          (acc, data) =>
            acc +
            calculatePaymentRemaining(
              data.amount,
              data.account.method.currency,
              data.dolar.dolar,
              originalInvoicePayments.get(data.id) || [],
            ).remainingUSD,
          0,
        );

      const totalRemainingUSD = processedPayments
        .filter((item) => item.account.method.currency === 'USD')
        .reduce(
          (acc, data) =>
            acc +
            calculatePaymentRemaining(
              data.amount,
              data.account.method.currency,
              data.dolar.dolar,
              originalInvoicePayments.get(data.id) || [],
            ).remainingOriginal,
          0,
        );

      const totalGrossUSD = totalAmountBsInUSD + totalAmountUSD;

      // Si viene `type`, restar del total los montos asignados a facturas
      // que NO tengan el tipo solicitado.
      const otherTypeAllocatedUSD = type
        ? payments.reduce((acc, payment: any) => {
            const invoicePayments = Array.isArray(payment.InvoicePayment)
              ? payment.InvoicePayment
              : [];

            const otherAssigned = invoicePayments.reduce(
              (sum: number, ip: any) => {
                const items = ip?.invoice?.invoiceItems;
                const hasSelectedType =
                  Array.isArray(items) &&
                  items.some((ii: any) => ii?.product?.type === type);

                // Considerar "otros tipos" sólo si la factura NO tiene
                // ningún item del tipo seleccionado.
                if (!hasSelectedType) {
                  return sum + Number(ip.amount);
                }

                return sum;
              },
              0,
            );

            const otherAssignedUSD =
              payment.account?.method?.currency === 'USD'
                ? otherAssigned
                : otherAssigned / Number(payment.dolar?.dolar);

            return acc + otherAssignedUSD;
          }, 0)
        : 0;

      const totalNetUSD = type
        ? totalGrossUSD - otherTypeAllocatedUSD
        : totalGrossUSD;

      // Contar asociados/no asociados y calcular monto USD de no asociados
      const unassociated = processedPayments.filter(
        (p) => !p.InvoicePayment || p.InvoicePayment.length === 0,
      );
      const associatedPayments = processedPayments.length - unassociated.length;
      const unassociatedPayments = unassociated.length;
      const unassociatedAmount = unassociated.reduce((acc, p) => {
        return (
          acc +
          (p.account?.method?.currency === 'USD'
            ? Number(p.amount)
            : Number(p.amount) / Number(p.dolar?.dolar || 1))
        );
      }, 0);

      const buildTypeStats = (payments: any[]) => {
        const totalBs = payments
          .filter((item) => item.account.method.currency === 'BS')
          .reduce((acc, data) => acc + Number(data.amount), 0);

        const totalBsInUSD = payments
          .filter((item) => item.account.method.currency === 'BS')
          .reduce(
            (acc, data) => acc + Number(data.amount) / Number(data.dolar.dolar),
            0,
          );

        const totalUSD = payments
          .filter((item) => item.account.method.currency === 'USD')
          .reduce((acc, data) => acc + Number(data.amount), 0);

        return {
          totalBs,
          totalUSD,
          totalBsInUSD,
          total: totalBsInUSD + totalUSD,
          count: payments.length,
        };
      };

      // Totales separados por tipo de pago (EXPENSE, PERSONAL_EXPENSES, SUPPLIER)
      const expenseWhere: any = {
        deleted: false,
        type: 'EXPENSE',
      };

      const personalExpensesWhere: any = {
        deleted: false,
        type: 'PERSONAL_EXPENSES',
      };

      const supplierWhere: any = {
        deleted: false,
        type: 'SUPPLIER',
      };

      const typePaymentFilters = (where: any) => {
        if (startDate && endDate) {
          where.paymentDate = {
            gte: this.getStartOfDayUtc(startDate),
            lte: this.getEndOfDayUtc(endDate),
          };
        }

        if (accountId) {
          where.accountId = accountId;
        }

        if (methodId) {
          where.account = {
            methodId: methodId,
          };
        }

        if (type) {
          where.OR = [
            {
              InvoicePayment: { none: {} },
            },
            {
              InvoicePayment: {
                some: {
                  invoice: {
                    invoiceItems: {
                      some: {
                        product: {
                          type: { contains: type, mode: 'insensitive' },
                        },
                      },
                    },
                  },
                },
              },
            },
          ];
        }
      };

      typePaymentFilters(expenseWhere);
      typePaymentFilters(personalExpensesWhere);
      typePaymentFilters(supplierWhere);

      const typePaymentSelect = {
        amount: true,
        account: {
          select: {
            method: {
              select: { currency: true },
            },
          },
        },
        dolar: {
          select: { dolar: true },
        },
      };

      const [expensePayments, personalExpensesPayments, supplierPayments] =
        await Promise.all([
          this.prismaService.payment.findMany({
            where: expenseWhere,
            select: typePaymentSelect,
          }),
          this.prismaService.payment.findMany({
            where: personalExpensesWhere,
            select: typePaymentSelect,
          }),
          this.prismaService.payment.findMany({
            where: supplierWhere,
            select: typePaymentSelect,
          }),
        ]);

      const expenses = buildTypeStats(expensePayments);
      const personalExpenses = buildTypeStats(personalExpensesPayments);
      const supplier = buildTypeStats(supplierPayments);
      const expensesGroup = {
        totalBs: expenses.totalBs + personalExpenses.totalBs,
        totalUSD: expenses.totalUSD + personalExpenses.totalUSD,
        totalBsInUSD: expenses.totalBsInUSD + personalExpenses.totalBsInUSD,
        total: expenses.total + personalExpenses.total,
        count: expenses.count + personalExpenses.count,
      };

      // Obtener facturas perdidas para totalLost (mismo rango de fechas y tipo)
      const lostInvoicesWhere: any = {
        status: 'Perdidas',
      };

      if (startDate && endDate) {
        lostInvoicesWhere.dispatchDate = {
          gte: this.getStartOfDayUtc(startDate),
          lte: this.getEndOfDayUtc(endDate),
        };
      }

      if (type) {
        lostInvoicesWhere.invoiceItems = {
          some: {
            product: {
              type: type,
            },
          },
        };
      }

      const lostInvoices = await this.prismaService.invoice.findMany({
        where: lostInvoicesWhere,
        select: {
          totalAmount: true,
        },
      });

      const totalLost = lostInvoices.reduce(
        (acc, inv) => acc + Number(inv.totalAmount),
        0,
      );

      return {
        totalLost,
        totals: {
          totalBs: totalAmountBs,
          totalBsInUSD: totalAmountBsInUSD,
          totalUSD: totalAmountUSD,
          total: totalNetUSD,
          remaining: totalRemainingBsInUSD + totalRemainingUSD,
          totalRemainingBs,
          totalRemainingUSD,
          unassociatedAmount,
        },
        expenses,
        personalExpenses,
        expensesGroup,
        supplier,
        counts: {
          total: payments.length,
          associated: associatedPayments,
          unassociated: unassociatedPayments,
        },
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Error al obtener estadísticas de pagos: ${errMsg}`);
    }
  }

  async getPaymentItemsAnalysis(filter: DashboardExcel) {
    const { type, startDate, endDate } = filter;
    const startDateStr = this.toDateKeyUTC(new Date(startDate));
    const endDateStr = this.toDateKeyUTC(new Date(endDate));

    const start = this.getStartOfDayUtc(startDateStr);
    const end = this.getEndOfDayUtc(endDateStr);

    const payments = await this.prismaService.payment.findMany({
      where: {
        deleted: false,
        type: 'INCOME',
        paymentDate: { gte: start, lte: end },
      },
      select: {
        id: true,
        amount: true,
        paymentDate: true,
        dolar: { select: { dolar: true } },
        account: { select: { method: { select: { currency: true } } } },
        InvoicePayment: {
          select: {
            id: true,
            amount: true,
            invoice: {
              select: {
                id: true,
                controlNumber: true,
                dispatchDate: true,
                dueDate: true,
                totalAmount: true,
                status: true,
                client: {
                  select: {
                    name: true,
                    zone: true,
                    blockId: true,
                    block: { select: { name: true } },
                  },
                },
                invoiceItems: {
                  where: {
                    type: 'SALE',
                    product: { type: { contains: type, mode: 'insensitive' } },
                  },
                  select: {
                    quantity: true,
                    unitPrice: true,
                    unitPriceUSD: true,
                    product: {
                      select: {
                        name: true,
                        presentation: true,
                        purchasePrice: true,
                        purchasePriceUSD: true,
                      },
                    },
                  },
                },
                InvoicePayment: { select: { amount: true } },
              },
            },
          },
        },
      },
      orderBy: { paymentDate: 'asc' },
    });

    const days: Date[] = [];
    for (
      let d = new Date(`${startDateStr}T00:00:00.000Z`);
      d <= end;
      d = new Date(d.getTime() + 86400000)
    ) {
      if (d.getUTCDay() !== 0) {
        days.push(d);
      }
    }

    const dailyMap = new Map<
      string,
      {
        date: string;
        day: string;
        totalItems: number;
        totalAmount: number;
        detailItems: Record<
          string,
          { totalElements: number; totalAmount: number }
        >;
        invoices: InvoiceAnalysisRow[];
      }
    >();

    days.forEach((dia) => {
      const dateKey = this.toDateKeyUTC(dia);
      dailyMap.set(dateKey, {
        date: dateKey,
        day: SPANISH_WEEKDAYS[dia.getUTCDay()],
        totalItems: 0,
        totalAmount: 0,
        detailItems: {},
        invoices: [],
      });
    });

    const invoicesMap = new Map<string, InvoiceAnalysisRow>();
    const uniqueInvoiceIds = new Set<number>();

    let totalPayments = 0;
    const generalItemsMap: Record<
      string,
      { totalElements: number; totalAmount: number }
    > = {};

    for (const payment of payments) {
      totalPayments += 1;

      const dayEntry = dailyMap.get(
        this.toDateKeyUTC(new Date(payment.paymentDate)),
      );

      for (const ip of payment.InvoicePayment) {
        const invoice = ip.invoice;
        if (invoice.status === 'Perdidas' || invoice.status === 'Cancelada') {
          continue;
        }
        const items = invoice.invoiceItems;
        if (!items || items.length === 0) continue;

        const montoAsignado = toNumber(ip.amount);
        const totalFactura = toNumber(invoice.totalAmount);
        const porcentajePagado =
          totalFactura > 0 ? montoAsignado / totalFactura : 0;

        const cantidadTotalItems = items.reduce(
          (sum, item) =>
            sum +
            toNumber(item.quantity) *
              (item.product.presentation === '1kilo' ? 0.2 : 1),
          0,
        );
        const equivalenteItems = cantidadTotalItems * porcentajePagado;

        items.forEach((item) => {
          const cantidadPagada =
            toNumber(item.quantity) *
            (item.product.presentation === '1kilo' ? 0.2 : 1) *
            porcentajePagado;
          const productKey =
            `${item.product.name} ${item.product.presentation}`.trim();

          const purchasePriceUSD =
            toNumber(item.product.purchasePriceUSD) ||
            toNumber(item.product.purchasePrice) ||
            0;
          const unitProfit = toNumber(item.unitPriceUSD) - purchasePriceUSD;
          const profitItem = unitProfit * cantidadPagada;

          const existing = dayEntry?.detailItems[productKey] || {
            totalElements: 0,
            totalAmount: 0,
          };
          existing.totalElements += cantidadPagada;
          existing.totalAmount += profitItem;
          if (dayEntry) {
            dayEntry.detailItems[productKey] = existing;
            dayEntry.totalAmount += profitItem;
          }

          const globalExisting = generalItemsMap[productKey] || {
            totalElements: 0,
            totalAmount: 0,
          };
          globalExisting.totalElements += cantidadPagada;
          globalExisting.totalAmount += profitItem;
          generalItemsMap[productKey] = globalExisting;
        });

        if (dayEntry) {
          dayEntry.totalItems += equivalenteItems;
        }

        if (dayEntry) {
          uniqueInvoiceIds.add(invoice.id);

          const invoiceKey = `${invoice.id}_${dayEntry.date}`;
          const existingRow = invoicesMap.get(invoiceKey);
          if (existingRow) {
            existingRow.totalBultosPagados += equivalenteItems;
          } else {
            const row: InvoiceAnalysisRow = {
              controlNumber: invoice.controlNumber,
              client: invoice.client?.name || '',
              block: invoice.client?.block?.name || '',
              zone: invoice.client?.zone || '',
              blockId: invoice.client?.blockId ?? 0,
              status: invoice.status,
              dispatchDate: invoice.dispatchDate,
              dueDate: invoice.dueDate,
              totalBultos: cantidadTotalItems,
              totalBultosPagados: equivalenteItems,
              totalAmount: totalFactura,
              remaining: calculateInvoiceRemainingUsd(
                totalFactura,
                invoice.InvoicePayment,
              ),
              date: dayEntry.date,
              day: dayEntry.day,
            };
            invoicesMap.set(invoiceKey, row);
            dayEntry.invoices.push(row);
          }
        }
      }
    }

    const mapInvoiceRow = (inv: InvoiceAnalysisRow) => ({
      controlNumber: inv.controlNumber,
      client: inv.client,
      block: inv.block,
      zone: inv.zone,
      blockId: inv.blockId,
      status: inv.status,
      dispatchDate: inv.dispatchDate,
      dueDate: inv.dueDate,
      totalBultos: round2(inv.totalBultos),
      totalBultosPagados: round2(inv.totalBultosPagados),
      totalAmount: round2(inv.totalAmount),
      remaining: round2(inv.remaining),
      date: inv.date,
      day: inv.day,
    });

    const sortInvoicesByBlockId = (
      a: InvoiceAnalysisRow,
      b: InvoiceAnalysisRow,
    ) => a.blockId - b.blockId;

    const daily = Array.from(dailyMap.values()).map((entry) => ({
      date: entry.date,
      day: entry.day,
      totalItems: round2(entry.totalItems),
      totalAmount: round2(entry.totalAmount),
      detailItems: Object.entries(entry.detailItems)
        .map(([product, data]) => ({
          product,
          totalElements: round2(data.totalElements),
          unitPrice:
            data.totalElements > 0
              ? round2(data.totalAmount / data.totalElements)
              : 0,
          totalAmount: round2(data.totalAmount),
        }))
        .sort((a, b) => b.totalElements - a.totalElements),
      invoices: entry.invoices.sort(sortInvoicesByBlockId).map(mapInvoiceRow),
    }));

    const invoices = Array.from(invoicesMap.values())
      .sort(sortInvoicesByBlockId)
      .map(mapInvoiceRow);

    const totalItems = daily.reduce((acc, d) => acc + d.totalItems, 0);
    const totalAmount = daily.reduce((acc, d) => acc + d.totalAmount, 0);

    const generalItemsDetail = Object.entries(generalItemsMap)
      .map(([product, data]) => ({
        product,
        totalElements: round2(data.totalElements),
        unitPrice:
          data.totalElements > 0
            ? round2(data.totalAmount / data.totalElements)
            : 0,
        totalAmount: round2(data.totalAmount),
      }))
      .sort((a, b) => b.totalElements - a.totalElements);

    return {
      type,
      startDate: startDateStr,
      endDate: endDateStr,
      totals: {
        totalItems: round2(totalItems),
        totalAmount: round2(totalAmount),
        totalInvoices: uniqueInvoiceIds.size,
        totalPayments,
      },
      generalItems: {
        totalItems: round2(totalItems),
        totalAmount: round2(totalAmount),
        detailItems: generalItemsDetail,
      },
      daily,
      invoices,
    };
  }

  async getPaymentDetails(paymentId: number) {
    try {
      const payment = await this.prismaService.payment.findFirst({
        where: { id: paymentId, deleted: false },
        include: {
          dolar: true,
          account: {
            include: { method: true },
          },
          InvoicePayment: {
            include: {
              invoice: {
                include: {
                  client: {
                    include: { block: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!payment) {
        throw new Error('Pago no encontrado');
      }

      return {
        ...payment,
        associated: payment.InvoicePayment.length > 0,
        amount: payment.amount.toFixed(2),
        amountUSD:
          payment.account.method.currency === 'USD'
            ? payment.amount.toFixed(2)
            : (Number(payment.amount) / Number(payment.dolar.dolar)).toFixed(2),
        amountBs:
          payment.account.method.currency === 'BS'
            ? payment.amount.toFixed(2)
            : (Number(payment.amount) * Number(payment.dolar.dolar)).toFixed(2),
        remaining: calculatePaymentRemaining(
          payment.amount,
          payment.account.method.currency,
          payment.dolar.dolar,
          payment.InvoicePayment,
        ).remainingOriginal.toFixed(2),
        remainingUSD: calculatePaymentRemaining(
          payment.amount,
          payment.account.method.currency,
          payment.dolar.dolar,
          payment.InvoicePayment,
        ).remainingUSD.toFixed(2),
        credit:
          payment.InvoicePayment.length > 0 &&
          calculatePaymentRemaining(
            payment.amount,
            payment.account.method.currency,
            payment.dolar.dolar,
            payment.InvoicePayment,
          ).remainingOriginal > 0,
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Error al obtener detalles del pago: ${errMsg}`);
    }
  }

  async getPayments() {
    const dataPayments = await this.prismaService.payment
      .findMany({
        include: {
          dolar: true,
          account: {
            include: { method: true },
          },
          InvoicePayment: {
            include: {
              invoice: { include: { client: { include: { block: true } } } },
            },
          },
        },
        where: {
          deleted: false,
          type: { notIn: ['SUPPLIER', 'PERSONAL_EXPENSES'] },
        },
        orderBy: { paymentDate: 'desc' },
      })
      .then((pay) =>
        pay.map((data) => {
          return {
            ...data,
            associated: data.InvoicePayment.length > 0,
            amount: data.amount.toFixed(2),
            amountUSD:
              data.account.method.currency === 'USD'
                ? data.amount.toFixed(2)
                : (Number(data.amount) / Number(data.dolar.dolar)).toFixed(2),
            amountBs:
              data.account.method.currency === 'BS'
                ? data.amount.toFixed(2)
                : (Number(data.amount) * Number(data.dolar.dolar)).toFixed(2),
            remaining: calculatePaymentRemaining(
              data.amount,
              data.account.method.currency,
              data.dolar.dolar,
              data.InvoicePayment,
            ).remainingOriginal.toFixed(2),
            remainingUSD: calculatePaymentRemaining(
              data.amount,
              data.account.method.currency,
              data.dolar.dolar,
              data.InvoicePayment,
            ).remainingUSD.toFixed(2),
            credit:
              data.InvoicePayment.length > 0 &&
              calculatePaymentRemaining(
                data.amount,
                data.account.method.currency,
                data.dolar.dolar,
                data.InvoicePayment,
              ).remainingOriginal > 0,
          };
        }),
      );

    const totalAmountBs = dataPayments
      .filter((item) => item.account.method.currency === 'BS')
      .reduce((acc, data) => acc + Number(data.amount), 0);
    const totalAmountUSB = dataPayments
      .filter((item) => item.account.method.currency === 'USD')
      .reduce((acc, data) => acc + Number(data.amount), 0);
    // const totalUsd = dataPayments.reduce((acc, data) => acc + Number(data.amountUSD), 0)

    return {
      payments: dataPayments,
      totalBs: totalAmountBs,
      totalUSD: totalAmountUSB,
    };
  }

  async getAccountsPayments() {
    return await this.prismaService.accountsPayments.findMany({
      include: {
        method: true,
      },
    });
  }

  async createAccountPayment(account: AccountsDTO) {
    try {
      await this.prismaService.accountsPayments.create({
        data: {
          name: account.name,
          bank: account.bank,
          methodId: account.methodId,
        },
      });
      baseResponse.message = 'Cuenta de pago creada correctamente';
      return baseResponse;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      badResponse.message = errMsg;
      return badResponse;
    }
  }

  async updateAccountPayment(id: number, account: AccountsDTO) {
    try {
      await this.prismaService.accountsPayments.update({
        data: {
          name: account.name,
          bank: account.bank,
          methodId: account.methodId,
        },
        where: { id },
      });
      baseResponse.message = 'Cuenta de pago actualizada correctamente';
      return baseResponse;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      badResponse.message = errMsg;
      return badResponse;
    }
  }

  async getPaymentsFilter(filter: DTODateRangeFilter) {
    const dataPayments = await this.prismaService.payment
      .findMany({
        include: {
          dolar: true,
          account: {
            include: { method: true },
          },
          InvoicePayment: {
            include: {
              invoice: { include: { client: { include: { block: true } } } },
            },
          },
        },
        orderBy: { paymentDate: 'desc' },
        where: {
          deleted: false,
          paymentDate: {
            gte: filter.startDate,
            lte: filter.endDate,
          },
          type: { notIn: ['SUPPLIER', 'PERSONAL_EXPENSES'] },
        },
      })
      .then((pay) =>
        pay.map((data) => {
          return {
            ...data,
            associated: data.InvoicePayment.length > 0,
            amount: data.amount.toFixed(2),
            amountUSD:
              data.account.method.currency === 'USD'
                ? data.amount.toFixed(2)
                : (Number(data.amount) / Number(data.dolar.dolar)).toFixed(2),
            amountBs:
              data.account.method.currency === 'BS'
                ? data.amount.toFixed(2)
                : (Number(data.amount) * Number(data.dolar.dolar)).toFixed(2),
            remaining: calculatePaymentRemaining(
              data.amount,
              data.account.method.currency,
              data.dolar.dolar,
              data.InvoicePayment,
            ).remainingOriginal.toFixed(2),
            remainingUSD: calculatePaymentRemaining(
              data.amount,
              data.account.method.currency,
              data.dolar.dolar,
              data.InvoicePayment,
            ).remainingUSD.toFixed(2),
            credit:
              data.InvoicePayment.length > 0 &&
              calculatePaymentRemaining(
                data.amount,
                data.account.method.currency,
                data.dolar.dolar,
                data.InvoicePayment,
              ).remainingOriginal > 0,
          };
        }),
      );

    const totalAmountBs = dataPayments
      .filter((item) => item.account.method.currency === 'BS')
      .reduce((acc, data) => acc + Number(data.amount), 0);
    const totalAmountUSB = dataPayments
      .filter((item) => item.account.method.currency === 'USD')
      .reduce((acc, data) => acc + Number(data.amount), 0);

    return {
      payments: dataPayments,
      totalBs: totalAmountBs,
      totalUSD: totalAmountUSB,
    };
  }

  async getPaymentsMethod() {
    return await this.prismaService.paymentMethod.findMany();
  }
  async getTypeDescription() {
    return await this.prismaService.payment.groupBy({
      by: ['description'],
      where: {
        deleted: false,
        description: {
          not: '',
        },
      },
    });
  }

  getBanks() {
    return BankData;
  }

  async findOrSaveDolar(dolar: number) {
    const findDolar = await this.prismaService.historyDolar.findFirst({
      where: { dolar },
    });

    if (!findDolar) {
      const createDolar = await this.prismaService.historyDolar.create({
        data: {
          dolar: dolar,
        },
      });

      return createDolar;
    }

    return findDolar;
  }

  async registerPayment(payment: PaymentDTO) {
    try {
      const [accountZelle, getDolar] = await Promise.all([
        this.prismaService.accountsPayments.findFirst({
          where: { id: payment.accountId },
          include: { method: true },
        }),
        payment.dolar
          ? this.findOrSaveDolar(payment.dolar)
          : this.productService.getDolar(),
      ]);

      await this.prismaService.payment.create({
        data: {
          amount: payment.amount,
          reference: payment.reference,
          dolarId: getDolar.id,
          description: payment.description,
          paymentDate: payment.paymentDate,
          status: isPendingConfirmationMethod(accountZelle.method.name)
            ? 'PENDING'
            : 'CONFIRMED',
          accountId: payment.accountId,
          type:
            payment.type ??
            (looksLikeLegacyExpenseAccount(accountZelle.name)
              ? 'EXPENSE'
              : 'INCOME'),
        },
      });

      return { message: 'Pago guardado correctamente', success: true };
    } catch (error: unknown) {
      return {
        message: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }

  async updatePayment(id: number, payment: PaymentDTO) {
    try {
      const [accountZelle, getDolar] = await Promise.all([
        this.prismaService.accountsPayments.findFirst({
          where: { id: payment.accountId },
          include: { method: true },
        }),
        payment.dolar
          ? this.findOrSaveDolar(payment.dolar)
          : this.productService.getDolar(),
      ]);

      await this.prismaService.payment.update({
        data: {
          amount: payment.amount,
          reference: payment.reference,
          dolarId: getDolar.id,
          description: payment.description,
          paymentDate: payment.paymentDate,
          status: isPendingConfirmationMethod(accountZelle.method.name)
            ? 'PENDING'
            : 'CONFIRMED',
          accountId: payment.accountId,
          ...(payment.type
            ? { type: payment.type }
            : looksLikeLegacyExpenseAccount(accountZelle.name)
              ? { type: 'EXPENSE' }
              : {}),
        },
        where: { id },
      });

      return { message: 'Pago actualizado correctamente', success: true };
    } catch (error: unknown) {
      return {
        message: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }

  async updatePaymentZelle(id: number) {
    try {
      await this.prismaService.payment.update({
        data: { status: 'CONFIRMED' },
        where: { id },
      });

      return { message: 'Pago actualizado correctamente', success: true };
    } catch (error: unknown) {
      return {
        message: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }

  async payInvoice(pay: PayInvoiceDTO) {
    try {
      /**
       * `amount` llega en USD (ver `PayInvoiceDetailsDTO`). Se redondea a 2
       * decimales aqui para que la comparacion contra los saldos no dependa
       * de error de coma flotante de JavaScript.
       */
      const details = pay.details.map((detail) => ({
        invoiceId: detail.invoiceId,
        amount: round2(detail.amount),
      }));

      const seenInvoiceIds = new Set<number>();
      for (const detail of details) {
        if (seenInvoiceIds.has(detail.invoiceId)) {
          return createBadResponse(
            `La factura ${detail.invoiceId} aparece mas de una vez en la misma solicitud.`,
          );
        }
        seenInvoiceIds.add(detail.invoiceId);
      }

      const totalInvoices = round2(
        details.reduce((acc, item) => acc + item.amount, 0),
      );

      const findPayment = await this.prismaService.payment.findFirst({
        where: { id: pay.paymentId, deleted: false },
        include: {
          account: { include: { method: true } },
          dolar: true,
          InvoicePayment: {
            select: { amount: true },
          },
        },
      });

      if (!findPayment) {
        return createBadResponse('Pago no encontrado.');
      }

      if (findPayment.type === 'SUPPLIER') {
        return createBadResponse(
          'Este pago es de un Proveedor y no puede ser asociado a facturas.',
        );
      }

      if (findPayment.type === 'PERSONAL_EXPENSES') {
        return createBadResponse(
          'Este pago es de un Gastos personal y no puede ser asociado a facturas.',
        );
      }

      const paymentBalance = calculatePaymentRemaining(
        findPayment.amount,
        findPayment.account.method.currency,
        findPayment.dolar.dolar,
        findPayment.InvoicePayment,
      );

      if (totalInvoices > paymentBalance.remainingUSD) {
        return createBadResponse(
          'La cantidad a pagar excede la cantidad del pago.',
        );
      }

      let paymentUpdated;
      const paidInvoices: {
        id: number;
        clientId: number;
        controlNumber: string;
        totalAmount: number;
      }[] = [];

      // Usar transacción Prisma para atomicidad
      await this.prismaService.$transaction(async (prisma) => {
        /**
         * Orden de locks: Invoice -> Payment. `payDisassociate` usa el mismo
         * orden; cambiarlo en uno solo abre la posibilidad de deadlock.
         *
         * Sobre las facturas: esto NO impide que una factura reciba varios
         * pagos. El lock se libera al confirmar la transaccion, asi que
         * solicitudes sucesivas con pagos distintos se asocian sin problema (lo
         * unico que prohibits es repetir la misma pareja factura/pago, via
         * `@@unique([invoiceId, paymentId])` y el chequeo de `invoiceId`
         * repetido de esta misma peticion).
         *
         * Lo que si evita es la carrera: dos `payInvoice` concurrentes sobre la
         * misma factura leian el mismo saldo y ambas asignaban su monto,
         * dejando la factura pagada por mas de lo que vale. `FOR UPDATE`
         * serializa el acceso, el segundo espera al primero y vuelve a leer el
         * saldo ya actualizado.
         */
        await prisma.$queryRaw(
          Prisma.sql`SELECT id FROM "Invoice" WHERE id IN (${Prisma.join(
            details.map((d) => d.invoiceId),
          )}) FOR UPDATE`,
        );

        /**
         * El mismo problema del lado del pago: el saldo se calculaba FUERA de
         * la transaccion (arriba), asi que dos asociaciones simultaneas del
         * mismo pago a facturas distintas pasaban ambas la validacion y el
         * pago quedaba sobreasignado. Se bloquea la fila del pago y se
         * recalcula el disponible con las asignaciones ya confirmadas.
         *
         * El lock de facturas de arriba no cubre este caso, porque dos facturas
         * distintas son filas distintas y no se bloquean entre si.
         */
        await prisma.$queryRaw(
          Prisma.sql`SELECT id FROM "Payment" WHERE id = ${findPayment.id} FOR UPDATE`,
        );

        const lockedAllocations = await prisma.invoicePayment.findMany({
          where: { paymentId: findPayment.id },
          select: { amount: true },
        });

        const lockedBalance = calculatePaymentRemaining(
          findPayment.amount,
          findPayment.account.method.currency,
          findPayment.dolar.dolar,
          lockedAllocations,
        );

        if (totalInvoices > lockedBalance.remainingUSD) {
          throw new Error(
            'La cantidad a pagar excede la cantidad disponible del pago.',
          );
        }

        for (const payDetail of details) {
          const findInvoice = await prisma.invoice.findFirst({
            where: { id: payDetail.invoiceId },
            include: {
              invoiceItems: true,
              InvoicePayment: {
                select: { amount: true },
              },
            },
          });

          if (!findInvoice) {
            throw new Error(
              `Factura con ID ${payDetail.invoiceId} no encontrada.`,
            );
          }

          if (findInvoice.deleted) {
            throw new Error(
              `La factura #${findInvoice.controlNumber} esta eliminada y no admite pagos.`,
            );
          }

          const currentInvoiceRemaining = calculateInvoiceRemainingUsd(
            findInvoice.totalAmount,
            findInvoice.InvoicePayment,
          );

          if (
            findInvoice.status === 'Pagado' ||
            isInvoiceSettled(currentInvoiceRemaining)
          ) {
            throw new Error(
              `La factura #${findInvoice.controlNumber} ya está pagada.`,
            );
          }

          if (payDetail.amount > currentInvoiceRemaining) {
            throw new Error(
              `El monto excede el saldo pendiente de la factura #${findInvoice.controlNumber}.`,
            );
          }

          // Crear el registro de pago
          await prisma.invoicePayment.create({
            data: {
              invoiceId: findInvoice.id,
              paymentId: findPayment.id,
              amount: payDetail.amount,
            },
          });

          const invoicePaymentsAfter = await prisma.invoicePayment.findMany({
            where: { invoiceId: findInvoice.id },
            select: { amount: true },
          });

          const remainingAfter = calculateInvoiceRemainingUsd(
            findInvoice.totalAmount,
            invoicePaymentsAfter,
          );

          // Regla de negocio centralizada: tolerancia configurable
          // (PAYMENT_TOLERANCE_USD, default 2). Antes la misma comparacion
          // `remainingAfter <= 2` vivia duplicada en dos servicios.
          const statusInvoice: InvoiceStatus = isInvoiceSettled(remainingAfter)
            ? 'Pagado'
            : 'Pendiente';

          await prisma.invoice.update({
            where: { id: findInvoice.id },
            data: {
              status: statusInvoice,
            },
          });

          if (statusInvoice === 'Pagado') {
            const findClientReminder = await prisma.clientReminder.findFirst({
              where: { clientId: findInvoice.clientId },
            });
            if (findClientReminder) {
              await prisma.clientReminder.delete({
                where: { id: findClientReminder.id },
              });
            }
            paidInvoices.push({
              id: findInvoice.id,
              clientId: findInvoice.clientId,
              controlNumber: findInvoice.controlNumber,
              totalAmount: Number(findInvoice.totalAmount),
            });
          }
        }

        paymentUpdated = await prisma.payment.findUnique({
          where: { id: findPayment.id },
          select: {
            id: true,
            amount: true,
            reference: true,
            description: true,
            paymentDate: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            accountId: true,
            dolar: {
              select: {
                id: true,
                dolar: true,
                date: true,
              },
            },
            account: {
              select: {
                id: true,
                name: true,
                bank: true,
                method: {
                  select: {
                    id: true,
                    name: true,
                    currency: true,
                  },
                },
              },
            },
            InvoicePayment: {
              select: {
                id: true,
                invoiceId: true,
                paymentId: true,
                amount: true,
                createdAt: true,
                invoice: {
                  select: {
                    id: true,
                    controlNumber: true,
                    dispatchDate: true,
                    dueDate: true,
                    totalAmount: true,
                    consignment: true,
                    status: true,
                    deleted: true,
                    InvoicePayment: {
                      select: { amount: true },
                    },
                    client: {
                      select: {
                        id: true,
                        name: true,
                        rif: true,
                        block: {
                          select: {
                            id: true,
                            name: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
      });

      for (const invoice of paidInvoices) {
        this.invoicesService.notifyInvoiceCreated(
          invoice.id,
          invoice.clientId,
          invoice.controlNumber,
          invoice.totalAmount,
        );
      }

      const paymentUpdatedParse = paymentUpdated
        ? {
            ...paymentUpdated,
            remaining: calculatePaymentRemaining(
              paymentUpdated.amount,
              paymentUpdated.account.method.currency,
              paymentUpdated.dolar.dolar,
              paymentUpdated.InvoicePayment,
            ).remainingOriginal.toFixed(2),
            remainingUSD: calculatePaymentRemaining(
              paymentUpdated.amount,
              paymentUpdated.account.method.currency,
              paymentUpdated.dolar.dolar,
              paymentUpdated.InvoicePayment,
            ).remainingUSD.toFixed(2),
            InvoicePayment: paymentUpdated.InvoicePayment.map((item) => ({
              ...item,
              invoice: {
                ...item.invoice,
                remaining: calculateInvoiceRemainingUsd(
                  item.invoice.totalAmount,
                  item.invoice.InvoicePayment,
                ).toFixed(2),
              },
            })),
          }
        : null;

      baseResponse.message = 'Pago asociado a factura exitosamente.';
      baseResponse.data = paymentUpdatedParse;
      return baseResponse;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      badResponse.message = errMsg;
      return badResponse;
    }
  }

  async payDisassociate(pay: PayDisassociateDTO) {
    try {
      await this.prismaService.$transaction(async (tx) => {
        /**
         * `invoiceId` y `paymentId` se leen de la asociacion, no del DTO. El
         * DTO los manda el cliente y no se verificaban contra la fila, asi que
         * un `invoiceId` equivocado reparaba el status de la factura que
         * mandaba el cliente y dejaba la realmente afectada con el viejo.
         */
        const association = await tx.invoicePayment.findFirst({
          where: { id: pay.id },
          select: { invoiceId: true, paymentId: true },
        });

        if (!association) {
          throw new Error(
            `No se encontró la asociación de pago con ID ${pay.id}`,
          );
        }

        /**
         * Mismo orden que `payInvoice` (Invoice -> Payment) para que un
         * desasociar concurrente con un asociar no se deadlockeen.
         */
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Invoice" WHERE id = ${association.invoiceId} FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Payment" WHERE id = ${association.paymentId} FOR UPDATE`,
        );

        await tx.invoicePayment.delete({ where: { id: pay.id } });

        const invoice = await tx.invoice.findUnique({
          where: { id: association.invoiceId },
          include: { InvoicePayment: { select: { amount: true } } },
        });

        if (invoice) {
          const remaining = calculateInvoiceRemainingUsd(
            invoice.totalAmount,
            invoice.InvoicePayment,
          );

          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              status: isInvoiceSettled(remaining) ? 'Pagado' : 'Pendiente',
            },
          });
        }
      });

      return {
        message: 'Pago Desasociado de factura exitosamente.',
        success: true,
      };
    } catch (err: unknown) {
      return {
        message: err instanceof Error ? err.message : String(err),
        success: false,
      };
    }
  }

  async deletePayment(id: number) {
    try {
      const findPaymentAssociate =
        await this.prismaService.invoicePayment.findMany({
          where: { paymentId: id },
        });

      if (findPaymentAssociate.length > 0) {
        const invoiceIds = [
          ...new Set(findPaymentAssociate.map((item) => item.invoiceId)),
        ];

        const invoicesWithPayments = await this.prismaService.invoice.findMany({
          where: { id: { in: invoiceIds } },
          include: { InvoicePayment: { select: { amount: true } } },
        });

        const invoiceUpdates = invoicesWithPayments.map((invoice) => {
          const remaining = calculateInvoiceRemainingUsd(
            invoice.totalAmount,
            invoice.InvoicePayment,
          );
          return {
            id: invoice.id,
            status: (remaining <= 2 ? 'Pagado' : 'Pendiente') as InvoiceStatus,
          };
        });

        await this.prismaService.$transaction(async (tx) => {
          await tx.invoicePayment.deleteMany({ where: { paymentId: id } });

          for (const update of invoiceUpdates) {
            await tx.invoice.update({
              where: { id: update.id },
              data: { status: update.status },
            });
          }
        });
      }

      await this.prismaService.payment.update({
        where: { id },
        data: { deleted: true },
      });
      return { message: 'Pago eliminado exitosamente', success: true };
    } catch (err: unknown) {
      return {
        message: err instanceof Error ? err.message : String(err),
        success: false,
      };
    }
  }

  async deleteAccountsPayments(id: number) {
    try {
      await this.prismaService.accountsPayments.delete({
        where: { id },
      });
      baseResponse.message = 'Cuenta eliminada exitosamente';
      return baseResponse;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      badResponse.message = errMsg;
      return badResponse;
    }
  }

  async validateAssociatedPaymentsInvoices() {
    try {
      let invoicesAffected = 0;
      const messages: string[] = [];

      const allInvoices = await this.prismaService.invoice.findMany({
        include: { InvoicePayment: true },
        where: {
          status: { notIn: ['Pagado', 'Cancelada', 'Creada'] },
        },
      });

      const toUpdate: { id: number; status: InvoiceStatus }[] = [];

      for (const invoice of allInvoices) {
        const totalPaid = invoice.InvoicePayment.reduce(
          (sum, payment) => sum + Number(payment.amount),
          0,
        );
        const remaining = Number(invoice.totalAmount) - totalPaid;

        if (remaining < 0) {
          messages.push(
            `Factura #${invoice.controlNumber} tiene un saldo negativo: ${remaining}`,
          );
          continue;
        }

        const newStatus = (
          remaining === 0 ? 'Pagado' : 'Pendiente'
        ) as InvoiceStatus;
        if (invoice.status !== newStatus) {
          toUpdate.push({ id: invoice.id, status: newStatus });
          invoicesAffected++;
        }
      }

      if (toUpdate.length > 0) {
        await this.prismaService.$transaction(
          toUpdate.map((u) =>
            this.prismaService.invoice.update({
              where: { id: u.id },
              data: { status: u.status },
            }),
          ),
        );
      }

      return {
        message: `Se actualizaron ${invoicesAffected} facturas.`,
        success: true,
      };
    } catch {
      throw new Error('No se pudo completar la validación de facturas');
    }
  }
}
