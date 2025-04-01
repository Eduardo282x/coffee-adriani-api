export class DTOBaseResponse {
    message: string;
    success: boolean;
}

export const baseResponse = {
    message: '',
    success: true,
}

export const badResponse = {
    message: '',
    success: false,
}