import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ITokenExp } from 'src/dto/token.interface';

@Injectable()
export class AuthGuard implements CanActivate {

  constructor(private jwtService: JwtService) { }

  canActivate(context: ExecutionContext): boolean {
    const request: Request = context.switchToHttp().getRequest();

    if (request.url === '/api/auth' || request.url === '/api/auth/recover' || request.url === '/api/mainload' ) return true;

    const authHeader = request.headers['authorization'];
    if (!authHeader) throw new UnauthorizedException('Token no enviado');
    const token = authHeader.replace('Bearer ', '');

    try {
      const payload: ITokenExp = this.jwtService.decode(token);
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        throw new UnauthorizedException('Token inválido o expirado');
      }
      request['user'] = payload;
      return true;
    } catch (err) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
