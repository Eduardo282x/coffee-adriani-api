import { Injectable } from '@nestjs/common';
import {
  createBadResponse,
  createBaseResponse,
  DTOBaseResponse,
} from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOUser } from './user.dto';
import * as bcrypt from 'bcrypt';
import { Role } from 'src/generated/prisma/client';

const BCRYPT_ROUNDS = 12;

/** Forma publica de un usuario. El hash de contrasena nunca sale de la API. */
export interface PublicUser {
  id: number;
  username: string;
  name: string;
  lastName: string;
  rolId: number;
  roles: Role;
}

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  private async logError(message: string, from: string): Promise<void> {
    try {
      await this.prismaService.errorMessages.create({
        data: { message, from },
      });
    } catch {
      // El logging de errores no debe propagar fallos.
    }
  }

  /**
   * Antes devolvia el modelo `Users` completo, incluida la columna `password`
   * (hash bcrypt) a cualquier endpoint que llamara a este metodo.
   */
  private static readonly safeUserSelect = {
    id: true,
    username: true,
    name: true,
    lastName: true,
    rolId: true,
    roles: true,
  } as const;

  async getUsers(): Promise<PublicUser[]> {
    return await this.prismaService.users.findMany({
      select: UsersService.safeUserSelect,
    });
  }

  async getRoles(): Promise<Role[]> {
    return await this.prismaService.role.findMany();
  }

  async createUsers(user: DTOUser): Promise<DTOBaseResponse> {
    if (!user.password) {
      return createBadResponse(
        'Debe enviar una contrasena para crear el usuario (minimo 8 caracteres).',
      );
    }

    try {
      await this.prismaService.users.create({
        data: {
          username: user.username,
          name: user.name,
          lastName: user.lastName,
          password: await bcrypt.hash(user.password, BCRYPT_ROUNDS),
          rolId: user.rolId,
        },
      });

      return createBaseResponse(
        { id: user.username },
        'Usuario creado exitosamente.',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.logError(message, 'UserService.createUsers');
      return createBadResponse(message);
    }
  }

  async updateUsers(id: number, user: DTOUser): Promise<DTOBaseResponse> {
    try {
      const data: {
        username: string;
        name: string;
        lastName: string;
        rolId: number;
        password?: string;
      } = {
        username: user.username,
        name: user.name,
        lastName: user.lastName,
        rolId: user.rolId,
      };

      if (user.password) {
        data.password = await bcrypt.hash(user.password, BCRYPT_ROUNDS);
      }

      await this.prismaService.users.update({ where: { id }, data });

      return createBaseResponse(null, 'Usuario actualizado exitosamente.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.logError(message, 'UserService.updateUsers');
      return createBadResponse(message);
    }
  }

  async deleteUsers(id: number): Promise<DTOBaseResponse> {
    try {
      await this.prismaService.users.delete({ where: { id } });
      return createBaseResponse(null, 'Usuario eliminado');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.logError(message, 'UserService.deleteUsers');
      return createBadResponse(message);
    }
  }
}
