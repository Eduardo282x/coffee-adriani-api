import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { InvoiceStatus } from 'src/generated/prisma/enums';

export class DTOClients {
  @IsString()
  name: string;
  @IsString()
  rif: string;
  @IsString()
  address: string;
  @IsString()
  @IsOptional()
  addressSecondary: string;
  @IsOptional()
  @IsString()
  // @IsPhoneNumber('VE')
  phone: string;
  @IsString()
  zone: string;
  @IsNumber()
  blockId: number;
}

export class DTOBlocks {
  @IsString()
  name: string;
  @IsString()
  address: string;
}

export type StatusPay = 'clean' | 'pending' | 'all';

export type ReportOrderBy =
  | 'name'
  | 'address'
  | 'block'
  | 'debt'
  | 'totalPaid'
  | 'totalInvoices'
  | 'dispatchDate';

export type ReportOrderDirection = 'asc' | 'desc';

export class DTOReportClients {
  @IsString()
  type: string;
  @IsString()
  @IsOptional()
  zone: string;
  @IsNumber()
  @IsOptional()
  blockId: number;
  @IsString()
  @IsNotEmpty({ message: 'El estatus es requerido' })
  @Type(() => String)
  status: StatusPay;
  @IsString()
  @IsOptional()
  orderBy: ReportOrderBy;
  @IsString()
  @IsOptional()
  orderDirection: ReportOrderDirection;
  @IsOptional()
  @IsArray()
  @IsEnum(InvoiceStatus, { each: true })
  invoiceStatuses?: InvoiceStatus[];
  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  @IsDate()
  endDate?: Date | string;
}
