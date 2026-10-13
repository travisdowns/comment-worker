import { Hono } from 'hono';
// eslint-disable-next-line
import { cors } from 'hono/cors';
import { Base64 } from 'js-base64';
import { pickBy } from 'lodash';
import yaml from 'yaml';
import { z } from 'zod';

import GitHub from './github';
import { findSpamReasons } from './spam';
import {
  buildGeneratedFields,
  convertFormDataToObject,
  handlePlaceholders,
  objectToMarkdownTable
} from './util';
import { buildSchemaObject } from './validation';
import Validator from './validator';

// Name of the form field Turnstile injects its token into
const turnstileTokenKey = 'cf-turnstile-response';

const spamLabel = 'likely-spam';

// Setting up our application:
const app = new Hono();

app.use('/api/*', async (c, next) => {
  const { env } = c;
  const allowedOriginsString = env.CW_ALLOWED_ORIGINS;
  const allowedOrigins = allowedOriginsString.split(',');

  const corsMiddleware = cors({
    origin: allowedOrigins,
    allowHeaders: ['Origin', 'Content-Type', 'Content-Length', 'Accept', 'User-Agent'],
    allowMethods: ['POST']
  });

  return corsMiddleware(c, next);
});

// Errors are returned as JSON with an errorCode, matching what staticman clients expect
const errorResponse = (c, errorCode, status) => c.json({ success: false, errorCode }, status);

const createGitHubClient = async env => {
  const organizationSlug = env.GITHUB_ORGANIZATION_SLUG;
  const repositorySlug = env.GITHUB_REPOSITORY_SLUG;
  const apiUrl = env.GITHUB_API_URL || undefined;

  if (env.GITHUB_TOKEN) {
    return GitHub.fromToken(env.GITHUB_TOKEN, organizationSlug, repositorySlug, apiUrl);
  }

  // We need to format the private key to handle the line breaks accordingly
  const formattedPrivateKey = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n');
  return GitHub.initialize(
    env.GITHUB_APP_ID,
    formattedPrivateKey,
    organizationSlug,
    repositorySlug,
    apiUrl
  );
};

const parseRequestBody = async req => {
  const contentTypeHeader = req.header('Content-Type') || '';

  if (contentTypeHeader.startsWith('application/x-www-form-urlencoded')) {
    return convertFormDataToObject(await req.parseBody());
  } else if (contentTypeHeader.startsWith('application/json')) {
    return await req.json();
  }
  return undefined;
};

// The api signature follows hono
// POST to create the comment
app.post('/api/handle/form', async c => {
  const { req, env } = c;
  const shouldDebug = env.CW_DEBUG === 'true';
  const honeypotField = env.CW_HONEYPOT_FIELD || 'hp';

  const body = await parseRequestBody(req);
  if (!body) {
    return errorResponse(c, 'UNSUPPORTED_CONTENT_TYPE', 400);
  }

  // Handle the fields and options
  const { [honeypotField]: honeypotValue, ...fieldValues } = body.fields || {};
  // Options are free form (staticman does not validate them), but only string values are kept
  const optionValues = pickBy(body.options || {}, value => typeof value === 'string');

  if (shouldDebug) console.log(fieldValues);

  const gh = await createGitHubClient(env);
  const repositoryBranch = env.GITHUB_REPOSITORY_BRANCH;

  const staticmanFile = await gh.getFileFromRepository('staticman.yml', repositoryBranch);
  if (!staticmanFile?.content) {
    return errorResponse(c, 'MISSING_CONFIG_FILE', 500);
  }

  const staticmanConfigJson = yaml.parse(Base64.decode(staticmanFile.content));
  const staticmanCommentsConfig = staticmanConfigJson.comments;

  // Handle the default config from the yml file
  const allowedFields = staticmanCommentsConfig?.allowedFields || [];
  const requiredFields = staticmanCommentsConfig?.requiredFields || [];
  const allowedOptions = staticmanCommentsConfig?.allowedOptions;
  const requiredOptions = staticmanCommentsConfig?.requiredOptions || [];
  const moderation = String(staticmanCommentsConfig?.moderation) !== 'false';
  const fieldTransforms =
    staticmanCommentsConfig?.transforms || staticmanCommentsConfig?.fieldTransforms || {};
  const optionTransforms = staticmanCommentsConfig?.optionTransforms || {};

  // Build input fields schema
  const fieldInputSchema = z
    .object(buildSchemaObject(allowedFields, requiredFields, fieldTransforms))
    .strict();

  // Validate the input fields and escape
  const { validatedSchema: validatedFields, formattedError } = await Validator.inspect(
    fieldInputSchema,
    fieldValues
  );

  if (formattedError) {
    return errorResponse(c, 'INVALID_FIELDS', 400);
  }

  let validatedOptions = optionValues;
  if (allowedOptions) {
    // Build input options schema
    const optionInputSchema = z
      .object(buildSchemaObject(allowedOptions, requiredOptions, optionTransforms))
      .strict();

    // Validate the input options and escape
    const inspection = await Validator.inspect(optionInputSchema, optionValues);
    if (inspection.formattedError) {
      return errorResponse(c, 'INVALID_OPTIONS', 400);
    }
    validatedOptions = inspection.validatedSchema;
  }

  // Generate unique placeholder properties
  const now = new Date();
  const commentId = crypto.randomUUID();
  const placeholders = { id: commentId, timestamp: now.valueOf() };

  const generatedFields = buildGeneratedFields(staticmanCommentsConfig?.generatedFields, now);
  if (!generatedFields.date) {
    generatedFields.date = now.toISOString();
  }

  // Same layout as staticman entries: _id and _parent first, then fields, then generated fields
  const fields = {
    _id: commentId,
    ...(validatedOptions.parent ? { _parent: validatedOptions.parent } : {}),
    ...validatedFields,
    ...generatedFields
  };

  const spamReasons = await findSpamReasons({
    env,
    honeypotValue,
    turnstileToken: body[turnstileTokenKey],
    remoteIp: req.header('CF-Connecting-IP')
  });
  const isSuspect = spamReasons.length > 0;

  if (shouldDebug) console.log({ fields, spamReasons });

  // Handle the data to create the comment entry
  const commitMessage = Object.prototype.hasOwnProperty.call(
    staticmanCommentsConfig,
    'commitMessage'
  )
    ? handlePlaceholders(
        staticmanCommentsConfig.commitMessage,
        fields,
        validatedOptions,
        placeholders
      )
    : 'Add comment-worker data';
  const filename = Object.prototype.hasOwnProperty.call(staticmanCommentsConfig, 'filename')
    ? handlePlaceholders(staticmanCommentsConfig.filename, fields, validatedOptions, placeholders)
    : commentId;
  const directoryPath = Object.prototype.hasOwnProperty.call(staticmanCommentsConfig, 'path')
    ? handlePlaceholders(staticmanCommentsConfig.path, fields, validatedOptions, placeholders)
    : `_data/results/${placeholders.timestamp}`;

  const yamlData = yaml.stringify(fields);
  const base64YamlData = Base64.encode(yamlData);

  const defaultBranch = staticmanCommentsConfig?.branch || 'master';
  const branch = `commentworker_${commentId}`;

  // Suspect entries always go through a pull request, even when moderation is off
  const usePullRequest = moderation || isSuspect;

  if (usePullRequest) {
    await gh.createBranchOnRepository(branch, defaultBranch);
  }

  const filePath = `${directoryPath}/${filename}.yml`;
  const createCommentFileResponse = await gh.createFileOnRepository(
    filePath,
    commitMessage,
    base64YamlData,
    usePullRequest ? branch : defaultBranch
  );

  if (!createCommentFileResponse?.content) {
    console.error('Failed to create comment file', filePath, createCommentFileResponse);
    return errorResponse(c, 'FILE_CREATION_FAILED', 422);
  }

  if (usePullRequest) {
    const spamSection = isSuspect
      ? `:warning: **Flagged as likely spam:**\r\n\r\n${spamReasons
          .map(reason => `- ${reason}`)
          .join('\r\n')}\r\n\r\n---\r\n\r\n`
      : '';
    const pullRequestBody = Object.prototype.hasOwnProperty.call(
      staticmanCommentsConfig,
      'pullRequestBody'
    )
      ? handlePlaceholders(
          staticmanCommentsConfig.pullRequestBody,
          fields,
          validatedOptions,
          placeholders
        )
      : `Dear human,\r\n\r\nHere's a new entry for your approval. :tada:\r\n\r\nMerge the pull request to accept it, or close it to send it away.\r\n\r\n:heart: Your friend [comment-worker](https://github.com/zanechua/comment-worker) :muscle:\r\n\r\n---\r\n\r\n${objectToMarkdownTable(
          fields
        )}`;
    const title = isSuspect ? `[likely spam] ${commitMessage}` : commitMessage;

    const pullRequest = await gh.createPullRequestOnRepository(
      title,
      spamSection + pullRequestBody,
      branch,
      defaultBranch
    );

    if (!pullRequest?.number) {
      console.error('Failed to create pull request', pullRequest);
      return errorResponse(c, 'PULL_REQUEST_FAILED', 502);
    }

    if (isSuspect && !(await gh.addLabelsToIssue(pullRequest.number, [spamLabel]))) {
      console.error(`Failed to label pull request #${pullRequest.number}`);
    }
  }

  return c.json({ success: true }, 201);
});

app.onError((error, c) => {
  console.error(error);
  return errorResponse(c, 'INTERNAL_ERROR', 500);
});

// 404 for everything else
app.all('*', () => new Response('These are not the droids you are looking for', { status: 404 }));

export default app;
