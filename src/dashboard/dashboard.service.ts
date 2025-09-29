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

  async generateInventoryAndInvoicesExcel(filter: DTODateRangeFilter): Promise<Buffer> {
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
        dispatchDate: {
          gte: filter.startDate,
          lte: filter.endDate
        }
      },
      include: {
        client: { include: { block: true } },
        invoiceItems: { include: { product: true } },
        InvoicePayment: {
          include: {
            payment: {
              include: {
                account: true,
                dolar: true
              }
            }
          }
        }
      },
      orderBy: { dispatchDate: 'asc' }
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
    header.push('Total Despachado');
    header.push('Inventario Actual');
    wsInv.addRow(header);

    // Calcular inventario inicial (antes del rango) - esto se mantiene igual
    const inventarioInicial = {};
    for (const p of productos) {
      // Sumar movimientos antes del rango para obtener inventario inicial
      const movsAntes = await this.prismaService.historyInventory.aggregate({
        where: {
          productId: p.id,
          movementDate: { lt: filter.startDate }
        },
        _sum: { quantity: true }
      });
      inventarioInicial[p.id] = (p.amount || 0) + (movsAntes._sum.quantity || 0);
    }

    // Agrupar facturas por día y producto
    const despachosPorDiaYProducto = {};

    // Inicializar estructura de datos
    dias.forEach(dia => {
      const fechaKey = format(dia, 'yyyy-MM-dd');
      despachosPorDiaYProducto[fechaKey] = {};
      productos.forEach(producto => {
        despachosPorDiaYProducto[fechaKey][producto.id] = 0;
      });
    });

    // Procesar facturas y agrupar por día y producto
    facturas.forEach(factura => {
      const fechaDespacho = format(factura.dispatchDate, 'yyyy-MM-dd');

      // Solo procesar si la fecha está en nuestro rango
      if (despachosPorDiaYProducto[fechaDespacho]) {
        factura.invoiceItems.forEach(item => {
          if (despachosPorDiaYProducto[fechaDespacho][item.productId] !== undefined) {
            despachosPorDiaYProducto[fechaDespacho][item.productId] += item.quantity;
          }
        });
      }
    });

    // Para cada producto, calcular inventario y despachos por día
    for (const p of productos) {
      let fila = [`${p.name} ${p.presentation}`, inventarioInicial[p.id]];
      let inventarioActual = inventarioInicial[p.id];
      let totalDespachado = 0;

      for (const dia of dias) {
        const fechaKey = format(dia, 'yyyy-MM-dd');
        const cantidadDespachada = despachosPorDiaYProducto[fechaKey][p.id] || 0;

        fila.push(cantidadDespachada);
        inventarioActual -= cantidadDespachada;
        totalDespachado += cantidadDespachada;
      }

      fila.push(totalDespachado); // Total despachado
      fila.push(inventarioActual); // Inventario actual
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





    //Pagos

    // 3. Obtener todos los pagos en el rango de fechas (adicional para pagos no asociados a facturas del período)
    const pagosEnRango = await this.prismaService.payment.findMany({
      where: {
        paymentDate: {
          gte: filter.startDate,
          lte: filter.endDate
        }
      },
      include: {
        account: { include: { method: true } },
        dolar: true,
        InvoicePayment: {
          include: {
            invoice: {
              include: {
                invoiceItems: {
                  include: { product: true }
                }
              }
            }
          }
        }
      },
      orderBy: { paymentDate: 'asc' }
    });

    // --- NUEVA HOJA PAGOS ---
    const wsPagos = workbook.addWorksheet('Análisis de Pagos');

    // Cabecera principal de pagos
    const headerPagos = [
      'Fecha Pago', 'Referencia', 'Cuenta', 'Metodo', 'Monto ($)', 'Tasa Dólar', 'Monto (Bs)',
      'Estado', 'Descripción', 'Factura Asociada', 'Total Factura ($)',
      'Cantidad Total Items', 'Monto Asignado ($)', 'Equivalente en Items', 'Porcentaje Pagado'
    ];
    wsPagos.addRow(headerPagos);

    // Variables para totales
    let totalPagado = 0;
    let totalItemsPagados = 0;
    let totalFacturasAfectadas = new Set();

    // Procesar cada pago
    for (const pago of pagosEnRango) {
      const montoPagoUSD = parseFloat(pago.amount.toString());
      const montoPagoBS = montoPagoUSD * parseFloat(pago.dolar.dolar.toString());

      totalPagado += montoPagoUSD;

      if (pago.InvoicePayment.length === 0) {
        // Pago sin factura asociada
        wsPagos.addRow([
          format(pago.paymentDate, 'dd/MM/yyyy'),
          pago.reference,
          pago.account.name,
          pago.account.method.name,
          montoPagoUSD.toFixed(2),
          parseFloat(pago.dolar.dolar.toString()).toFixed(2),
          montoPagoBS.toFixed(2),
          pago.status,
          pago.description,
          'Sin factura asociada',
          '-',
          '-',
          '-',
          '-',
          '-'
        ]);
      } else {
        // Pago con facturas asociadas
        for (const invoicePayment of pago.InvoicePayment) {
          const factura = invoicePayment.invoice;
          const montoAsignado = parseFloat(invoicePayment.amount.toString());
          const totalFactura = parseFloat(factura.totalAmount.toString());

          // Calcular cantidad total de items en la factura
          const cantidadTotalItems = factura.invoiceItems.reduce((sum, item) => sum + item.quantity, 0);

          // Calcular equivalente en items basado en el pago
          const porcentajePagado = montoAsignado / totalFactura;
          const equivalenteItems = cantidadTotalItems * porcentajePagado;

          totalItemsPagados += equivalenteItems;
          totalFacturasAfectadas.add(factura.id);

          wsPagos.addRow([
            format(pago.paymentDate, 'dd/MM/yyyy'),
            pago.reference,
            pago.account.name,
            montoPagoUSD.toFixed(2),
            parseFloat(pago.dolar.dolar.toString()).toFixed(2),
            montoPagoBS.toFixed(2),
            pago.status,
            pago.description,
            `#${factura.controlNumber}`,
            totalFactura.toFixed(2),
            cantidadTotalItems,
            montoAsignado.toFixed(2),
            equivalenteItems.toFixed(2),
            `${(porcentajePagado * 100).toFixed(1)}%`
          ]);
        }
      }
    }

    // Agregar filas de totales
    wsPagos.addRow([]); // Fila vacía
    wsPagos.addRow(['=== RESUMEN GENERAL ===']);
    wsPagos.addRow(['Total Pagado ($):', totalPagado.toFixed(2)]);
    wsPagos.addRow(['Total Items Equivalentes:', totalItemsPagados.toFixed(2)]);
    wsPagos.addRow(['Facturas Afectadas:', totalFacturasAfectadas.size]);

    // --- HOJA RESUMEN POR PRODUCTO PAGADO ---
    const wsResumenProductos = workbook.addWorksheet('Productos Pagados');

    // Cabecera
    const headerProductos = ['Producto', 'Cantidad Pagada', 'Precio Promedio ($)', 'Monto Total Pagado ($)'];
    wsResumenProductos.addRow(headerProductos);

    // Calcular resumen por producto
    type ProductoResumen = {
      cantidadPagada: number;
      montoTotalPagado: number;
      precioPromedio: number;
    };
    const productosResumen: Record<string, ProductoResumen> = {};

    for (const pago of pagosEnRango) {
      for (const invoicePayment of pago.InvoicePayment) {
        const factura = invoicePayment.invoice;
        const montoAsignado = parseFloat(invoicePayment.amount.toString());
        const totalFactura = parseFloat(factura.totalAmount.toString());
        const porcentajePagado = montoAsignado / totalFactura;

        for (const item of factura.invoiceItems) {
          const productoKey = `${item.product.name} ${item.product.presentation}`;
          const cantidadPagada = item.quantity * porcentajePagado;
          const montoPagadoProducto = parseFloat(item.unitPrice.toString()) * cantidadPagada;

          if (!productosResumen[productoKey]) {
            productosResumen[productoKey] = {
              cantidadPagada: 0,
              montoTotalPagado: 0,
              precioPromedio: parseFloat(item.unitPrice.toString())
            };
          }

          productosResumen[productoKey].cantidadPagada += cantidadPagada;
          productosResumen[productoKey].montoTotalPagado += montoPagadoProducto;
          // Recalcular precio promedio
          productosResumen[productoKey].precioPromedio =
            productosResumen[productoKey].montoTotalPagado / productosResumen[productoKey].cantidadPagada;
        }
      }
    }

    // Agregar filas de productos
    let totalGeneralProductos = 0;
    for (const [nombreProducto, datos] of Object.entries(productosResumen)) {
      wsResumenProductos.addRow([
        nombreProducto,
        datos.cantidadPagada.toFixed(2),
        datos.precioPromedio.toFixed(2),
        datos.montoTotalPagado.toFixed(2)
      ]);
      totalGeneralProductos += datos.montoTotalPagado;
    }

    // Fila de total
    wsResumenProductos.addRow([]);
    wsResumenProductos.addRow(['TOTAL GENERAL', '', '', totalGeneralProductos.toFixed(2)]);

    // Aplicar estilos a las hojas
    [wsPagos, wsResumenProductos].forEach(ws => {
      // Aplicar estilos a la primera fila (cabeceras)
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4472C4' } };
      headerRow.alignment = { horizontal: 'center' };

      // Ajustar ancho de columnas
      ws.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = Math.min(Math.max(maxLength + 2, 10), 50);
      });
    });

    // 5. Exportar a buffer
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer;
  }

  async getClientsDemandReport(filter: DTODateRangeFilter) {
    // Obtener facturas en el rango con items y cliente
    const invoices = await this.prismaService.invoice.findMany({
      where: {
        dispatchDate: {
          gte: filter.startDate,
          lte: filter.endDate
        }
      },
      include: {
        client: true,
        invoiceItems: true
      }
    });

    // Agregar por cliente: cantidad de facturas, total items (bultos) y total monto
    const map = new Map<number, {
      clientId: number;
      clientName: string;
      invoicesCount: number;
      totalItems: number;
      totalAmount: number;
    }>();

    for (const inv of invoices) {
      const clientId = inv.clientId;
      const itemsCount = inv.invoiceItems.reduce((s, it) => s + Number(it.quantity), 0);
      const totalAmount = Number(inv.totalAmount || 0);

      if (!map.has(clientId)) {
        map.set(clientId, {
          clientId,
          clientName: inv.client?.name || 'Sin nombre',
          invoicesCount: 1,
          totalItems: itemsCount,
          totalAmount
        });
      } else {
        const entry = map.get(clientId)!;
        entry.invoicesCount += 1;
        entry.totalItems += itemsCount;
        entry.totalAmount += totalAmount;
      }
    }

    // Convertir a array y ordenar por totalItems descendente
    const clientsArray = Array.from(map.values()).sort((a, b) => b.totalItems - a.totalItems);

    // Top N (ej. 20)
    const topClients = clientsArray.slice(0, 20);

    // Crear buckets: 0-20, 21-100, 101+
    const buckets = {
      '0-20': [] as typeof clientsArray,
      '21-100': [] as typeof clientsArray,
      '101+': [] as typeof clientsArray
    };

    for (const c of clientsArray) {
      if (c.totalItems <= 20) buckets['0-20'].push(c);
      else if (c.totalItems <= 100) buckets['21-100'].push(c);
      else buckets['101+'].push(c);
    }

    return {
      topClients,
      buckets,
      totalClientsConsidered: clientsArray.length
    };
  }
}
