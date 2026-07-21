const express = require('express');
const router = express.Router();
const http = require('http');
const auth = require('../middleware/auth');

router.use(auth);

// Helper to query logs from Docker socket
function getContainerLogs(containerName, tailLines = 150) {
  return new Promise((resolve, reject) => {
    let options = {
      socketPath: '/var/run/docker.sock',
      path: `/containers/${containerName}/logs?stdout=true&stderr=true&tail=${tailLines}`,
      method: 'GET'
    };

    if (process.env.DOCKER_HOST) {
      try {
        const urlStr = process.env.DOCKER_HOST.replace('tcp://', 'http://');
        const url = new URL(urlStr);
        options = {
          host: url.hostname,
          port: url.port || 2375,
          path: `/containers/${containerName}/logs?stdout=true&stderr=true&tail=${tailLines}`,
          method: 'GET'
        };
      } catch (e) {
        console.error('[logs/fetch] Failed to parse DOCKER_HOST env:', e.message);
      }
    }

    const req = http.request(options, res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Docker API returned status ${res.statusCode}`));
      }

      let buffer = [];
      res.on('data', chunk => buffer.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(buffer);
        let result = '';
        let offset = 0;
        
        try {
          // Docker multiplex stream format header decoding
          while (offset < data.length) {
            if (offset + 8 > data.length) break;
            const size = data.readUInt32BE(offset + 4);
            if (offset + 8 + size > data.length) {
              result += data.slice(offset + 8).toString('utf8');
              break;
            }
            result += data.slice(offset + 8, offset + 8 + size).toString('utf8');
            offset += 8 + size;
          }
        } catch (e) {
          // Fallback if not multiplexed
          result = data.toString('utf8');
        }

        if (!result && data.length > 0) {
          result = data.toString('utf8');
        }
        resolve(result);
      });
    });

    req.on('error', err => reject(err));
    req.end();
  });
}

// GET /api/logs
router.get('/', async (req, res) => {
  try {
    const service = req.query.service || 'freeradius';
    const lines = Math.min(Math.max(1, parseInt(req.query.lines) || 150), 5000);
    const search = req.query.search || '';

    let containerName = 'freeradius-server';
    if (service === 'api') {
      containerName = 'freeradius-api';
    } else if (service === 'nginx') {
      containerName = 'freeradius-nginx';
    } else if (service === 'postgres') {
      containerName = 'freeradius-postgres';
    }

    let logOutput = await getContainerLogs(containerName, lines);

    if (search) {
      const searchLower = search.toLowerCase();
      logOutput = logOutput
        .split('\n')
        .filter(line => line.toLowerCase().includes(searchLower))
        .join('\n');
    }

    res.json({ service, containerName, logs: logOutput });
  } catch (err) {
    // L-3 FIX: Log the full error server-side but return a generic message to the client
    console.error('[logs/fetch]', err);
    res.status(500).json({ error: 'Failed to fetch container logs. Check that the service name is correct.' });
  }
});

module.exports = router;
