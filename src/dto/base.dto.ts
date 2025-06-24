import { Transform } from "class-transformer";
import { IsDate } from "class-validator";

export class DTOBaseResponse {
    message: string;
    success: boolean;
}

export const baseResponse: DTOBaseResponse = {
    message: '',
    success: true,
}

export const badResponse: DTOBaseResponse = {
    message: '',
    success: false,
}

export class DTODateRangeFilter {
    @IsDate()
    @Transform(({ value }) => new Date(value))
    startDate: Date;
    @IsDate()
    @Transform(({ value }) => new Date(value))
    endDate: Date;
}