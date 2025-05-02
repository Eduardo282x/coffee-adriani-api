import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { UsersService } from './users.service';
import { DTOUser } from './user.dto';
import { Roles } from 'src/guards/roles/roles.decorator';

@Controller('users')
export class UsersController {

    constructor(private readonly userService: UsersService) {
    }

    @Roles('Administrador')
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
        return await this.userService.updateUsers(Number(id), user)
    }

    @Delete('/:id')
    async deleteUser(@Param('id') id: string){
        return await this.userService.deleteUsers(Number(id))
    }
}
