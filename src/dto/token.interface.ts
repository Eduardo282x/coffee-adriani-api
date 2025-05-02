export interface IToken {
    id: number;
    name: string;
    lastName: string;
    username: string;
    rol: string;
    iat: number;
    exp: number;
}

export interface ITokenExp extends IToken {
    expired: boolean;
}