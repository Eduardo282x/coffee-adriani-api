import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { DTOUser } from './user.dto';
import { Roles } from 'src/guards/roles/roles.decorator';

/**
 * Toda la gestion de usuarios es exclusiva del Administrador. Antes solo
 * `GET /users` lo exigia: crear, actualizar y borrar usuarios, y listar roles,
 * quedaban abiertos a cualquier usuario autenticado.
 */
@Roles('Administrador')
@Controller('users')
export class UsersController {
  constructor(private readonly userService: UsersService) {}

  @Get()
  async getUsers() {
    return await this.userService.getUsers();
  }

  @Get('/roles')
  async getRoles() {
    return await this.userService.getRoles();
  }

  @Post()
  async createUsers(@Body() user: DTOUser) {
    return await this.userService.createUsers(user);
  }

  @Put('/:id')
  async updateUser(@Param('id') id: string, @Body() user: DTOUser) {
    return await this.userService.updateUsers(Number(id), user);
  }

  @Delete('/:id')
  async deleteUser(@Param('id') id: string) {
    return await this.userService.deleteUsers(Number(id));
  }
}
