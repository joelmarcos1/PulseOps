const express = require('express');

const { UrlValidationError, normalizeAllowedUrl } = require('./urlPolicy');

function createApp({ monitorRepository, allowedHosts }) {
  const app = express();

  // Convert incoming JSON request bodies into JavaScript objects at req.body.
  app.use(express.json());

  // Verify that the API process can answer requests.
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Register a new page to monitor.
  app.post('/monitors', async (req, res, next) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

    if (name.length < 1 || name.length > 100) {
      return res.status(400).json({
        error: {
          code: 'INVALID_NAME',
          message: 'Name must contain between 1 and 100 characters',
        },
      });
    }

    let normalizedUrl;
    try {
      normalizedUrl = normalizeAllowedUrl(req.body?.url, allowedHosts);
    } catch (error) {
      if (error instanceof UrlValidationError) {
        return res.status(400).json({
          error: {
            code: 'INVALID_URL',
            message: error.message,
          },
        });
      }

      return next(error);
    }

    try {
      const monitor = await monitorRepository.create({
        name,
        url: normalizedUrl,
      });

      return res
        .location(`/monitors/${monitor.id}`)
        .status(201)
        .json(monitor);
    } catch (error) {
      // PostgreSQL error 23505 means that a UNIQUE value already exists.
      if (error.code === '23505') {
        return res.status(409).json({
          error: {
            code: 'MONITOR_ALREADY_EXISTS',
            message: 'A monitor with this URL already exists',
          },
        });
      }

      return next(error);
    }
  });

  // Return the stored pages and the latest check for each one.
  app.get('/monitors', async (req, res, next) => {
    try {
      const monitors = await monitorRepository.list();
      return res.status(200).json({ monitors });
    } catch (error) {
      return next(error);
    }
  });

  // Return a predictable JSON response for unexpected application errors.
  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  return app;
}

module.exports = createApp;
