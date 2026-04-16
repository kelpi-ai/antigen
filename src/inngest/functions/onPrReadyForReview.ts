import { inngest } from "../client";
import { runPrHunter } from "../../p3/orchestrate";

export const onPrReadyForReview = inngest.createFunction(
  {
    id: "on-pr-ready-for-review",
    retries: 1,
    concurrency: {
      limit: 1,
      key: "event.data.prNumber",
    },
  },
  { event: "github/pr.ready_for_review" },
  async ({ event, step }) => {
    return runPrHunter({ event: event.data, step });
  },
);
