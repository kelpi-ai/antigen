import { ping } from "./functions/ping";
import { onSentryIssue } from "./functions/onSentryIssue";

export const functions = [ping, onSentryIssue] as const;
