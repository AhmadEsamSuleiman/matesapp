import "dotenv/config";
import mongoose from "mongoose";
import app from "./app.js";

const DB = process.env.DB.replace("<db_password>", process.env.DB_PASSWORD);

mongoose
  .connect(DB)
  .then(() => console.log("DB connection successful"))
  .catch((err) => {
    console.error("DB connection error:", err);
    process.exit(1);
  });

const host = process.env.HOST || "0.0.0.0";
const PORT = process.env.PORT || 3000;
app.listen(PORT, host, () => {
  console.log(`App listening on port ${PORT}`);
});
