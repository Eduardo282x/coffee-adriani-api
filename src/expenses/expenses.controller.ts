import { Controller, Get } from '@nestjs/common';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
export class ExpensesController {

    constructor(private readonly expenseService: ExpensesService) {

    }

    @Get()
    async getExpenses(){
        return await this.expenseService.getExpenses();
    }
}
