import mongoose from "mongoose";

const categorySchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
  },
  subCategories: [
    {
      type: String,
    },
  ],
});

const Category = mongoose.model("Category", categorySchema);

export default Category;
