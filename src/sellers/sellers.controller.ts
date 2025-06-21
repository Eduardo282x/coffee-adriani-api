import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { SellersService } from './sellers.service';
import { SellersDto } from './sellers.dto';

@Controller('sellers')
export class SellersController {

    constructor(private readonly sellerService: SellersService) {

    }

    @Get()
    async getSellers() {
        return await this.sellerService.getSellers();
    }
    @Post()
    async createSellers(@Body() seller: SellersDto) {
        return await this.sellerService.createSellers(seller);
    }
    @Put()
    async updateSellers(@Param('id', ParseIntPipe) id: number, @Body() seller: SellersDto) {
        return await this.sellerService.updateSellers(id, seller);
    }
    @Delete()
    async deleteSellers(@Param('id', ParseIntPipe) id: number) {
        return await this.sellerService.deleteSellers(id);
    }
}
