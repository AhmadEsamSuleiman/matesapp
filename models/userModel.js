import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcrypt";

const specificSchema = new mongoose.Schema({
  name: String,
  score: {
    type: Number,
    default: 0,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
});

const subInterestSchema = new mongoose.Schema({
  name: String,
  score: {
    type: Number,
    default: 0,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  specific: [specificSchema],
});

const interestSchema = new mongoose.Schema({
  name: String,
  score: {
    type: Number,
    default: 0,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  topSubs: [subInterestSchema],
  risingSubs: [subInterestSchema],
});

const creatorSchema = new mongoose.Schema({
  creatorId: {
    type: mongoose.Schema.ObjectId,
    ref: "User",
  },
  score: {
    type: Number,
    default: 0,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  skips: {
    type: Number,
    default: 0,
  },
  lastSkipAt: {
    type: Date,
    default: Date.now,
  },
});

const followingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: "User",
    required: true,
  },
  score: {
    type: Number,
    default: 0,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  skips: {
    type: Number,
    default: 0,
  },
  lastSkipAt: {
    type: Date,
    default: Date.now,
  },
});

const creatorInterestSchema = new mongoose.Schema({
  topCreators: [creatorSchema],
  risingCreators: [creatorSchema],
  skippedCreatorsPool: [
    {
      creatorId: {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
      skips: {
        type: Number,
        default: 0,
      },
      lastSkipUpdate: {
        type: Date,
        default: Date.now,
      },
      reentryAt: {
        type: Date,
      },
    },
  ],
  watchedCreatorsPool: [
    {
      creatorId: {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
      skips: {
        type: Number,
        default: 0,
      },
      lastSkipUpdate: {
        type: Date,
        default: Date.now,
      },
    },
  ],
});

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "please enter your first name"],
      maxlength: [12, "first name must be 12 characters or less"],
    },
    lastName: {
      type: String,
      required: [true, "please enter your last name"],
      maxlength: [12, "last name must be 12 characters or less"],
    },
    userName: {
      type: String,
      required: [true, "please enter your user name"],
      unique: [true, "user names is already in use, please choose another one"],
      lowercase: true,
    },
    email: {
      type: String,
      required: [true, "please enter your email address"],
      unique: [
        true,
        "email address is already in use, please user another one",
      ],
      lowercase: true,
      validate: [validator.isEmail, "please enter a valid email address"],
    },
    password: {
      type: String,
      required: [true, "please enter a password"],
      minlength: [8, "password must be 8 to 20 characters long"],
      maxlength: [20, "password must be 8 to 20 characters long"],
      select: false,
    },
    passwordConfirm: {
      type: String,
      required: [true, "please confirm your password"],
      validate: {
        validator: function (passConfirm) {
          return this.password === passConfirm;
        },
        message: "password and password confirm should be the same",
      },
    },
    profilePicture: {
      type: String,
    },
    bio: {
      type: String,
    },
    posts: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "Post",
      },
    ],
    followers: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ],
    following: [followingSchema],
    topInterests: [interestSchema],
    risingInterests: [interestSchema],
    creatorsInterests: {
      type: creatorInterestSchema,
      default: () => ({
        topCreators: [],
        risingCreators: [],
        skippedCreatorsPool: [],
        watchedCreatorsPool: [],
        lastSkipDecay: Date.now,
        lastWatchDecay: Date.now,
      }),
    },
    lastRisingReset: { type: Date, default: Date.now },
    isVerified: {
      type: Boolean,
      default: false,
    },
    active: {
      type: Boolean,
      default: true,
      select: false,
    },
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;

  next();
});

userSchema.pre("save", function (next) {
  if (!this.isModified("password") || this.isNew) return next();

  this.passwordChangedAt = Date.now() - 1000;

  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.changedPasswordAfter = function (JWTTimeStamp) {
  if (this.passwordChangedAt) {
    const changedTimeStamp = this.passwordChangedAt.getTime() / 1000;

    return changedTimeStamp > JWTTimeStamp;
  }

  return false;
};

const User = mongoose.model("User", userSchema);

export default User;
