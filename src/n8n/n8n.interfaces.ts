export interface N8nInvoicePayload {
    client: string;
    controlNumber: string;
    itemsPending: number;
    moneyPending: number;
    blockId: number;
    block: string;
}
