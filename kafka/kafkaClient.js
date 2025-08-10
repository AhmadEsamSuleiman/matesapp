import { Kafka } from "kafkajs";
import dotenv from "dotenv";

dotenv.config();

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || "mates-app",
  brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
});

export default kafka;
