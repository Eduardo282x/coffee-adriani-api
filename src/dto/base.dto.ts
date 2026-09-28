import { Transform } from 'class-transformer';
import { IsDate, IsOptional, IsString } from 'class-validator';

export class DTOBaseResponse {
  message: string;
  success: boolean;
  data?: any;
}

/**
 * Factories de respuesta.
 *
 * Antes `baseResponse` y `badResponse` eran objetos de modulo mutables: cada
 * request hacia `badResponse.message = ...` sobre el MISMO objeto, asi que una
 * peticion concurrente podia devolver el mensaje (o el `data`) de otra
 * peticion. Usar estas factories elimina esa fuga.
 */
export function createBaseResponse(
  data: any = null,
  message = '',
): DTOBaseResponse {
  return { message, success: true, data };
}

export function createBadResponse(
  message = '',
  data: any = null,
): DTOBaseResponse {
  return { message, success: false, data };
}

/**
 * @deprecated Fuente de fuga de datos entre requests. Usar
 * `createBaseResponse` / `createBadResponse`. Se conserva solo para los modulos
 * que aun no fueron migrados.
 */
export const baseResponse: DTOBaseResponse = createBaseResponse();

/**
 * @deprecated Fuente de fuga de datos entre requests. Usar
 * `createBadResponse`.
 */
export const badResponse: DTOBaseResponse = createBadResponse();

export class DTODateRangeFilter {
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => new Date(value))
  startDate: Date | string;
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => new Date(value))
  endDate: Date | string;
}

export class DashboardExcel extends DTODateRangeFilter {
  @IsString()
  type: string;
}
