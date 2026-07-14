import * as XLSX from 'xlsx';

// Función auxiliar para convertir serial Excel a fecha ISO
const excelDateToJSDate = (serial: number): string => {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (!parsed) return '';
    return new Date(parsed.y, parsed.m - 1, parsed.d + 1).toISOString(); // Puedes formatearla como necesites
};