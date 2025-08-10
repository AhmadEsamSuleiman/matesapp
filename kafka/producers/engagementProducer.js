import kafka from "../kafkaClient.js";
import ProducerManager, { setupShutdownHooks } from "./producerManager.js";
import { validateEngagement } from "../validator.js";

const ENGAGEMENT_TOPIC = process.env.ENGAGEMENT_TOPIC || "engagement-events";

const engagementProducerManager = new ProducerManager(kafka, ENGAGEMENT_TOPIC);
setupShutdownHooks([engagementProducerManager]);

async function publishEngagementEvent(event) {
  if (!validateEngagement(event)) {
    console.error("Invalid engagement event:", validateEngagement.errors);
    throw new Error("EngagementEventValidationError");
  }

  await engagementProducerManager.publish(event);
}

export default publishEngagementEvent;
