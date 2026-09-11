import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';

const execFileAsync = promisify(execFile);

export async function startGitHubProxy(repositoryRoot) {
  const app = express();
  const token = randomUUID();

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'X-GitHub-Proxy-Token');
    if (request.method === 'OPTIONS') {
      response.sendStatus(204);
      return;
    }
    if (request.get('X-GitHub-Proxy-Token') !== token) {
      response.sendStatus(401);
      return;
    }
    next();
  });

  app.get('/tags', async (_request, response) => {
    try {
      const names = (await runGit(repositoryRoot, ['tag', '--list']))
        .split('\n')
        .filter(Boolean);
      const tags = (await Promise.all(names.map(async name => {
        try {
          return {
            name,
            commit: await runGit(repositoryRoot, ['rev-list', '-n', '1', name]),
          };
        } catch {
          return undefined;
        }
      }))).filter(Boolean);
      response.json(tags);
    } catch (error) {
      sendError(response, error);
    }
  });

  app.get('/commits', async (request, response) => {
    const ref = readQuery(request.query.ref);
    const filePath = readRepositoryPath(request.query.path);
    const maxEntries = readMaxEntries(request.query.maxEntries);
    if (!ref || !filePath) {
      response.status(400).json({ error: 'ref and path are required' });
      return;
    }

    try {
      const output = await runGit(repositoryRoot, [
        'log',
        `--max-count=${maxEntries}`,
        '--format=%H%x00%cI%x00%B%x00%x1e',
        ref,
        '--',
        filePath,
      ]);
      response.json(parseCommits(output));
    } catch (error) {
      sendError(response, error);
    }
  });

  app.get('/content', async (request, response) => {
    const ref = readQuery(request.query.ref);
    const filePath = readRepositoryPath(request.query.path);
    if (!ref || !filePath) {
      response.status(400).json({ error: 'ref and path are required' });
      return;
    }

    try {
      response.type('text/plain').send(await runGit(repositoryRoot, ['show', `${ref}:${filePath}`]));
    } catch (error) {
      if (isMissingContentError(error)) {
        response.sendStatus(404);
        return;
      }
      sendError(response, error);
    }
  });

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('GitHub proxy did not bind to a TCP port.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

async function runGit(repositoryRoot, args) {
  const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

function parseCommits(output) {
  return output.split('\x1e').flatMap(record => {
    const [hash, committedAt, message] = record.trim().split('\x00');
    return hash && message ? [{ hash, committedAt, message: message.trim() }] : [];
  });
}

function readQuery(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readRepositoryPath(value) {
  const filePath = readQuery(value);
  if (!filePath || filePath.startsWith('/') || filePath.split('/').includes('..')) {
    return undefined;
  }
  return filePath;
}

function readMaxEntries(value) {
  const parsed = Number.parseInt(readQuery(value) ?? '', 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 30;
}

function isMissingContentError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist in|exists on disk, but not in/iu.test(message);
}

function sendError(response, error) {
  const message = error instanceof Error ? error.message : String(error);
  response.status(500).json({ error: message });
}
