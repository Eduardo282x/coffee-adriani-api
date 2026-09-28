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
   * emite un par nuevo. Si el token ya estaba revocado se asume robo de
   * credencial y se cierran TODAS las sesiones del usuario.
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
      this.logger.warn(
        `Reuso de refresh token detectado para el usuario ${stored.userId}: se revocan todas sus sesiones`,
      );
      await this.revokeAllForUser(stored.userId);
      return null;
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      return null;
    }

    const user = stored.user;
    const issued = await this.issue(
      {
        id: user.id,
        username: user.username,
        name: user.name,
        lastName: user.lastName,
        rol: user.roles.rol,
      },
      meta,
    );

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: {
        revokedAt: new Date(),
        replacedByHash: this.hash(issued.refreshToken),
      },
    });

    return issued;
  }

  private hash(token: string): string {
    return RefreshTokenService.hashToken(token);
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
