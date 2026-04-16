import { ping } from "./functions/ping";
import { onPrReadyForReview } from "./functions/onPrReadyForReview";

export const functions = [ping, onPrReadyForReview] as const;
