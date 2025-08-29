import { Injectable } from '@nestjs/common';
import { Block, Client } from '@prisma/client';
import { badResponse, baseResponse, DTOBaseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOBlocks, DTOClients, DTOReportClients } from './client.dto';
import * as PDFDocument from 'pdfkit';
// import * as fs from 'fs';
import * as stream from 'stream';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ClientsService {

    constructor(private readonly prismaService: PrismaService) {

    }

    async getClients(): Promise<Client[]> {
        return await this.prismaService.client.findMany({
            where: { active: true },
            include: { block: true },
            orderBy: { id: 'asc' }
        })
    }

    async getClientExcel(): Promise<Buffer> {
        const clients = await this.prismaService.client.findMany({
            where: { active: true },
            include: { block: true },
            orderBy: { id: 'asc' }
        });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Clientes');

        // Cabecera
        worksheet.addRow([
            'ID',
            'Nombre',
            'RIF',
            'Dirección',
            'Dirección Secundaria',
            'Teléfono',
            'Zona',
            'Bloque',
            'Activo',
        ]);

        // Datos
        clients.forEach(cli => {
            worksheet.addRow([
                cli.id,
                cli.name,
                cli.rif,
                cli.address,
                cli.addressSecondary || '',
                cli.phone,
                cli.zone,
                cli.block ? cli.block.name : '',
                cli.active ? 'Sí' : 'No',
            ]);
        });

        // Ajustar ancho de columnas automáticamente
        worksheet.columns.forEach(column => {
            let maxLength = 10;
            column.eachCell({ includeEmpty: true }, cell => {
                maxLength = Math.max(maxLength, (cell.value ? cell.value.toString().length : 0));
            });
            column.width = maxLength + 2;
        });

        const arrayBuffer = await workbook.xlsx.writeBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return Buffer.from(buffer);
    }

    async formatNumberClients() {
        const clients = await this.getClients();
        const parseClients = clients.map(cli => {
            const parseNumber = cli.phone.slice(0, 1) === '0' ? cli.phone : `0${cli.phone}`
            return {
                ...cli,
                phone: parseNumber
            }
        })

        parseClients.map(async (cli) => {
            await this.updateClients(cli.id, cli)
        })

        return 'Clientes formateados'

    }

    async createBlocks(newBlock: DTOBlocks): Promise<DTOBaseResponse> {
        try {
            const findBlock = await this.prismaService.block.findFirst({
                where: { name: { equals: newBlock.name, mode: 'insensitive' } },
            })

            if (findBlock) {
                badResponse.message = 'Ya existe un bloque con este nombre';
                return badResponse;
            }

            await this.prismaService.block.create({
                data: {
                    name: newBlock.name,
                    address: newBlock.address,
                }
            })

            baseResponse.message = 'Bloque agregado correctamente.';
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ClientService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async updateBlocks(id: number, newBlock: DTOBlocks): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.block.update({
                where: { id },
                data: {
                    name: newBlock.name,
                    address: newBlock.address,
                }
            })

            baseResponse.message = 'Bloque actualizado correctamente.';
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ClientService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async deleteBlocks(id: number): Promise<DTOBaseResponse> {
        try {
            const findClientInBlocks = await this.prismaService.client.findFirst({
                where: { blockId: id }
            });

            if (findClientInBlocks) {
                badResponse.message = 'Existen clientes registrados en este bloque';
                return badResponse;
            }

            await this.prismaService.block.delete({
                where: { id }
            })

            baseResponse.message = 'Bloque eliminado correctamente.'
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ClientService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getBlocks(): Promise<Block[]> {
        return await this.prismaService.block.findMany({
            orderBy: { id: 'asc' }
        });
    }

    async createClients(newClient: DTOClients): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.client.create({
                data: {
                    name: newClient.name,
                    rif: newClient.rif,
                    address: newClient.address,
                    addressSecondary: newClient.addressSecondary,
                    phone: newClient.phone ? newClient.phone : '',
                    zone: newClient.zone,
                    blockId: newClient.blockId,
                    active: true
                }
            })

            baseResponse.message = 'Cliente agregado exitosamente.'
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ClientService' }
            })
            badResponse.message = err.message
            return badResponse;
        }
    }

    async updateClients(id: number, client: DTOClients): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.client.update({
                where: { id },
                data: {
                    name: client.name,
                    rif: client.rif,
                    address: client.address,
                    addressSecondary: client.addressSecondary,
                    phone: client.phone,
                    zone: client.zone,
                    blockId: client.blockId,
                }
            })

            baseResponse.message = 'Cliente actualizado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message
            return badResponse;
        }
    }

    async deleteClients(id: number): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.client.delete({
                where: { id }
            })

            baseResponse.message = 'Cliente eliminado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message
            return badResponse;
        }
    }

    async reportClients(client: DTOReportClients): Promise<Buffer | DTOBaseResponse> {
        try {
            const where: any = {};

            if (client.zone) {
                where.zone = { equals: client.zone, mode: 'insensitive' };
            }

            if (client.blockId && client.blockId != 0) {
                where.blockId = client.blockId;
            }

            const clientsReports = await this.prismaService.client.findMany({
                where,
                include: { block: true, invoices: { where: { status: { in: ['Creada', 'Pendiente', 'Vencida'] } } } },
                orderBy: { blockId: 'asc' }
            }).then(cli => {
                return cli.map(c => {
                    const totalInvoices = c.invoices.reduce((acc, invoice) => acc + Number(invoice.totalAmount), 0);
                    const totalPaid = c.invoices.reduce((acc, invoice) => acc + Number(invoice.remaining), 0);
                    const debt = totalInvoices - totalPaid;

                    return {
                        ...c,
                        totalInvoices,
                        totalPaid,
                        debt
                    }
                });
            }).then(cli => {
                if (client.status === 'clean') {
                    return cli.filter(c => c.totalInvoices == 0);
                }

                if (client.status === 'pending') {
                    return cli.filter(c => c.totalInvoices != 0);
                }

                return cli;
            });

            const filePDF = await new Promise(resolve => {
                const doc = new PDFDocument({ margin: 10, size: 'A4' });
                const buffer: Uint8Array[] = [];

                doc.on('data', buffer.push.bind(buffer));
                doc.on('end', () => resolve(Buffer.concat(buffer)));
                // doc.pipe(fs.createWriteStream('ReporteClientes.pdf'));
                doc.pipe(new stream.PassThrough());

                const columns = [
                    { header: 'Nombre', width: 100 },
                    { header: 'Dirección', width: 130 },
                    // { header: 'Rif', width: 60 },
                    { header: 'Teléfono', width: 60 },
                    // { header: 'Zona', width: 55 },
                    { header: 'Bloque', width: 45 },
                    { header: 'Facturas', width: 60 },
                    { header: 'Fecha despacho', width: 55 },
                    { header: 'Total', width: 45 },
                    { header: 'Pagado', width: 45 },
                    { header: 'Debe', width: 45 },
                ];

                const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
                const tableWidth = columns.reduce((sum, col) => sum + col.width, 0);
                const startX = doc.page.margins.left + (pageWidth - tableWidth) / 2;
                const rowHeight = 25;
                const maxY = doc.page.height - doc.page.margins.bottom - rowHeight;

                function drawCellBorder(x: number, y: number, width: number, height: number) {
                    doc.lineWidth(0.5).rect(x, y, width, height).stroke();
                }

                function drawHeaders(y: number) {
                    let x = startX;
                    doc.font('Helvetica-Bold').fontSize(8);
                    for (const col of columns) {
                        doc.text(col.header, x + 2, y + 5, { width: col.width, align: 'center' });
                        drawCellBorder(x, y, col.width, rowHeight);
                        x += col.width;
                    }
                }

                function drawRow(cli, y: number) {
                    let x = startX;
                    const row = [
                        cli.name,
                        cli.address,
                        // cli.rif,
                        cli.phone,
                        // cli.zone,
                        cli.block ? cli.block.name : 'N/A',
                        cli.invoices.length > 0 ? cli.invoices[0].controlNumber : '',
                        cli.invoices.length > 0 ? cli.invoices[0].dispatchDate.toLocaleString() : '',
                        `${formatNumberWithDots(cli.totalInvoices)} $`,
                        `${formatNumberWithDots(cli.debt)} $`,
                        `${formatNumberWithDots(cli.totalPaid)} $`
                    ];

                    doc.font('Helvetica').fontSize(8).fillColor('black');
                    for (let i = 0; i < columns.length; i++) {
                        doc.text(row[i], x + 2, y + 5, { width: columns[i].width, align: 'center' });
                        drawCellBorder(x, y, columns[i].width, rowHeight);
                        x += columns[i].width;
                    }
                }

                // Comienza el documento
                doc.font('Helvetica-Bold').fontSize(12).text('Lista de clientes', 10, 20, { align: 'left' });
                let startY = doc.y + 10;
                drawHeaders(startY);
                startY += rowHeight;

                for (const cli of clientsReports) {
                    if (startY + rowHeight > maxY) {
                        doc.addPage();
                        startY = 20;
                        drawHeaders(startY);
                        startY += rowHeight;
                    }
                    drawRow(cli, startY);
                    startY += rowHeight;
                }

                doc.end();
            });

            return filePDF as Buffer;

        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ClientService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }
}

export const formatNumberWithDots = (number: number | string): string => {
    const parsed = typeof number === 'string' ? parseFloat(number) : number;

    return new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(parsed);
};
