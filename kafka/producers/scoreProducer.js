import kafka from "../kafkaClient.js";
import ProducerManager, { setupShutdownHooks } from "./producerManager.js";
import { validateScore } from "../validator.js";

const SCORE_TOPIC = process.env.SCORE_TOPIC || "post-score-events";

const scoreProducerManager = new ProducerManager(kafka, SCORE_TOPIC);
setupShutdownHooks([scoreProducerManager]);

async function publishScoreEvent(event) {
  if (!validateScore(event)) {
    console.error("Invalid score event:", validateScore.errors);
    throw new Error("ScoreEventValidationError");
  }

  await scoreProducerManager.publish(event);
}

export default publishScoreEvent;
