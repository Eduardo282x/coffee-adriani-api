import { parseAnyExcelDate } from 'src/excel/excel.controller';
import * as XLSX from 'xlsx';

// Función auxiliar para convertir serial Excel a fecha ISO
const excelDateToJSDate = (serial: number): string => {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (!parsed) return '';
    return new Date(parsed.y, parsed.m - 1, parsed.d + 1).toISOString(); // Puedes formatearla como necesites
};

export const parseExcelToJson = (fileBuffer: Buffer, indexFile: number) => {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[indexFile];
    const sheet = workbook.Sheets[sheetName];

    // Convertir a JSON sin perder las celdas vacías
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: null });

    // Mapear fechas manualmente (ajusta a tu estructura)
    const data = rawData.map((row: any) => {
        return {
            ...row,
            // Suponiendo que tus columnas se llaman 'fechaInicio' y 'fechaFin'
            dispatchDate: parseAnyExcelDate(row.dispatchDate),
            dueDate: parseAnyExcelDate(row.dueDate),
            date: parseAnyExcelDate(row.date),
        };
    });

    return data;
};
