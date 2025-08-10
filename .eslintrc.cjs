module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  extends: ["airbnb-base", "plugin:prettier/recommended"],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: "module",
  },
  rules: {
    "import/extensions": "off",
    "no-console": "off",
    "func-names": "off",
    "no-underscore-dangle": "off",
    "import/no-unresolved": "off",
    "max-len": ["error", { code: 140 }],
    "consistent-return": "off",
  },
  overrides: [
    {
      files: ["utils/**/*.js"],
      rules: {
        "no-param-reassign": "off",
      },
    },
    {
      files: ["scripts/**/*.js"],
      rules: {
        "no-console": "off",
      },
    },
    {
      files: ["tests/**/*.js"],
      env: {
        jest: true,
      },
      rules: {
        "no-undef": "off",
        "no-unused-vars": "off",
        "import/extensions": "off",
        "max-len": "off",
        "no-unused-expressions": "off",
      },
    },
  ],
};
