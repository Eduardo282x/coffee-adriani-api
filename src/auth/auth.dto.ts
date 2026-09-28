import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { DTOBaseResponse } from 'src/dto/base.dto';

export class DTOLogin {
  @IsString()
  @MinLength(1)
  username: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class DTOLoginResponse extends DTOBaseResponse {
  /** Se mantiene por compatibilidad con el frontend actual. */
  token: string;
  accessToken: string;
  refreshToken: string;
  /** Segundos de vida del access token. */
  expiresIn: number;
}

export class DTORefreshToken {
  @IsString()
  @IsNotEmpty({ message: 'El refresh token es obligatorio' })
  refreshToken: string;
}

export class DTORecover {
  @IsString()
  @MinLength(1)
  username: string;

  /** Nueva contraseña a establecer. */
  @IsString()
  @MinLength(8, {
    message: 'La nueva contraseña debe tener al menos 8 caracteres',
  })
  password: string;

  /** Contraseña actual: demuestra que quien llama está autenticado. */
  @IsString()
  @IsNotEmpty({
    message: 'Debe enviar su contraseña actual para confirmar la operación',
  })
  currentPassword: string;
}
