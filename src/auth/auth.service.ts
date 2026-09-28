import { Injectable } from '@nestjs/common';
import {
  createBadResponse,
  createBaseResponse,
  DTOBaseResponse,
} from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOLogin, DTOLoginResponse, DTORecover } from './auth.dto';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { RefreshTokenService } from './refresh-token.service';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  private getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Error interno del servidor';
  }

  private async logError(message: string, from: string): Promise<void> {
    try {
      await this.prismaService.errorMessages.create({
        data: { message, from },
      });
    } catch {
      // Nunca dejar que el logging de errores tumbe la peticion.
    }
  }

  /**
   * Las cuentas creadas antes del hardening guardan la contraseña en texto
   * plano. Se migran a bcrypt de forma transparente en el primer login
   * correcto, en lugar de dejar passwords legibles en la base.
   */
  private async migrateIfPlaintext(
    userId: number,
    storedHash: string,
    providedPassword: string,
  ): Promise<void> {
    if (storedHash.startsWith('$2b$') || storedHash.startsWith('$2a$')) {
      return;
    }

    const hashed = await bcrypt.hash(
      storedHash || providedPassword,
      BCRYPT_ROUNDS,
    );
    await this.prismaService.users.update({
      where: { id: userId },
      data: { password: hashed },
    });
  }

  async login(
    credentials: DTOLogin,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<DTOLoginResponse | DTOBaseResponse> {
    try {
      const findUser = await this.prismaService.users.findFirst({
        where: { username: credentials.username },
        include: { roles: true },
      });

      // Mismo mensaje para usuario inexistente y contraseña incorrecta para no
      // permitir enumeracion de cuentas.
      const GENERIC_ERROR = 'Usuario o contraseña no encontrados.';

      if (!findUser) {
        return createBadResponse(GENERIC_ERROR);
      }

      const storedPassword = findUser.password;
      const isBcrypt = /^\$2[aby]\$/.test(storedPassword);

      const isPasswordValid = isBcrypt
        ? await bcrypt.compare(credentials.password, storedPassword)
        : storedPassword === credentials.password;

      if (!isPasswordValid) {
        return createBadResponse(GENERIC_ERROR);
      }

      await this.migrateIfPlaintext(
        findUser.id,
        storedPassword,
        credentials.password,
      );

      const issued = await this.refreshTokenService.issue(
        {
          id: findUser.id,
          username: findUser.username,
          name: findUser.name,
          lastName: findUser.lastName,
          rol: findUser.roles.rol,
        },
        meta,
      );

      return {
        ...createBaseResponse(
          null,
          `Bienvenido ${findUser.name} ${findUser.lastName}`,
        ),
        token: issued.accessToken,
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        expiresIn: issued.expiresIn,
      };
    } catch (err) {
      const errorMessage = this.getErrorMessage(err);
      await this.logError(errorMessage, 'AuthService.login');
      return createBadResponse(errorMessage);
    }
  }

  async refresh(
    refreshToken: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<DTOLoginResponse | DTOBaseResponse> {
    const issued = await this.refreshTokenService.rotate(refreshToken, meta);

    if (!issued) {
      return createBadResponse(
        'Refresh token invalido, expirado o revocado. Inicie sesion nuevamente.',
      );
    }

    return {
      ...createBaseResponse(null, 'Sesion renovada'),
      token: issued.accessToken,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
    };
  }

  async logout(refreshToken: string): Promise<DTOBaseResponse> {
    await this.refreshTokenService.revoke(refreshToken);
    return createBaseResponse(null, 'Sesion cerrada');
  }

  async logoutAll(userId: number): Promise<DTOBaseResponse> {
    const revoked = await this.refreshTokenService.revokeAllForUser(userId);
    return createBaseResponse(
      { revoked },
      `Se cerraron ${revoked} sesion(es) del usuario`,
    );
  }

  /**
   * Restablece la contraseña de un usuario. Exige rol Administrador (aplicado
   * por RolesGuard) y la contraseña actual del solicitante, de modo que un
   * administrador no pueda cambiar la clave de otro sin autenticarse primero.
   */
  async recover(
    credentials: DTORecover,
    actingUser: { id: number; username: string },
  ): Promise<DTOBaseResponse> {
    try {
      const isSelf = actingUser.username === credentials.username;

      const acting = await this.prismaService.users.findFirst({
        where: { username: actingUser.username },
        include: { roles: true },
      });

      if (!acting) {
        return createBadResponse('Usuario solicitante no encontrado.');
      }

      if (acting.roles.rol !== 'Administrador') {
        return createBadResponse(
          'Solo un Administrador puede restablecer contraseñas.',
        );
      }

      const actingIsBcrypt = /^\$2[aby]\$/.test(acting.password);
      const actingValid = actingIsBcrypt
        ? await bcrypt.compare(credentials.currentPassword, acting.password)
        : acting.password === credentials.currentPassword;

      if (!actingValid) {
        return createBadResponse('La contraseña actual no coincide.');
      }

      const target = await this.prismaService.users.findFirst({
        where: { username: credentials.username },
      });

      if (!target) {
        return createBadResponse('Usuario no encontrado.');
      }

      if (isSelf && credentials.currentPassword === credentials.password) {
        return createBadResponse(
          'La nueva contraseña debe ser distinta de la actual.',
        );
      }

      await this.prismaService.users.update({
        where: { id: target.id },
        data: {
          password: await bcrypt.hash(credentials.password, BCRYPT_ROUNDS),
        },
      });

      // Restablecer una clave debe invalidar las sesiones vivas de esa cuenta.
      await this.refreshTokenService.revokeAllForUser(target.id);

      return createBaseResponse(
        null,
        `Contraseña de ${credentials.username} restablecida. Las sesiones activas de esa cuenta se cerraron.`,
      );
    } catch (err) {
      const errorMessage = this.getErrorMessage(err);
      await this.logError(errorMessage, 'AuthService.recover');
      return createBadResponse(errorMessage);
    }
  }

  /**
   * Migracion masiva de passwords en texto plano. Ya no se expone por HTTP:
   * la migracion por usuario ocurre de forma transparente en `login`.
   */
  async migratePasswords(): Promise<DTOBaseResponse> {
    const users = await this.prismaService.users.findMany();
    let migratedCount = 0;

    for (const user of users) {
      if (!/^\$2[aby]\$/.test(user.password)) {
        await this.prismaService.users.update({
          where: { id: user.id },
          data: { password: await bcrypt.hash(user.password, BCRYPT_ROUNDS) },
        });
        migratedCount += 1;
      }
    }

    return createBaseResponse(
      { migratedCount },
      `${migratedCount} contrasenas migradas exitosamente.`,
    );
  }
}
