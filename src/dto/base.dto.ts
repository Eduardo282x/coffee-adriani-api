import { Transform } from "class-transformer";
import { IsDate, IsOptional, IsString } from "class-validator";

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
    @IsOptional()
    @IsDate()
    @Transform(({ value }) => new Date(value))
    startDate: Date;
    @IsOptional()
    @IsDate()
    @Transform(({ value }) => new Date(value))
    endDate: Date;
}

export class DashboardExcel extends DTODateRangeFilter {
    @IsString()
    type: string;
}