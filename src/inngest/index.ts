import { ping } from "./functions/ping";
import { onLinearTicket } from "./functions/onLinearTicket";

export const functions = [ping, onLinearTicket] as const;
