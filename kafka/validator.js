import fs from "fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const engagementSchema = JSON.parse(fs.readFileSync("./kafka/schemas/engagement-event.schema.json", "utf-8"));
const scoreSchema = JSON.parse(fs.readFileSync("./kafka/schemas/post-score-event.schema.json", "utf-8"));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
export const validateEngagement = ajv.compile(engagementSchema);
export const validateScore = ajv.compile(scoreSchema);
