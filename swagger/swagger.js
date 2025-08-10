import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Personalized Content Feed API",
      version: "1.0.0",
      description: "API for generating personalized content feeds, managing user interests, and tracking content metrics.",
      contact: {
        name: "Ahmad Esam",
        email: "ahmadesamsuleiman@gmail.com",
      },
    },
    servers: [
      {
        url: "http://localhost:3000/api/v1",
        description: "Development Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: 'JWT Authorization header using the Bearer scheme. Example: "Authorization: Bearer {token}"',
        },
      },
      schemas: {},
      responses: {
        BadRequest: {
          description: "Bad request (validation failed or missing data).",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", example: "fail" },
                  message: { type: "string", example: "Invalid request data." },
                },
              },
            },
          },
        },
        UnauthorizedError: {
          description: "Access token is missing or invalid.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", example: "fail" },
                  message: {
                    type: "string",
                    example: "You are not logged in! Please log in to get access.",
                  },
                },
              },
            },
          },
        },
        ForbiddenError: {
          description: "You do not have permission to perform this action.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", example: "fail" },
                  message: {
                    type: "string",
                    example: "You do not have permission to perform this action.",
                  },
                },
              },
            },
          },
        },
        NotFoundError: {
          description: "The requested resource was not found.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", example: "fail" },
                  message: { type: "string", example: "Resource not found." },
                },
              },
            },
          },
        },
        InternalServerError: {
          description: "An unexpected server error occurred.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", example: "error" },
                  message: { type: "string", example: "Something went wrong!" },
                },
              },
            },
          },
        },
      },
    },
    tags: [
      {
        name: "Authentication",
        description: "User authentication and authorization related operations.",
      },
      {
        name: "Feed",
        description: "Operations related to generating and retrieving personalized content feeds.",
      },
      {
        name: "Post",
        description: "Operations related to content posts (creation, retrieval, updates).",
      },
      {
        name: "Comments",
        description: "Operations related to comments on posts.",
      },
      {
        name: "Engagement",
        description: "Recording user engagement and skip actions.",
      },
    ],
  },
  apis: ["./routes/*.js", "./swagger/schemas/*.yaml", "./swagger/paths/*.yaml"],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
