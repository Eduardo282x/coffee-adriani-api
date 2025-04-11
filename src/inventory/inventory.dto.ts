import { IsNumber, IsPositive } from "class-validator";

export class DTOInventory {
    @IsNumber()
    @IsPositive()
    productId: number;
    @IsNumber()
    @IsPositive()
    quantity: number;
}