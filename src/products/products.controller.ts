import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ProductsService } from './products.service';
import { DTOProducts } from './product.dto';

@Controller('products')
export class ProductsController {

    constructor(private readonly productService: ProductsService) {

    }

    @Get()
    async getProducts() {
        return await this.productService.getProducts();
    }
    @Get('/history')
    async getProductHistory() {
        return await this.productService.getProductHistory();
    }
    @Get('/dolar')
    async getDolar() {
        return await this.productService.getDolar();
    }
    @Post()
    async createProduct(@Body() product: DTOProducts) {
        return await this.productService.createProduct(product);
    }
    @Put('/:id')
    async updateProduct(@Param('id') id: string, @Body() product: DTOProducts) {
        return await this.productService.updateProduct(Number(id),  product);
    }
    @Delete('/:id')
    async deleteProduct(@Param('id') id: string,) {
        return await this.productService.deleteProduct(Number(id));
    }
}
