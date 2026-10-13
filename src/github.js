import githubAppJwt from 'universal-github-app-jwt';

import { gatherResponse } from './util';

const shouldFakeUserAgent = false;

const defaultApiUrl = 'https://api.github.com';

const defaultHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

const userAgentHeader = agentId =>
  shouldFakeUserAgent
    ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36 Edg/115.0.1901.200'
    : `comment-worker-${agentId}`;

class GitHub {
  constructor(agentId, token, organizationSlug, repositorySlug, apiUrl = defaultApiUrl) {
    // Constructor
    this.token = token;
    this.organizationSlug = organizationSlug;
    this.repositorySlug = repositorySlug;
    this.repoUrl = `${apiUrl}/repos/${organizationSlug}/${repositorySlug}`;
    this.headers = {
      ...defaultHeaders,
      'User-Agent': userAgentHeader(agentId),
      Authorization: `Bearer ${token}`
    };
  }

  static async initialize(
    appId,
    privateKey,
    organizationSlug,
    repositorySlug,
    apiUrl = defaultApiUrl
  ) {
    const { token } = await githubAppJwt({
      id: appId,
      privateKey
    });

    const { token: installationToken } = await this.getInstallationTokenByOrgName(
      appId,
      token,
      organizationSlug,
      apiUrl
    );

    return new GitHub(appId, installationToken, organizationSlug, repositorySlug, apiUrl);
  }

  // Authenticate with a personal access token (e.g. one belonging to a bot account) instead of a GitHub App
  static fromToken(token, organizationSlug, repositorySlug, apiUrl = defaultApiUrl) {
    return new GitHub('token', token, organizationSlug, repositorySlug, apiUrl);
  }

  static async getInstallationTokenByOrgName(
    appId,
    appBearerToken,
    organizationSlug,
    apiUrl = defaultApiUrl
  ) {
    const headers = {
      ...defaultHeaders,
      'User-Agent': userAgentHeader(appId),
      Authorization: `Bearer ${appBearerToken}`
    };

    const appInstallationsResponse = await fetch(`${apiUrl}/app/installations`, {
      headers
    });

    const appInstallations = await gatherResponse(appInstallationsResponse);

    const installation = appInstallations.find(item => item.account.login === organizationSlug);

    const installationTokenResponse = await fetch(installation.access_tokens_url, {
      method: 'POST',
      headers
    });

    const installationToken = await gatherResponse(installationTokenResponse);

    return installationToken;
  }

  async createFileOnRepository(commentPath, message, content, branch) {
    const createCommentResponse = await fetch(`${this.repoUrl}/contents/${commentPath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content,
        branch
      }),
      headers: this.headers
    });

    const commentResponse = await gatherResponse(createCommentResponse);

    return commentResponse;
  }

  async createBranchOnRepository(branchName, branchFrom = 'master') {
    const branchResponse = await fetch(`${this.repoUrl}/git/ref/heads/${branchFrom}`, {
      headers: this.headers
    });

    const branch = await gatherResponse(branchResponse);

    const createBranchResponse = await fetch(`${this.repoUrl}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: branch.object.sha
      }),
      headers: this.headers
    });

    const branchCreation = await gatherResponse(createBranchResponse);

    return branchCreation;
  }

  async createPullRequestOnRepository(title, body, branchSource, branchTarget = 'master') {
    const createPullRequestResponse = await fetch(`${this.repoUrl}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        body,
        head: branchSource,
        base: branchTarget
      }),
      headers: this.headers
    });

    const pullRequest = await gatherResponse(createPullRequestResponse);

    return pullRequest;
  }

  // Labels that don't exist yet are created by GitHub
  async addLabelsToIssue(issueNumber, labels) {
    const labelsResponse = await fetch(`${this.repoUrl}/issues/${issueNumber}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labels }),
      headers: this.headers
    });

    return labelsResponse.ok;
  }

  async getRepository() {
    const repositoryResponse = await fetch(this.repoUrl, {
      headers: this.headers
    });

    const repository = await gatherResponse(repositoryResponse);

    return repository;
  }

  async getFileFromRepository(filePath, branchFrom = 'master') {
    const fileResponse = await fetch(`${this.repoUrl}/contents/${filePath}?ref=${branchFrom}`, {
      method: 'GET',
      headers: this.headers
    });

    const file = await gatherResponse(fileResponse);

    return file;
  }
}

export default GitHub;
