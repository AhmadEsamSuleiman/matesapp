# Mates — Social Media Backend & Recommendation Engine

**Mates** is a Node.js/Express backend for a social media platform with a smart feed recommendation engine. The system combines user interests, creator preferences, and trending content to generate a personalized feed. It uses MongoDB (Mongoose), Redis (for session-based personalization), and Kafka for event-driven updates.

---

## Table of Contents

- [Overview](#overview)
- [Architecture & Components](#architecture--components)
- [Data Models](#data-models)
- [Feed Recommendation Pipeline](#feed-recommendation-pipeline)
  - [Interest & Creator Pools](#interest--creator-pools)
  - [Candidate Selection](#candidate-selection)
  - [Fetching Posts](#fetching-posts)
  - [Scoring Posts](#scoring-posts)
  - [Assembling the Feed](#assembling-the-feed)

- [Session Management & Personalization](#session-management--personalization)
  - [Session Store (Redis)](#session-store-redis)
  - [Interest Scoring (Session vs. DB)](#interest-scoring-session-vs-db)
  - [Session Expiration & Merging](#session-expiration--merging)

- [Kafka Integration](#kafka-integration)
  - [Producers (Engagement & Score)](#producers-engagement--score)
  - [Consumers (Aggregators)](#consumers-aggregators)

- [Testing](#testing)
- [Setup & Deployment](#setup--deployment)
- [Development Stack & Utilities](#development-stack--utilities)
- [License](#license)

---

## Overview

Mates powers personalized user feeds. When a user registers and interacts with content (views, likes, comments, skips), the system learns preferences to generate a relevant feed.

Core goals:

- **Personalization:** Learn user tastes across categories, subcategories and creators.
- **Freshness:** Favor new and trending posts with time decay.
- **Exploration:** Add random/unseen posts to encourage discovery.
- **Robustness:** Use session-based fast adaptation, merged into a stable long-term profile.

Key components: interest scoring, session caching, Kafka eventing, and a multi-bucket feed assembly algorithm.

---

## Architecture & Components

- **Node.js + Express:** REST API and controllers.
- **MongoDB (Mongoose):** Persistent storage for Users, Posts, and aggregated stats.
- **Redis:** In-memory session store used to capture short-term, high-alpha behavior.
- **Kafka:** Asynchronous event bus for engagement and scoring events.
- **Services & Controllers:** Business logic lives in `services/`, endpoint handlers in `controllers/`.
- **Utilities:** Helpers for interleaving, smoothing, pool management and score computations.

Simplified flow:

```
Client --> Express API --> FeedService
                     |--> Redis (session)
                     |--> MongoDB (users/posts/stats)
                     |--> Kafka (events)
Kafka consumers --> Aggregate DB updates
Session worker --> Merge session -> DB
```

---

## Data Models (high level)

- **User**: Profile + `topInterests`, `risingInterests`, `creatorsInterests` (top/rising/skipped/watched pools), `following`. Used to personalize feeds.
- **Post**: `creator`, `category`, `subCategory`, `rawScore`, `bayesianScore`, `trendingScore`, `cumulativeScore`, timestamps.
- **GlobalStats**: Aggregated per-category/subcategory engagement counts and priors used for smoothing.
- **CreatorStats**: Aggregated metrics per creator for creator-based scoring.

Example user interest structure:

```js
{
  topInterests: [ { name, score, lastUpdated, topSubs: [...], risingSubs: [...] } ],
  creatorsInterests: { topCreators: [...], risingCreators: [...], skippedCreatorsPool: [...] },
  following: [ { creatorId, score } ]
}
```

---

## Feed Recommendation Pipeline

When a user requests a feed, the pipeline roughly follows these steps:

1. **Load user profile & session data** from MongoDB and (optionally) Redis.
2. **Build interest & creator pools** from DB profile or session.
3. **Select candidate buckets** (top/rising categories, top/rising creators, followed creators, exploration slots).
4. **Fetch candidate posts** from DB for each bucket (category-based, creator-based, and global pools like trending/recent/evergreen).
5. **Score each candidate post** combining personal interest, creator affinity, time decay, and global metrics.
6. **Assemble final feed** by interleaving buckets (round-robin) and filling with exploration.

### Interest & Creator Pools

- Pools consist of _top_ and _rising_ items, each with a score.
- Session pools (in Redis) are more reactive and have higher learning rate (alpha).
- DB pools represent smoothed long-term interests.
- Pools are merged at session end; session values are considered first and blended with DB values when present.

### Candidate Selection

- Select top N categories and creators from merged pools.
- Add a few extras randomly for diversity.
- Respect skipped/watched/reentry logic for creators.

### Fetching Posts

- For each selected bucket, fetch a mix of the highest-scored posts and a few random posts (to avoid echo chambers).
- Also fetch general pools: trending, rising, recent, and evergreen posts.
- Filter out posts the user has already seen.

### Scoring Posts

A blended score is computed for each post, combining several signals:

- Personal interest score (category and creator affinity) — weighted.
- Post-level scores (rawScore, bayesianScore, trendingScore) — weighted.
- Time decay (older posts receive decay via a configurable half-life).

A simplified scoring formula:

```
overallScore = personalFactor * timeDecay * (w1 * interestScore + w2 * creatorScore)
             + w3 * post.rawScore
             + w4 * post.trendingScore
             + w5 * post.bayesianScore
```

Weights are configured in a scoring config file.

### Assembling the Feed

- Use `interleaveByBucket` to mix posts from different buckets, ensuring diversity.
- Fill to `FEED_SIZE` (e.g., 20). for remaining slots, use exploration/random picks.
- Return a formatted payload with creator metadata for presentation.

---

## Session Management & Personalization

The system separates short-term session behavior from long-term DB profile:

### Session Store (Redis)

- Active session data stored as JSON blobs per `sess:<sessionId>`.
- Includes session `topCategories`, `risingCategories`, `topCreators`, `risingCreators`, `skippedCreatorsPool`, and `watchedCreatorsPool`.
- Each user action (view, like, skip) updates the session data rapidly.

### Interest Scoring (Session vs. DB)

- **Redis path:** `scoreInterestRedis` / `scoreCreatorRedis` update session pools with higher sensitivity.
- **DB path:** `scoreInterestDB` / `scoreCreatorDB` persist updates directly to the user document if Redis is disabled.
- Session updates are immediate and adapt the feed quickly; DB updates are slower and smoothed.

### Session Expiration & Merging

- A session expiry worker checks for inactive sessions and calls `mergeSessionIntoUser(userId, sessionId)`.
- Merging blends session scores into the DB using an EMA-like blend:

```js
newScore = alpha * sessionScore + (1 - alpha) * dbScore;
```

- `SESSION_BLEND_ALPHA` (e.g., 0.25) ensures session changes have a visible but not dominant effect on long-term interests.
- After merging, session keys are cleared from Redis.

Benefits:

- Rapid personalization in-session, without noisy permanent changes.
- Long-term stability via controlled blending.

---

## Kafka Integration

Kafka is used to decouple API-side events from heavy DB updates. Typical topics:

- `engagement-events` — emitted when users view/like/comment/skip.
- `post-score-events` — emitted for per-post score deltas.

### Producers (Engagement & Score)

- `engagementProducer.js` and `scoreProducer.js` publish events containing relevant metadata (postId, userId, category, creatorId, scoreDelta).
- Publishing is fire-and-forget from the request path, keeping API latency low.

### Consumers (Aggregators)

- **Cumulative Score Consumer** listens to post-score events and increments `Post.cumulativeScore`.
- **Engagement Stats Consumer** listens to engagement events and updates `GlobalStats` and `CreatorStats`.
- Consumers can batch updates and recompute derived metrics (e.g., trending detection).

This design supports scaling (multiple producers/consumers) and resilience.

---

## Testing

- Test framework: **Mocha + Chai**.
- Tests are located under `tests/` grouped by feature (feed, engagement, models, controllers).
- Run tests locally:

```bash
npm install
npm test
```

---

## Setup & Deployment

1. **Copy environment variables**:

```bash
cp .env.example .env
# Edit .env to provide MONGO_URI, REDIS_URL, KAFKA_BROKERS, JWT_SECRET, etc.
```

2. **Docker (recommended)**: The project includes a `Dockerfile` and `docker-compose.yml` to run the app with dependencies.

```bash
# Build and start all services (app, mongo, redis, zookeeper, kafka)
docker-compose up --build
```

3. **Local (without Docker)**:

```bash
npm install
# make sure zookeeper and kafka are installed and running
npm run dev
```

4. **Run tests**:

```bash
npm test
```

Notes:

- The app waits for dependent services on startup (there may be scripts like `wait-for-it.sh`).
- Ensure Kafka + Zookeeper are reachable when using event producers/consumers.

---

## Development Stack & Utilities

- **Node.js** (ES Modules)
- **Express.js**
- **Mongoose**
- **Redis** (session cache)
- **Kafka** (kafkajs)
- **Mocha / Chai** for testing
- **ESLint / Prettier** for code quality
- **Docker / docker-compose** for local infra

Helpful utilities in the codebase:

- `nodeHelpers.js` — pool insertion/removal, top/rising management
- `smoothingUtils.js` — Bayesian smoothing and EMA helpers
- `interleaveByBucket.js` — round robin merging of multiple post lists
- `sessionExpiryWorker.js` — detects stale sessions and triggers merges
