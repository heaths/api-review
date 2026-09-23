import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';

const execFileAsync = promisify(execFile);
const mockUserLogin = 'heaths';
const mockUserAvatarUrl = 'https://avatars.githubusercontent.com/u/1532486?v=4';
const historyResponseDelayMs = 2000;
const mockHistoryPath = 'scripts/github-proxy.mjs';
const mockHistorySourceRef = 'api-review';
const mockHistorySourcePaths = [
  'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
  'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
];

export async function startGitHubProxy(repositoryRoot, options = {}) {
  const app = express();
  const token = randomUUID();
  const simulatePullRequest = options.simulatePullRequest === true;
  const seededPullRequest = simulatePullRequest ? await getSeededPullRequest(repositoryRoot) : undefined;
  const pullRequests = new Map(seededPullRequest
    ? [[seededPullRequest.number, createSeededPullRequestStore(seededPullRequest.headSha)]]
    : []);

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
      await delay(historyResponseDelayMs);
      response.json(await getMockTags(repositoryRoot));
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
      await delay(historyResponseDelayMs);
      if (filePath === mockHistoryPath) {
        response.json(await getMockHistoryCommits(repositoryRoot, maxEntries));
        return;
      }

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

  app.get('/commit', async (request, response) => {
    const ref = readQuery(request.query.ref);
    if (!ref) {
      response.status(400).json({ error: 'ref is required' });
      return;
    }

    try {
      const output = await runGit(repositoryRoot, [
        'log',
        '--max-count=1',
        '--format=%H%x00%cI%x00%B%x00%x1e',
        ref,
      ]);
      response.json(parseCommits(output)[0] ?? null);
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
      response.type('text/plain').send(await runGit(
        repositoryRoot,
        ['show', `${ref}:${filePath === mockHistoryPath ? await getMockHistorySourcePath(repositoryRoot, ref) ?? filePath : filePath}`],
      ));
    } catch (error) {
      if (isMissingContentError(error)) {
        response.sendStatus(404);
        return;
      }
      sendError(response, error);
    }
  });

  app.get('/pull-request', (request, response) => {
    const ref = readQuery(request.query.ref);
    if (!seededPullRequest || !ref || !matchesSeededPullRequestRef(ref, seededPullRequest)) {
      response.sendStatus(404);
      return;
    }

    response.json(seededPullRequest);
  });

  app.get('/pull-request-comments', (request, response) => {
    if (!simulatePullRequest) {
      response.sendStatus(404);
      return;
    }

    const prNumber = readPullRequestNumber(request.query.prNumber);
    if (!prNumber) {
      response.status(400).json({ error: 'prNumber is required' });
      return;
    }

    const store = getPullRequestStore(pullRequests, prNumber, false);
    response.json(store ? listPullRequestComments(store) : []);
  });

  app.post('/pull-request-comments', (request, response) => {
    if (!simulatePullRequest) {
      response.sendStatus(404);
      return;
    }

    const prNumber = readPullRequestNumber(request.body?.prNumber);
    const commitId = readQuery(request.body?.commitId);
    const path = readRepositoryPath(request.body?.path);
    const line = readPositiveInteger(request.body?.line);
    const body = typeof request.body?.body === 'string' ? request.body.body : undefined;
    if (!prNumber || !commitId || !path || !line || body === undefined) {
      response.status(400).json({ error: 'prNumber, commitId, path, line, and body are required' });
      return;
    }

    const store = getPullRequestStore(pullRequests, prNumber, true);
    const review = createReviewRecord(store, commitId, 'COMMENTED', '', []);
    const comment = createSubmittedComment(store, {
      commitId,
      path,
      line,
      body,
      author: mockUserLogin,
      reviewId: review.id,
    });
    review.commentIds.push(comment.id);
    response.status(201).json(comment);
  });

  app.patch('/pull-request-comments/:commentId', (request, response) => {
    if (!simulatePullRequest) {
      response.sendStatus(404);
      return;
    }

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

  app.post('/pull-request-comments/:commentId/replies', (request, response) => {
    if (!simulatePullRequest) {
      response.sendStatus(404);
      return;
    }

    const prNumber = readPullRequestNumber(request.body?.prNumber);
    const commentId = readPositiveInteger(request.params.commentId);
    const body = typeof request.body?.body === 'string' ? request.body.body : undefined;
    if (!prNumber || !commentId || body === undefined) {
      response.status(400).json({ error: 'prNumber, commentId, and body are required' });
      return;
    }

    const store = getPullRequestStore(pullRequests, prNumber, false);
    const parent = store ? getTopLevelComment(store, commentId) : undefined;
    if (!store || !parent) {
      response.sendStatus(404);
      return;
    }

    const review = createReviewRecord(store, parent.commit_id, 'COMMENTED', '', []);
    const comment = createSubmittedComment(store, {
      reviewId: review.id,
      commitId: parent.commit_id,
      path: parent.path,
      line: parent.line,
      body,
      author: mockUserLogin,
      inReplyToId: parent.id,
    });
    review.commentIds.push(comment.id);
    response.status(201).json(comment);
  });

  app.delete('/pull-request-comments/:commentId', (request, response) => {
    if (!simulatePullRequest) {
      response.sendStatus(404);
      return;
    }

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
    if (!simulatePullRequest) {
      response.sendStatus(404);
      return;
    }

    const prNumber = readPullRequestNumber(request.query.prNumber);
    if (!prNumber) {
      response.status(400).json({ error: 'prNumber is required' });
      return;
    }

    const store = getPullRequestStore(pullRequests, prNumber, false);
    response.json(store ? store.reviews.map(review => toReviewPayload(review)) : []);
  });

  app.post('/pull-request-reviews', (request, response) => {
    if (!simulatePullRequest) {
      response.sendStatus(404);
      return;
    }

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

async function getMockTags(repositoryRoot) {
  const names = (await runGit(repositoryRoot, [
    'tag',
    '--merged',
    mockHistorySourceRef,
    '--sort=-creatordate',
  ]))
    .split('\n')
    .filter(Boolean);

  return (await Promise.all(names.map(async name => {
    const path = await getMockHistorySourcePath(repositoryRoot, name);
    if (!path) {
      return undefined;
    }

    return {
      name,
      commit: await runGit(repositoryRoot, ['rev-list', '-n', '1', name]),
    };
  }))).filter(Boolean);
}

async function getMockHistoryCommits(repositoryRoot, maxEntries) {
  const path = await getMockHistorySourcePath(repositoryRoot, mockHistorySourceRef);
  if (!path) {
    return appendMockHistory([], maxEntries);
  }

  const output = await runGit(repositoryRoot, [
    'log',
    `--max-count=${Math.max(maxEntries, 1)}`,
    '--format=%H%x00%cI%x00%B%x00%x1e',
    mockHistorySourceRef,
    '--',
    path,
  ]);

  return appendMockHistory(parseCommits(output).slice(1), maxEntries);
}

async function getMockHistorySourcePath(repositoryRoot, ref) {
  for (const path of mockHistorySourcePaths) {
    try {
      await runGit(repositoryRoot, ['cat-file', '-e', `${ref}:${path}`]);
      return path;
    } catch {
    }
  }

  return undefined;
}

function appendMockHistory(commits, maxEntries) {
  return [
    ...commits,
    {
      hash: '95f95f95f95f95f95f95f95f95f95f95f95f95f9',
      committedAt: '2024-09-17T00:00:00Z',
      message: [
        'Update MSRV to 1.95',
        '',
        'Update the minimum rust-version to version 1.95',
      ].join('\n'),
    },
  ].slice(0, maxEntries);
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
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
    store = createEmptyPullRequestStore();
    pullRequests.set(prNumber, store);
  }
  return store;
}

function createEmptyPullRequestStore() {
  return {
    nextReviewId: 1,
    nextCommentId: 1,
    comments: [],
    reviews: [],
  };
}

function createSeededPullRequestStore(commitId) {
  return {
    nextReviewId: 5184128495,
    nextCommentId: 3994090763,
    reviews: [{
      id: 5183174172,
      state: 'COMMENTED',
      body: 'This is the first review with 1 comment.',
      commitId,
      author: mockUserLogin,
      submittedAt: '2026-09-11T20:32:06Z',
      commentIds: [3993158275],
    }, {
      id: 5183181104,
      state: 'COMMENTED',
      body: '',
      commitId,
      author: mockUserLogin,
      submittedAt: '2026-09-11T20:32:23Z',
      commentIds: [3993164859],
    }, {
      id: 5183184124,
      state: 'COMMENTED',
      body: '',
      commitId,
      author: mockUserLogin,
      submittedAt: '2026-09-11T20:32:51Z',
      commentIds: [3993167721],
    }, {
      id: 5183188404,
      state: 'COMMENTED',
      body: 'This is the second review with 1 reply.',
      commitId,
      author: mockUserLogin,
      submittedAt: '2026-09-11T20:33:47Z',
      commentIds: [3993171853],
    }, {
      id: 5184128494,
      state: 'COMMENTED',
      body: '',
      commitId,
      author: mockUserLogin,
      submittedAt: '2026-09-11T23:06:51Z',
      commentIds: [3994090762],
    }],
    comments: [{
      id: 3993158275,
      body: 'This is a review comment.',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      line: 65,
      commit_id: commitId,
      pull_request_review_id: 5183174172,
      in_reply_to_id: undefined,
      user: createMockUser(),
      created_at: '2026-09-11T20:31:25Z',
      updated_at: '2026-09-11T20:32:06Z',
    }, {
      id: 3993164859,
      body: 'This is an immediate review comment.',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      line: 66,
      commit_id: commitId,
      pull_request_review_id: 5183181104,
      in_reply_to_id: undefined,
      user: createMockUser(),
      created_at: '2026-09-11T20:32:23Z',
      updated_at: '2026-09-11T20:32:23Z',
    }, {
      id: 3993167721,
      body: 'This is an immediately review comment reply.',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      line: 65,
      commit_id: commitId,
      pull_request_review_id: 5183184124,
      in_reply_to_id: 3993158275,
      user: createMockUser(),
      created_at: '2026-09-11T20:32:51Z',
      updated_at: '2026-09-11T20:32:51Z',
    }, {
      id: 3993171853,
      body: 'This is a review comment reply in a separate review.',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      line: 65,
      commit_id: commitId,
      pull_request_review_id: 5183188404,
      in_reply_to_id: 3993158275,
      user: createMockUser(),
      created_at: '2026-09-11T20:33:26Z',
      updated_at: '2026-09-11T20:33:47Z',
    }, {
      id: 3994090762,
      body: 'This is an immediately review comment reply added by the VSCode extension.',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      line: 65,
      commit_id: commitId,
      pull_request_review_id: 5184128494,
      in_reply_to_id: 3993158275,
      user: createMockUser(),
      created_at: '2026-09-11T23:06:51Z',
      updated_at: '2026-09-11T23:06:51Z',
    }],
  };
}

async function getSeededPullRequestCommitId(repositoryRoot) {
  return runGit(repositoryRoot, ['rev-parse', 'HEAD']);
}

async function getSeededPullRequest(repositoryRoot) {
  const headRef = await getSeededPullRequestRef(repositoryRoot);
  const headSha = await getSeededPullRequestCommitId(repositoryRoot);
  const livePullRequest = await getLivePullRequest(repositoryRoot, headRef);
  const base = livePullRequest
    ? { ref: livePullRequest.baseRef, sha: livePullRequest.baseSha }
    : await getSeededPullRequestBase(repositoryRoot);

  return {
    number: livePullRequest?.number ?? 1,
    title: livePullRequest?.title ?? `Pull request for ${shortRef(headRef)}`,
    state: 'open',
    baseRef: base.ref,
    baseSha: base.sha,
    headRef,
    headSha,
    headOwner: livePullRequest?.headOwner ?? mockUserLogin,
  };
}

async function getSeededPullRequestRef(repositoryRoot) {
  try {
    const upstream = await runGit(repositoryRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    const separator = upstream.indexOf('/');
    return separator >= 0 ? upstream.slice(separator + 1) : upstream;
  } catch {
    return runGit(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  }
}

async function getSeededPullRequestBase(repositoryRoot) {
  const defaultBranch = await getRepositoryDefaultBranch(repositoryRoot);
  if (defaultBranch) {
    try {
      return {
        ref: defaultBranch,
        sha: await runGit(repositoryRoot, ['rev-parse', `origin/${defaultBranch}`]),
      };
    } catch {
      try {
        return {
          ref: defaultBranch,
          sha: await runGit(repositoryRoot, ['rev-parse', defaultBranch]),
        };
      } catch {
      }
    }
  }

  return {
    ref: await getSeededPullRequestRef(repositoryRoot),
    sha: await getSeededPullRequestCommitId(repositoryRoot),
  };
}

async function getLivePullRequest(repositoryRoot, headRef) {
  const repository = await getGitHubRepository(repositoryRoot);
  if (!repository) {
    return undefined;
  }

  for (const selector of [`${repository.owner}:${headRef}`, headRef]) {
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr',
        'view',
        selector,
        '--repo',
        `${repository.owner}/${repository.repo}`,
        '--json',
        'number,title,state,baseRefName,baseRefOid,headRefName,headRepositoryOwner',
      ], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      const pullRequest = parseLivePullRequest(stdout);
      if (pullRequest?.state === 'OPEN' && pullRequest.headRef === headRef) {
        return pullRequest;
      }
    } catch {
    }
  }

  return undefined;
}

async function getGitHubRepository(repositoryRoot) {
  try {
    const remoteUrl = await runGit(repositoryRoot, ['config', '--get', 'remote.origin.url']);
    return parseGitHubRepository(remoteUrl);
  } catch {
    return undefined;
  }
}

async function getRepositoryDefaultBranch(repositoryRoot) {
  try {
    const symbolicRef = await runGit(repositoryRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
    const prefix = 'refs/remotes/origin/';
    return symbolicRef.startsWith(prefix) ? symbolicRef.slice(prefix.length) : undefined;
  } catch {
    return undefined;
  }
}

function parseGitHubRepository(url) {
  const match = url.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/iu);
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

function parseLivePullRequest(payload) {
  const parsed = JSON.parse(payload);
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }

  return typeof parsed.number === 'number'
    && typeof parsed.title === 'string'
    && typeof parsed.state === 'string'
    && typeof parsed.baseRefName === 'string'
    && typeof parsed.baseRefOid === 'string'
    && typeof parsed.headRefName === 'string'
    && parsed.headRepositoryOwner
    && typeof parsed.headRepositoryOwner === 'object'
    && typeof parsed.headRepositoryOwner.login === 'string'
    ? {
      number: parsed.number,
      title: parsed.title,
      state: parsed.state,
      baseRef: parsed.baseRefName,
      baseSha: parsed.baseRefOid,
      headRef: parsed.headRefName,
      headOwner: parsed.headRepositoryOwner.login,
    }
    : undefined;
}

function matchesSeededPullRequestRef(ref, seededPullRequest) {
  return ref === seededPullRequest.headRef
    || ref === seededPullRequest.headSha
    || ref === `refs/pull/${seededPullRequest.number}/head`;
}

function shortRef(ref) {
  return ref.slice(0, 8);
}

function createReview(store, commitId, event, body, comments) {
  const timestamp = new Date().toISOString();
  const review = createReviewRecord(store, commitId, event, body, [], timestamp);
  review.commentIds = comments.map(comment => createSubmittedComment(store, {
    commitId,
    path: comment.path,
    line: comment.line,
    body: comment.body,
    author: mockUserLogin,
    reviewId: review.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).id);
  return review;
}

function listPullRequestComments(store) {
  return store.comments
    .slice()
    .sort((left, right) => String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? '')));
}

function updateReviewComment(store, commentId, body) {
  const comment = store.comments.find(current => current.id === commentId);
  if (!comment) {
    return undefined;
  }

  comment.body = body;
  comment.updated_at = new Date().toISOString();
  return comment;
}

function deleteReviewComment(store, commentId) {
  const comment = store.comments.find(current => current.id === commentId);
  if (!comment) {
    return false;
  }

  const threadRootId = getThreadRootId(comment);
  const deletedCommentIds = new Set(
    store.comments
      .filter(current => current.id === commentId || getThreadRootId(current) === threadRootId)
      .map(current => current.id),
  );
  store.comments = store.comments.filter(current => !deletedCommentIds.has(current.id));
  for (const review of store.reviews) {
    review.commentIds = review.commentIds.filter(currentId => !deletedCommentIds.has(currentId));
  }
  return true;
}

function getTopLevelComment(store, commentId) {
  const comment = store.comments.find(current => current.id === commentId);
  return comment && comment.in_reply_to_id === undefined ? comment : undefined;
}

function createSubmittedComment(store, options) {
  const timestamp = options.createdAt ?? new Date().toISOString();
  const comment = {
    id: store.nextCommentId++,
    body: options.body,
    path: options.path,
    line: options.line,
    commit_id: options.commitId,
    pull_request_review_id: options.reviewId,
    in_reply_to_id: options.inReplyToId,
    user: createMockUser(options.author),
    created_at: timestamp,
    updated_at: options.updatedAt ?? timestamp,
  };
  store.comments.push(comment);
  return comment;
}

function createReviewRecord(store, commitId, event, body, commentIds, submittedAt = new Date().toISOString()) {
  const review = {
    id: store.nextReviewId++,
    state: event === 'APPROVE' ? 'APPROVED' : event === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'COMMENTED',
    body,
    commitId,
    author: mockUserLogin,
    submittedAt,
    commentIds,
  };
  store.reviews.push(review);
  return review;
}

function getThreadRootId(comment) {
  return comment.in_reply_to_id ?? comment.id;
}

function toReviewPayload(review) {
  return {
    id: review.id,
    state: review.state,
    body: review.body,
    commit_id: review.commitId,
    user: createMockUser(review.author),
    submitted_at: review.submittedAt,
  };
}

function createMockUser(login = mockUserLogin) {
  return {
    login,
    avatar_url: mockUserAvatarUrl,
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
