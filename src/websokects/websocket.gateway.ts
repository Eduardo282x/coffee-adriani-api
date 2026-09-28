import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { resolveCorsOrigins } from 'src/config/env.validation';

/**
 * El gateway cuelga de `/ws`, deliberadamente FUERA del prefijo global
 * `api`: el handshake no es una peticion HTTP de la API y Dokploy debe
 * enrutarlo por separado (regla `/ws` -> backend, sin el prefijo `/api`).
 *
 * La lista de `cors` de aqui es solo un default seguro para cuando se levanta
 * el gateway sin el adapter. `main.ts` instala `CorsIoAdapter`, que aplica la
 * lista real leida de `CORS_ORIGINS` ya con el `.env` cargado (ver
 * `cors-io.adapter.ts`).
 */
@WebSocketGateway({
  path: '/ws',
  cors: {
    origin: resolveCorsOrigins(
      process.env.CORS_ORIGINS,
      process.env.NODE_ENV === 'production',
    ),
    credentials: true,
  },
})
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(WebsocketGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @WebSocketServer()
  server: Server;

  /**
   * Antes aceptaba cualquier conexion (`origin: '*'`, sin verificar token):
   * cualquiera que alcanzara el socket recibia las notificaciones de pagos y
   * facturas del negocio.
   */
  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);

    if (!token) {
      this.logger.warn(`WS rechazado ${client.id}: sin token`);
      client.emit('unauthorized', { message: 'Token no enviado' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      if (payload.type && payload.type !== 'access') {
        throw new Error('invalid token type');
      }

      client.data = { ...(client.data ?? {}), user: payload };
      this.logger.log(
        `WS conectado ${client.id} (${payload.username ?? payload.sub})`,
      );
    } catch {
      this.logger.warn(`WS rechazado ${client.id}: token invalido`);
      client.emit('unauthorized', { message: 'Token invalido o expirado' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`WS desconectado ${client.id}`);
  }

  @SubscribeMessage('message')
  handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ): void {
    if (!client.data?.user) {
      throw new WsException('No autenticado');
    }
    client.broadcast.emit('message', data);
  }

  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake.auth as Record<string, string> | undefined;
    const query = client.handshake.query as Record<string, string> | undefined;
    const header = client.handshake.headers.authorization;

    const token = auth?.token || query?.token || header?.replace('Bearer ', '');
    return token || undefined;
  }
}
