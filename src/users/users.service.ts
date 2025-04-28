import { Injectable } from '@nestjs/common';
import { Role, Users } from '@prisma/client';
import { badResponse, baseResponse, DTOBaseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOUser } from './user.dto';

@Injectable()
export class UsersService {

    constructor(private readonly prismaService: PrismaService) {

    }

    async getUsers(): Promise<Users[]> {
        return await this.prismaService.users.findMany({
            include: { roles: true }
        })
    }

    async getRoles(): Promise<Role[]> {
        return await this.prismaService.role.findMany()
    }

    async createUsers(user: DTOUser): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.users.create({
                data: {
                    username: user.username,
                    name: user.name,
                    lastName: user.lastName,
                    password: '1234',
                    rolId: user.rolId,
                }
            })

            baseResponse.message = 'Usuario creado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async updateUsers(id: number, user: DTOUser): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.users.update({
                where: { id },
                data: {
                    username: user.username,
                    name: user.name,
                    lastName: user.lastName,
                    rolId: user.rolId,
                }
            })

            baseResponse.message = 'Usuario actualizado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async deleteUsers(id: number): Promise<DTOBaseResponse> {
        try {

            const findUser = await this.prismaService.users.findFirst({
                where: { id }
            })

            if (findUser) {
                baseResponse.message = ' Usuario eliminado'
                return baseResponse;
            }

            baseResponse.message = 'Usuario creado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
