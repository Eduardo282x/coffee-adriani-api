import { Injectable } from '@nestjs/common';
import { DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';

import * as ExcelJS from 'exceljs';
import { format, eachDayOfInterval, addDays } from 'date-fns';
import { es } from 'date-fns/locale';

@Injectable()
export class DashboardService {

  constructor(private readonly prismaService: PrismaService) {

  }


  async getDashboardData(filter: DTODateRangeFilter) {
    // 1. Facturas por estado y porcentajes
    const [totalInvoices, payed, expired, pending] = await Promise.all([
      this.prismaService.invoice.count({
        where: {
          createdAt: { gte: filter.startDate, lte: filter.endDate }
        }
      }),
      this.prismaService.invoice.count({
        where: {
          status: 'Pagado',
          createdAt: { gte: filter.startDate, lte: filter.endDate }
        }
      }),
      this.prismaService.invoice.count({
        where: {
          status: 'Vencida',
          createdAt: { gte: filter.startDate, lte: filter.endDate }
        }
      }),
      this.prismaService.invoice.count({
        where: {
          status: 'Pendiente',
          createdAt: { gte: filter.startDate, lte: filter.endDate }
        }
      }),
    ]);

    const percent = (amount: number) =>
      totalInvoices === 0 ? 0 : Number(((amount / totalInvoices) * 100).toFixed(2));

    // 2. Porcentaje de cada producto en inventario
    const productos = await this.prismaService.product.findMany();
    const totalStock = productos.reduce((acc, p) => acc + p.amount, 0);
    const productsPercent = productos.map(p => ({
      id: p.id,
      name: `${p.name} ${p.presentation}`,
      amount: p.amount,
      percent: totalStock === 0 ? 0 : Number(((p.amount / totalStock) * 100).toFixed(2))
    }));

    // 3. Productos con bajo stock (<30%)
    const lowStock = productsPercent.filter(p => p.percent < 30);

    // 4. Últimas 20 facturas pendientes
    const lastPending = await this.prismaService.invoice.findMany({
      where: { status: 'Pendiente' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        client: true,
      }
    });

    return {
      invoices: {
        total: totalInvoices,
        payed: { amount: payed, percent: percent(payed) },
        expired: { amount: expired, percent: percent(expired) },
        pending: { amount: pending, percent: percent(pending) },
      },
      inventory: {
        products: productsPercent,
        lowStock
      },
      lastPending
    };
  }

  async generateInventoryAndInvoicesExcel(filter: DTODateRangeFilter) {
    // 1. Obtener productos y movimientos de inventario en el rango
    const productos = await this.prismaService.product.findMany();
    const movimientos = await this.prismaService.historyInventory.findMany({
      where: {
        movementDate: {
          gte: filter.startDate,
          lte: filter.endDate,
        },
      },
      include: { product: true },
      orderBy: { movementDate: 'asc' }
    });

    // 2. Obtener facturas en el rango
    const facturas = await this.prismaService.invoice.findMany({
      where: {
        createdAt: { gte: filter.startDate, lte: filter.endDate }
      },
      include: {
        client: { include: { block: true } },
        invoiceItems: { include: { product: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    // 3. Preparar fechas del rango
    const dias = eachDayOfInterval({ start: filter.startDate, end: filter.endDate });

    // 4. Crear workbook y hojas
    const workbook = new ExcelJS.Workbook();

    // --- HOJA INVENTARIO ---
    const wsInv = workbook.addWorksheet('Inventario');
    // Cabecera
    const header = ['Producto', 'Inventario Inicial'];
    dias.forEach(d => {
      header.push(`${format(d, "EEEE dd/MM/yyyy", { locale: es })}`);
    });
    wsInv.addRow(header);

    // Calcular inventario inicial (antes del rango)
    const inventarioInicial = {};
    for (const p of productos) {
      // Sumar movimientos antes del rango
      const movsAntes = await this.prismaService.historyInventory.aggregate({
        where: {
          productId: p.id,
          movementDate: { lt: filter.startDate }
        },
        _sum: { quantity: true }
      });
      inventarioInicial[p.id] = (p.amount || 0) + (movsAntes._sum.quantity || 0);
    }

    // Para cada producto, calcular inventario y despachos por día
    for (const p of productos) {
      let fila = [p.name, inventarioInicial[p.id]];
      let inventarioActual = inventarioInicial[p.id];
      for (const dia of dias) {
        // Movimientos de salida (despachos) ese día
        const movsDia = movimientos.filter(m =>
          m.productId === p.id &&
          format(m.movementDate, 'yyyy-MM-dd') === format(dia, 'yyyy-MM-dd') &&
          m.movementType === 'OUT'
        );
        const cantidadDespachada = movsDia.reduce((acc, m) => acc + m.quantity, 0);
        fila.push(cantidadDespachada);
        inventarioActual -= cantidadDespachada;
      }
      wsInv.addRow(fila);
    }

    // --- HOJA FACTURAS ---
    const wsFact = workbook.addWorksheet('Facturas');
    // Cabecera
    const prodHeaders = productos.map(p => `${p.name}`);
    wsFact.addRow([
      'Nro de control', 'Cliente', 'Bloque', 'Dirección zona', 'Fecha despacho',
      'Fecha vencimiento', 'Total', 'Debe', 'Estado', ...prodHeaders
    ]);

    for (const f of facturas) {
      // Mapeo de productos y precios en la factura
      const prodMap = {};
      f.invoiceItems.forEach(item => {
        prodMap[item.product.name] = item.unitPriceUSD ? Number(item.unitPriceUSD) : Number(item.unitPrice);
      });
      wsFact.addRow([
        f.controlNumber,
        f.client.name,
        f.client.block.name,
        f.client.zone,
        format(f.dispatchDate, 'dd/MM/yyyy'),
        format(f.dueDate, 'dd/MM/yyyy'),
        Number(f.totalAmount),
        Number(f.remaining),
        f.status,
        ...productos.map(p => prodMap[p.name] ?? '')
      ]);
    }

    // 5. Exportar a buffer
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer;
  }
}
