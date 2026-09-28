import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class DTOUser {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de usuario es obligatorio' })
  username: string;
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  name: string;
  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  lastName: string;
  @IsNumber()
  rolId: number;
  /**
   * Obligatoria al crear. Opcional al actualizar (si viene vacia, la
   * contraseña no se toca). Antes el servicio hasheaba una constante "1234",
   * lo que dejaba a todas las cuentas nuevas con una credencial conocida.
   */
  @IsOptional()
  @IsString()
  @MinLength(8, {
    message: 'La contraseña debe tener al menos 8 caracteres',
  })
  password?: string;
}
