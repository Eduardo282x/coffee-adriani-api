import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDTO, SupplierFilterDTO, SupplierPaymentFilterDTO, UpdateSupplierDTO } from './suppliers.dto';

@Controller('suppliers')
export class SuppliersController {

    constructor(private readonly suppliersService: SuppliersService) { }

    @Get()
    async getSuppliers(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
        @Query('active') active?: string,
    ) {
        return await this.suppliersService.getSuppliers({
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 50,
            search: search as string,
            active: active === 'true' ? true : active === 'false' ? false : undefined,
        });
    }

    @Post()
    async createSupplier(@Body() supplier: CreateSupplierDTO) {
        return await this.suppliersService.createSupplier(supplier);
    }

    @Put('/:id')
    async updateSupplier(@Param('id', ParseIntPipe) id: number, @Body() supplier: UpdateSupplierDTO) {
        return await this.suppliersService.updateSupplier(id, supplier);
    }

    @Delete('/:id')
    async deleteSupplier(@Param('id', ParseIntPipe) id: number) {
        return await this.suppliersService.deleteSupplier(id);
    }

    // @Get('/:id/payments')
    // async getSupplierPayments(
    //     @Param('id', ParseIntPipe) id: number,
    //     @Query('startDate') startDate?: string,
    //     @Query('endDate') endDate?: string,
    //     @Query('page') page?: string,
    //     @Query('limit') limit?: string,
    // ) {
    //     return await this.suppliersService.getSupplierPayments({
    //         supplierId: id,
    //         startDate: startDate ? new Date(startDate) : undefined,
    //         endDate: endDate ? new Date(endDate) : undefined,
    //         page: page ? parseInt(page) : 1,
    //         limit: limit ? parseInt(limit) : 50,
    //     });
    // }
}
