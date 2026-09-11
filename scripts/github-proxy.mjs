import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';

const execFileAsync = promisify(execFile);

export async function startGitHubProxy(repositoryRoot) {
  const app = express();
  const token = randomUUID();
  const pullRequests = new Map();

  app.disable('x-powered-by');
  app.use(express.json());
  app.use((request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-GitHub-Proxy-Token');
    response.setHeader('Access-Control-Allow-Methods', 'DELETE, GET, OPTIONS, PATCH, POST');
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

  app.get('/pull-request-comments', (request, response) => {
    const prNumber = readPullRequestNumber(request.query.prNumber);
    if (!prNumber) {
      response.status(400).json({ error: 'prNumber is required' });
      return;
    }

    const store = getPullRequestStore(pullRequests, prNumber, false);
    response.json(store ? listReviewComments(store) : []);
  });

  app.patch('/pull-request-comments/:commentId', (request, response) => {
    const prNumber = readPullRequestNumber(request.body?.prNumber);
    const commentId = readPositiveInteger(request.params.commentId);
    const body = typeof request.body?.body === 'string' ? request.body.body : undefined;
    if (!prNumber || !commentId || body === undefined) {
      response.status(400).json({ error: 'prNumber, commentId, and body are required' });
      return;
    }

    const store = getPullRequestStore(pullRequests, prNumber, false);
    const comment = store ? updateReviewComment(store, commentId, body) : undefined;
    if (!comment) {
      response.sendStatus(404);
      return;
    }

    response.json(comment);
  });

  app.delete('/pull-request-comments/:commentId', (request, response) => {
    const prNumber = readPullRequestNumber(request.query.prNumber);
    const commentId = readPositiveInteger(request.params.commentId);
    if (!prNumber || !commentId) {
      response.status(400).json({ error: 'prNumber and commentId are required' });
      return;
    }

    const store = getPullRequestStore(pullRequests, prNumber, false);
    if (!store || !deleteReviewComment(store, commentId)) {
      response.sendStatus(404);
      return;
    }

    response.sendStatus(204);
  });

  app.get('/pull-request-reviews', (request, response) => {
    const prNumber = readPullRequestNumber(request.query.prNumber);
    if (!prNumber) {
      response.status(400).json({ error: 'prNumber is required' });
      return;
    }

    const store = getPullRequestStore(pullRequests, prNumber, false);
    response.json(store ? store.reviews.map(review => toReviewPayload(review)) : []);
  });

  app.post('/pull-request-reviews', (request, response) => {
    const prNumber = readPullRequestNumber(request.body?.prNumber);
    const commitId = readQuery(request.body?.commitId);
    const event = readReviewEvent(request.body?.event);
    const body = typeof request.body?.body === 'string' ? request.body.body : undefined;
    const comments = Array.isArray(request.body?.comments)
      ? request.body.comments.map(readDraftComment).filter(Boolean)
      : [];
    if (!prNumber || !commitId || !event) {
      response.status(400).json({ error: 'prNumber, commitId, and event are required' });
      return;
    }

    const store = getPullRequestStore(pullRequests, prNumber, true);
    const review = createReview(store, commitId, event, body, comments);
    response.status(201).json(toReviewPayload(review));
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

function readPullRequestNumber(value) {
  return readPositiveInteger(typeof value === 'string' ? value : String(value ?? ''));
}

function readPositiveInteger(value) {
  const parsed = Number.parseInt(readQuery(value) ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readReviewEvent(value) {
  switch (value) {
    case 'APPROVE':
    case 'COMMENT':
    case 'REQUEST_CHANGES':
      return value;

    default:
      return undefined;
  }
}

function readDraftComment(value) {
  return value && typeof value === 'object'
    && typeof value.path === 'string'
    && Number.isInteger(value.line)
    && typeof value.body === 'string'
    ? { path: value.path, line: value.line, body: value.body }
    : undefined;
}

function getPullRequestStore(pullRequests, prNumber, create) {
  let store = pullRequests.get(prNumber);
  if (!store && create) {
    store = {
      nextReviewId: 1,
      nextCommentId: 1,
      reviews: [],
    };
    pullRequests.set(prNumber, store);
  }
  return store;
}

function createReview(store, commitId, event, body, comments) {
  const timestamp = new Date().toISOString();
  const review = {
    id: store.nextReviewId++,
    state: event === 'APPROVE' ? 'APPROVED' : event === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'COMMENTED',
    body,
    commitId,
    author: 'local',
    submittedAt: timestamp,
    comments: comments.map(comment => ({
      id: store.nextCommentId++,
      body: comment.body,
      path: comment.path,
      line: comment.line,
      commit_id: commitId,
      user: { login: 'local' },
      created_at: timestamp,
      updated_at: timestamp,
    })),
  };
  store.reviews.push(review);
  return review;
}

function listReviewComments(store) {
  return store.reviews
    .flatMap(review => review.comments)
    .slice()
    .sort((left, right) => String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? '')));
}

function updateReviewComment(store, commentId, body) {
  for (const review of store.reviews) {
    const comment = review.comments.find(current => current.id === commentId);
    if (!comment) {
      continue;
    }

    comment.body = body;
    comment.updated_at = new Date().toISOString();
    return comment;
  }

  return undefined;
}

function deleteReviewComment(store, commentId) {
  for (const review of store.reviews) {
    const index = review.comments.findIndex(comment => comment.id === commentId);
    if (index < 0) {
      continue;
    }

    review.comments.splice(index, 1);
    return true;
  }

  return false;
}

function toReviewPayload(review) {
  return {
    id: review.id,
    state: review.state,
    body: review.body,
    commit_id: review.commitId,
    user: { login: review.author },
    submitted_at: review.submittedAt,
  };
}

function isMissingContentError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist in|exists on disk, but not in/iu.test(message);
}

function sendError(response, error) {
  const message = error instanceof Error ? error.message : String(error);
  response.status(500).json({ error: message });
}
