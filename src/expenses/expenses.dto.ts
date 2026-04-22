import { Transform } from "class-transformer";
import { IsDate, IsString } from "class-validator";

export class ExpensesDTO {
    @IsDate()
    @Transform(({ value }) => new Date(value))
    startDate: Date;
    @IsDate()
    @Transform(({ value }) => new Date(value))
    endDate: Date;
    @IsString()
    type: string;
}