import { Transform } from "class-transformer";
import { IsDate } from "class-validator";

export class ExpensesDTO {
    @IsDate()
    @Transform(({ value }) => new Date(value))
    startDate: Date;
    @IsDate()
    @Transform(({ value }) => new Date(value))
    endDate: Date;
}