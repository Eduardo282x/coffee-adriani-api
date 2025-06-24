import { Body, Controller, Post } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesDTO } from './expenses.dto';
@Controller('expenses')
export class ExpensesController {

    constructor(private readonly expenseService: ExpensesService) {

    }

    // @Get()
    // async getExpenses(){
    //     return await this.expenseService.getExpenses();
    // }

    @Post()
    async getExpensesFilter(@Body() expenseFilter: ExpensesDTO){
        return await this.expenseService.getExpensesFilter(expenseFilter);
    }
}
