import { Injectable } from '@nestjs/common';
import { Block, Client } from '@prisma/client';
import { badResponse, baseResponse, DTOBaseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOBlocks, DTOClients } from './client.dto';

@Injectable()
export class ClientsService {

    constructor(private readonly prismaService: PrismaService) {

    }

    async getClients(): Promise<Client[]> {
        return await this.prismaService.client.findMany({
            where: { active: true },
            include: { block: true },
            orderBy: { id: 'asc' }
        })
    }

    async formatNumberClients() {
        const clients = await this.getClients();
        const parseClients = clients.map(cli => {
            const parseNumber = cli.phone.slice(0, 1) === '0' ? cli.phone : `0${cli.phone}`
            return {
                ...cli,
                phone: parseNumber
            }
        })

        parseClients.map(async (cli) => {
            await this.updateClients(cli.id, cli)
        })

        return 'Clientes formateados'

    }

    async createBlocks(newBlock: DTOBlocks): Promise<DTOBaseResponse> {
        try {
            const findBlock = await this.prismaService.block.findFirst({
                where: { name: { equals: newBlock.name, mode: 'insensitive' } },
            })

            if (findBlock) {
                badResponse.message = 'Ya existe un bloque con este nombre';
                return badResponse;
            }

            await this.prismaService.block.create({
                data: {
                    name: newBlock.name,
                    address: newBlock.address,
                }
            })

            baseResponse.message = 'Bloque agregado correctamente.';
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ClientService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async updateBlocks(id: number, newBlock: DTOBlocks): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.block.update({
                where: { id },
                data: {
                    name: newBlock.name,
                    address: newBlock.address,
                }
            })

            baseResponse.message = 'Bloque actualizado correctamente.';
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ClientService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async deleteBlocks(id: number): Promise<DTOBaseResponse> {
        try {
            const findClientInBlocks = await this.prismaService.client.findFirst({
                where: { blockId: id }
            });

            if (findClientInBlocks) {
                badResponse.message = 'Existen clientes registrados en este bloque';
                return badResponse;
            }

            await this.prismaService.block.delete({
                where: { id }
            })

            baseResponse.message = 'Bloque eliminado correctamente.'
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ClientService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getBlocks(): Promise<Block[]> {
        return await this.prismaService.block.findMany({
            orderBy: { id: 'asc' }
        });
    }

    async createClients(newClient: DTOClients): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.client.create({
                data: {
                    name: newClient.name,
                    rif: newClient.rif,
                    address: newClient.address,
                    phone: newClient.phone ? newClient.phone : '',
                    zone: newClient.zone,
                    blockId: newClient.blockId,
                    active: true
                }
            })

            baseResponse.message = 'Cliente agregado exitosamente.'
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ClientService' }
            })
            badResponse.message = err.message
            return badResponse;
        }
    }

    async updateClients(id: number, client: DTOClients): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.client.update({
                where: { id },
                data: {
                    name: client.name,
                    rif: client.rif,
                    address: client.address,
                    phone: client.phone,
                    zone: client.zone,
                    blockId: client.blockId,
                }
            })

            baseResponse.message = 'Cliente actualizado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message
            return badResponse;
        }
    }

    async deleteClients(id: number): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.client.update({
                where: { id },
                data: { active: false }
            })

            baseResponse.message = 'Cliente eliminado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message
            return badResponse;
        }
    }
}
