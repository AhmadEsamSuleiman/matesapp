# MatesApp

# Social Media Platform With Interest Tracking Engine And Feed Algorithm

# Mates (Personalized Social Feed)

**Mates** is a social media feed generator that delivers a **highly personalized content feed** to each user. It continuously learns from user actions (views, likes, comments, shares) and adjusts recommendations in real time. The system combines long-term user interests with immediate behavior, balancing relevance with discovery.

---

## Pitch

> Mates is a personalized social feed system that learns from every user action to serve relevant content. By combining long-term preference profiles with real-time behavior (using exponential moving averages) and smoothing scores with Bayesian priors, it delivers a balanced mix of familiar favorites and new discoveries.

---

## Key Features

1. **Hierarchical Interest Profiles**
   Tracks each user’s preferences at three levels: Category, Subcategory, and Specific Interest. Updates all levels on every engagement to capture both broad and niche interests.

2. **Dual-Layer Scoring**
   - **Persistent Layer (MongoDB)**: Stores long-term profiles using Exponential Moving Averages (EMA) with a low alpha to maintain stability.
   - **Real-Time Layer (Redis Session)**: Captures session-level activity with a higher EMA alpha for responsive updates.

3. **Engagement Scoring & Bayesian Smoothing**
   Calculates engagement scores by weighting actions (view, like, comment, share) and applies Bayesian smoothing to avoid extreme values for new or rarely-seen interests.

4. **Dynamic Interest Pools**
   Maintains **Top** and **Rising** lists for interests and creators. Demotes or removes low-scoring items to keep the profile focused and the feed fresh.

5. **Personalized Feed Generation**
   Gathers posts from multiple sources (_buckets_):
   - Top Interests
   - Rising Interests
   - Favorite Creators
   - Followed Accounts
   - Global Pools (trending, recent, evergreen)
   - Exploration (random content)

   Scores candidates by combining personal affinity and global signals, then interleaves them into a balanced feed.

---

## How It Works

1. **New User / Exploration**
   - No profile: feed is exploratory or trending posts only.

2. **User Engagement**
   - **Endpoint:** `POST /engagement/positive`
   - Computes an engagement score (weighted sum of actions).
   - Updates global stats, post metrics and user profile using EMA for interests and creators.

3. **Negative Feedback (Skips)**
   - **Endpoint:** `POST /engagement/negative`
   - Applies a negative weight to relevant interests or creators.
   - Temporarily filters out skipped content.

4. **Interest Decay**
   - EMA-based decay: interest scores fade over time if not reinforced (half-life \~0.5 days).

5. **Fetching the Feed**
   - **Endpoint:** `GET /feed`
   - Builds interest pools from MongoDB and Redis.
   - Fetches candidate posts per pool.
   - Scores each post (personal + global).
   - Interleaves final feed with reserved slots for exploration.

---

## Architecture & Components

- **Backend:** Node.js & Express
- **Database:** MongoDB (persistent) & Redis (session data)
- **Models:**
  - `User` (with nested interest docs)
  - `Post`
  - `GlobalStats` (category/creator aggregates)
  - `UserInterestStats`

- **Controllers:**
  - `engagementController` (handles engagement endpoints)
  - `feedController` (constructs the feed)

- **Services:**
  - Interest & Creator scoring (EMA logic)
  - Skip logic
  - Feed assembly & interleaving

- **Utilities:**
  - `score.js` (EMA & decay)
  - `smoothingUtils.js` (Bayesian smoothing)
  - `interleaveByBucket.js` (feed composition)

---

## Installation & Setup

1. **Clone & Install**

   ```bash
   git clone
   cd mates-app
   npm install
   ```

2. **Configure Environment**
   Create a `.env` filling `.example.env`

3. **Run the Server**

   ```
   npm start
   ```

   - API available at `http://localhost:3000`
   - Swagger docs at `/api-docs`

4. **Usage Examples**
   - **Register User:** `POST /users`
   - **Create Posts** in various categories
   - **Login** to obtain JWT token
   - **Engage:** `POST /engagement/positive`

     ```json
     {
       "postId": "<ID>",
       "viewed": 1,
       "liked": 1
     }
     ```

   - **Fetch Feed:** `GET /feed` (include `Authorization: Bearer <token>`)

---

## Technologies & Tools

- **Language & Frameworks:** Node.js, Express
- **Databases:** MongoDB, Redis
- **ORM/ODM:** Mongoose
- **Auth:** JSON Web Tokens (JWT)
- **Testing:** Mocha, Supertest, Sinon, Chai

---

## TODO

- **Optimize Scoring Logic**  
  Reduce database round‑trips and simplify the scoring algorithm for better performance.

- **Speed Up Feed Generation**  
  Refactor feed assembly to minimize latency and lower CPU load.

- **Database Refactor: Interests**  
  Move user and creator interest stats into their own collections, removing them from the `User` model.
