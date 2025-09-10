import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ProductsService } from './products.service';
import { DTODolar, DTOProducts } from './product.dto';

@Controller('products')
export class ProductsController {

    constructor(private readonly productService: ProductsService) {

    }

    @Get()
    async getProducts() {
        return await this.productService.getProducts();
    }
    @Get('/type')
    async getTypeProduct() {
        return await this.productService.getTypeProduct();
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
    @Post('/dolar/automatic')
    async updateDolarAutomatic() {
        return await this.productService.saveDolarAutomatic();
    }
    @Post('/dolar')
    async updateDolar(@Body() dolar: DTODolar) {
        return await this.productService.saveDolar(dolar);
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
