import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Cron } from '@nestjs/schedule';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';

export interface AccessTokenPayload {
  sub: number;
  username: string;
  name: string;
  lastName: string;
  rol: string;
  type: 'access';
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  /**
   * Ventana durante la cual un token ya rotado puede presentarse de nuevo sin
   * asumir robo. Cubre respuestas perdidas (timeout/red) y reintentos legítimos.
   */
  private static readonly REFRESH_GRACE_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private get accessTtl(): number {
    const parsed = Number(this.configService.get('ACCESS_TOKEN_TTL'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
  }

  private get refreshTtl(): number {
    const parsed = Number(this.configService.get('REFRESH_TOKEN_TTL'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 604_800;
  }

  private static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async signAccessToken(payload: Omit<AccessTokenPayload, 'type'>) {
    return await this.jwtService.signAsync(
      { ...payload, type: 'access' } satisfies AccessTokenPayload,
      {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: this.accessTtl,
      },
    );
  }

  /** Emite un par access/refresh nuevo y persiste el hash del refresh. */
  async issue(
    user: {
      id: number;
      username: string;
      name: string;
      lastName: string;
      rol: string;
    },
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedTokens> {
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTtl * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: RefreshTokenService.hashToken(refreshToken),
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        ipAddress: meta.ip?.slice(0, 45) ?? null,
      },
    });

    return {
      accessToken: await this.signAccessToken({
        sub: user.id,
        username: user.username,
        name: user.name,
        lastName: user.lastName,
        rol: user.rol,
      }),
      refreshToken,
      expiresIn: this.accessTtl,
    };
  }

  /**
   * Rota el refresh token: valida el presented, revoca la fila anterior y
   * emite un par nuevo.
   *
   * La rotación es un "claim" atómico: la fila solo se marca como revocada si
   * seguía activa (`revokedAt: null`). Bajo concurrencia, solo un request gana
   * y el resto recibe `null`. Antes, dos requests con el mismo token podían
   * pasar el chequeo y emitir dos pares válidos.
   *
   * Un token ya revocado no implica robo por sí solo: el cliente reintenta con
   * el mismo token cuando la respuesta se pierde (timeout, red caída). Dentro
   * de `REFRESH_GRACE_MS` se asume ese caso y se emite un par nuevo; solo fuera
   * de la ventana y con sucesor (reuso real) se revocan todas las sesiones.
   */
  async rotate(
    presentedToken: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedTokens | null> {
    const tokenHash = RefreshTokenService.hashToken(presentedToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { roles: true } } },
    });

    if (!stored) {
      return null;
    }

    if (stored.revokedAt !== null) {
      return this.handleReplayedToken(stored, meta);
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      return null;
    }

    return this.claimAndIssue(stored, meta);
  }

  private async handleReplayedToken(
    stored: {
      id: number;
      userId: number;
      revokedAt: Date | null;
      replacedByHash: string | null;
      user: {
        id: number;
        username: string;
        name: string;
        lastName: string;
        roles: { rol: string };
      };
    },
    meta: { userAgent?: string; ip?: string },
  ): Promise<IssuedTokens | null> {
    const rotatedRecently =
      stored.replacedByHash !== null &&
      stored.revokedAt !== null &&
      Date.now() - stored.revokedAt.getTime() <=
        RefreshTokenService.REFRESH_GRACE_MS;

    if (rotatedRecently) {
      this.logger.warn(
        `Reintento de refresh dentro de la ventana de gracia para el usuario ${stored.userId}: se emite un par nuevo`,
      );
      const user = stored.user;
      return this.issue(
        {
          id: user.id,
          username: user.username,
          name: user.name,
          lastName: user.lastName,
          rol: user.roles.rol,
        },
        meta,
      );
    }

    // Reuso real: un token rotado hace tiempo se está presentando de nuevo.
    // Solo entonces se asume robo de credencial.
    if (stored.replacedByHash !== null) {
      this.logger.warn(
        `Reuso de refresh token detectado para el usuario ${stored.userId}: se revocan todas sus sesiones`,
      );
      await this.revokeAllForUser(stored.userId);
    }

    return null;
  }

  private async claimAndIssue(
    stored: {
      id: number;
      userId: number;
      user: {
        id: number;
        username: string;
        name: string;
        lastName: string;
        roles: { rol: string };
      };
    },
    meta: { userAgent?: string; ip?: string },
  ): Promise<IssuedTokens | null> {
    const refreshToken = randomBytes(48).toString('base64url');
    const newHash = RefreshTokenService.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + this.refreshTtl * 1000);

    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedByHash: newHash },
      });

      // Otro request ganó la carrera: el token ya fue consumido.
      if (result.count !== 1) {
        return false;
      }

      await tx.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: newHash,
          expiresAt,
          userAgent: meta.userAgent?.slice(0, 255) ?? null,
          ipAddress: meta.ip?.slice(0, 45) ?? null,
        },
      });

      return true;
    });

    if (!claimed) {
      return null;
    }

    const user = stored.user;
    return {
      accessToken: await this.signAccessToken({
        sub: user.id,
        username: user.username,
        name: user.name,
        lastName: user.lastName,
        rol: user.roles.rol,
      }),
      refreshToken,
      expiresIn: this.accessTtl,
    };
  }

  async revoke(presentedToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash: RefreshTokenService.hashToken(presentedToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: number): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Limpieza periodica de tokens expirados o revocados hace tiempo. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
      },
    });
    return result.count;
  }

  @Cron('0 30 3 * * *')
  async handlePurge(): Promise<void> {
    try {
      const purged = await this.purgeExpired();
      this.logger.log(`Refresh tokens purgados: ${purged}`);
    } catch (err) {
      this.logger.error(
        `Fallo al purgar refresh tokens: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
