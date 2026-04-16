import { ping } from "./functions/ping";
import { onLinearTicket } from "./functions/onLinearTicket";
import { onPrReadyForReview } from "./functions/onPrReadyForReview";

export const functions = [ping, onLinearTicket, onPrReadyForReview] as const;
