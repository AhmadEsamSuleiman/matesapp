import * as kafkaClient from "kafkajs";

class ProducerManager {
  constructor(kafka, topic, healthCheckTopic = "__healthcheck") {
    this.kafka = kafka;
    this.topic = topic;
    this.healthCheckTopic = healthCheckTopic;
    this.producer = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.producer && this.isConnected) {
      return this.producer;
    }

    if (this.producer) {
      console.warn("Kafka producer unhealthy; attempting to reconnect.");
      try {
        await this.producer.disconnect();
      } catch (_) {}
      this.producer = null;
      this.isConnected = false;
    }

    try {
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: true,
        idempotent: true,
      });
      await this.producer.connect();

      await this.producer.send({
        topic: this.healthCheckTopic,
        messages: [{ key: "ping", value: "pong" }],
      });

      this.isConnected = true;
      console.log(`== producer connected for topic: ${this.topic}`);
      return this.producer;
    } catch (err) {
      this.producer = null;
      this.isConnected = false;
      throw new kafkaClient.KafkaJSNonRetriableError(`Failed to connect producer for topic ${this.topic}: ${err.message}`);
    }
  }

  async publish(message) {
    const p = await this.connect();
    await p.send({
      topic: this.topic,
      messages: [{ key: message.postId, value: JSON.stringify(message) }],
    });
  }

  async disconnect() {
    if (this.producer && this.isConnected) {
      await this.producer.disconnect();
      this.producer = null;
      this.isConnected = false;
      console.log(`== producer disconnected for topic: ${this.topic}`);
    }
  }
}

export function setupShutdownHooks(managers) {
  const shutdown = async () => {
    console.log("initiating graceful shutdown");
    const disconnectPromises = managers.map((manager) => manager.disconnect());
    await Promise.all(disconnectPromises);
    console.log("all kafka producers disconnected; exiting.");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export default ProducerManager;
