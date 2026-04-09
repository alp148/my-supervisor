'use strict';

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'My Supervisor API',
      version: '1.0.0',
      description: 'A supervisord-like process manager for Node.js with REST API and SSE support',
    },
    servers: [
      {
        url: 'http://localhost:9000',
        description: 'Local development server',
      },
    ],
  },
  apis: ['./src/api/server.js', './src/api/routes/*.js'], // files containing annotations as above
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
