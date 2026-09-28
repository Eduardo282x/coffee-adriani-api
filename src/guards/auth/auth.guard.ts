import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator';
import type { AccessTokenPayload } from 'src/auth/refresh-token.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const token = this.extractToken(context);

    if (!token) throw new UnauthorizedException('Token no enviado');

    try {
      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = (await this.jwtService.verifyAsync(token, {
        secret,
      })) as AccessTokenPayload & { id?: number };

      // Un refresh token nunca puede usarse como credencial de acceso.
      if (payload.type && payload.type !== 'access') {
        throw new UnauthorizedException('Tipo de token invalido');
      }

      const user = {
        sub: payload.sub ?? payload.id,
        username: payload.username,
        name: payload.name,
        lastName: payload.lastName,
        rol: payload.rol,
      };

      this.attachUser(context, user);
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Token invalido o expirado');
    }
  }

  private extractToken(context: ExecutionContext): string | undefined {
    if (context.getType() === 'ws') {
      const client = context.switchToWs().getClient<Record<string, unknown>>();
      const handshake = client.handshake as
        | { auth?: Record<string, string>; headers?: Record<string, string> }
        | undefined;

      const fromAuth = handshake?.auth?.token;
      const fromQuery = (client.query as Record<string, string> | undefined)
        ?.token;
      const header = handshake?.headers?.authorization;

      return fromAuth || fromQuery || header?.replace('Bearer ', '');
    }

    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const authHeader = request.headers?.['authorization'] as string | undefined;

    if (!authHeader) return undefined;
    return authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : authHeader;
  }

  private attachUser(context: ExecutionContext, user: unknown): void {
    if (context.getType() === 'ws') {
      context.switchToWs().getClient<Record<string, unknown>>().user = user;
      return;
    }
    context.switchToHttp().getRequest<Record<string, unknown>>()['user'] = user;
  }
}
