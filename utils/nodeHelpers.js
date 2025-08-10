import mongoose from "mongoose";
import { emaUpdate } from "./score.js";

function identifiersEqual(val, identifier) {
  if (val && typeof val.equals === "function") {
    return val.equals(identifier);
  }

  if (
    (typeof val === "string" || mongoose.isValidObjectId(val)) &&
    (typeof identifier === "string" || mongoose.isValidObjectId(identifier))
  ) {
    return val.toString() === identifier.toString();
  }

  return val === identifier;
}

export function findOrInitNode(list1, list2, identifier, defaults, opts = { key: "name" }) {
  const key = opts.key || "name";

  let node = list1.find((x) => identifiersEqual(x[key], identifier)) || list2.find((x) => identifiersEqual(x[key], identifier));

  if (!node) {
    node = { [key]: identifier, ...defaults };
  }
  return node;
}

export function updateNodeScore(node, engagementScore) {
  node.score = emaUpdate(node.score, node.lastUpdated, engagementScore);

  node.lastUpdated = Date.now();
}

function removeExistingCandidate(arr, identifier, keyField = "name") {
  const idx = arr.findIndex((x) => identifiersEqual(x[keyField], identifier));
  if (idx !== -1) {
    arr.splice(idx, 1);
  }
}

export function insertIntoPools(primaryArr, secondaryArr, maxPrimary, maxSecondary, candidate, opts = { key: "name" }) {
  const keyField = opts.key || "name";

  removeExistingCandidate(primaryArr, candidate[keyField], keyField);
  removeExistingCandidate(secondaryArr, candidate[keyField], keyField);

  if (candidate.score < 0) {
    return;
  }

  if (primaryArr.length < maxPrimary) {
    primaryArr.push(candidate);
    primaryArr.sort((a, b) => b.score - a.score);
    return; // Done.
  }

  const lowestPrimary = primaryArr[primaryArr.length - 1];
  if (candidate.score > lowestPrimary.score) {
    primaryArr[primaryArr.length - 1] = candidate;
    primaryArr.sort((a, b) => b.score - a.score);

    if (maxSecondary > 0) {
      const demoted = lowestPrimary;

      if (secondaryArr.length < maxSecondary) {
        secondaryArr.push(demoted);
        secondaryArr.sort((a, b) => b.score - a.score);
      } else {
        const lowestSecondary = secondaryArr[secondaryArr.length - 1];
        if (demoted.score > lowestSecondary.score) {
          secondaryArr[secondaryArr.length - 1] = demoted;
          secondaryArr.sort((a, b) => b.score - a.score);
        }
      }
    }
    return;
  }

  if (maxSecondary <= 0) {
    return;
  }

  if (secondaryArr.length < maxSecondary) {
    secondaryArr.push(candidate);
    secondaryArr.sort((a, b) => b.score - a.score);
    return;
  }

  const lowestSecondary = secondaryArr[secondaryArr.length - 1];
  if (candidate.score > lowestSecondary.score) {
    secondaryArr[secondaryArr.length - 1] = candidate;
    secondaryArr.sort((a, b) => b.score - a.score);
  }
}
