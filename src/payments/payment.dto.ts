import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  IsString,
  ValidateNested,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { AccountType } from 'src/generated/prisma/enums';

export class PaymentDTO {
  @IsString()
  reference: string;
  @IsString()
  @IsOptional()
  description?: string;
  @IsNumber()
  @IsPositive()
  amount: number;
  @IsNumber()
  @IsOptional()
  dolar: number;
  @IsNumber()
  accountId: number;
  @IsDate()
  @Transform(({ value }) => new Date(value))
  paymentDate: Date;
  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;
}

export class PayInvoiceDTO {
  @IsNumber()
  paymentId: number;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayInvoiceDetailsDTO)
  details: PayInvoiceDetailsDTO[];
}

export class PayInvoiceDetailsDTO {
  @IsNumber()
  @IsNotEmpty({ message: 'La numero de factura debe ser numero' })
  invoiceId: number;

  /**
   * Monto asignado a esta factura, **siempre en USD**, sin importar la moneda
   * del metodo de pago del pago padre.
   *
   * `InvoicePayment.amount` se consume como USD en
   * `src/common/remaining-calculator.ts`. Si el cliente enviara el monto en
   * Bs, una factura de $1000 quedaria marcada como Pagada al asignarle 1000
   * Bs (~ $100). El borde de la API es el unico lugar donde se conoce la tasa,
   * por eso el contrato se valida aqui y no se infiere despues.
   */
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El monto debe tener como maximo 2 decimales' },
  )
  @Min(0.01, { message: 'El monto asignado debe ser mayor que 0' })
  @Max(9_999_999.99, {
    message: 'El monto asignado excede el maximo permitido',
  })
  @IsNotEmpty({ message: 'La cantidad debe ser numero' })
  amount: number;
}

export class PayDisassociateDTO {
  @IsNumber()
  paymentId: number;
  @IsNumber()
  invoiceId: number;
  @IsNumber()
  id: number;
}

export class AccountsDTO {
  @IsString()
  name: string;
  @IsString()
  bank: string;
  @IsNumber()
  methodId: number;
}
