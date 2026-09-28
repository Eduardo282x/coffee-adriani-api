import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

/**
 * Socket.IO evalua la opcion `cors` del decorador `@WebSocketGateway` en el
 * momento de importar el modulo, es decir ANTES de que `ConfigModule.forRoot`
 * haya cargado el `.env`. Con solo el decorador, `process.env.CORS_ORIGINS`
 * todavia era `undefined` y la lista efectiva caia al default (que incluye
 * `http://localhost:5173`), dejando el handshake abierto a origenes locales
 * incluso en produccion.
 *
 * Este adapter se instala desde `main.ts`, donde las variables de entorno ya
 * estan cargadas, y sobrescribe el CORS del engine con la lista resuelta.
 */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Record<string, unknown>) {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.origins,
        credentials: true,
      },
    });
  }
}
