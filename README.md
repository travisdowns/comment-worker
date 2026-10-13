# comment-worker

`comment-worker` is a Cloudflare worker that receives user-generated content and uploads it as data files to a GitHub and/or GitLab repository. In practice, this allows you to have dynamic content (e.g. blog post comments) as part of a fully static website, as long as your site automatically deploys on every push to GitHub and/or GitLab, as seen on GitHub Pages, GitLab Pages, Netlify and others.

Essentially it is a direct replacement for [staticman](https://github.com/eduardoboucas/staticman) and is mostly API compatible.

Please see [Issue #1](https://github.com/zanechua/comment-worker/issues/1) for more info

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zanechua/comment-worker)

# Usage

## Setup

Click on the Deploy with Workers button above and follow through the steps to finish the setup.

Create a GitHub app by going to [https://github.com/settings/apps](https://github.com/settings/apps) with the permissions of the following:

![GHA Permissions](https://github.com/zanechua/comment-worker/assets/4265429/a5b7e22d-fc15-4828-8289-b9de3958ee24)

Make sure to generate the private key and download the pem file.

Install the app into the repository you are intending to use with `comment-worker`

You need to declare the following variables in the Cloudflare worker variable settings

| key                      | example                                     | description                                                           |
|--------------------------|---------------------------------------------|-----------------------------------------------------------------------|
| GITHUB_APP_ID            | 123456                                      | App Id of GitHub App which will be committing to your repository      |
| GITHUB_APP_PRIVATE_KEY   | -----BEGIN PRIVATE KEY-----...              | Private Key of GitHub App which will be committing to your repository |
| GITHUB_ORGANIZATION_SLUG | org                                         | Organization name or username that the repository belongs to          |
| GITHUB_REPOSITORY_SLUG   | repo-name                                   | Repository name                                                       |
| GITHUB_REPOSITORY_BRANCH | main                                        | Branch where the site configuration lies                              |
| CW_ALLOWED_ORIGINS       | https://example.com,https://www.example.com | Allowed origins that can send a request to the comment-worker         |
| CW_DEBUG                 | false                                       | Turning debug mode on or off                                          |
| GITHUB_TOKEN             | ghp_...                                     | Optional: personal access token (e.g. of a bot account) used instead of the GitHub App |
| TURNSTILE_SECRET_KEY     | 0x4AAA...                                   | Optional: Cloudflare Turnstile secret key; enables Turnstile spam checks |
| CW_HONEYPOT_FIELD        | hp                                          | Optional: name of the honeypot field (default `hp`)                   |
| GITHUB_API_URL           | https://api.github.com                      | Optional: GitHub API base URL, mainly for testing against a mock      |

## Staticman compatibility

Entries are written in the same shape staticman produced, so existing staticman data and templates keep working:
`_id`, then `_parent` (from `options[parent]`), then the fields, then `generatedFields` (only the `date` type is
supported, with `timestamp`, `timestamp-seconds` or `iso8601` formats). `{@timestamp}` in `filename`/`path` is in
milliseconds. Optional fields left empty are stored as `''` rather than transformed. Errors are returned as JSON
`{ "success": false, "errorCode": "..." }`.

## Spam handling

Suspected spam is never dropped: it is always delivered as a pull request (even when `moderation` is off), with the
title prefixed by `[likely spam]`, a `likely-spam` label and the reasons listed in the PR body. A submission is
suspect when:

- the honeypot field (`CW_HONEYPOT_FIELD`) is non-empty, or
- `TURNSTILE_SECRET_KEY` is set and the request's `cf-turnstile-response` token is missing or fails verification.

The `GITHUB_APP_PRIVATE_KEY` needs to be in pkcs8 format, convert the key to pkcs8 format by following the `openssl` command below and input the private key with `\n` as the separators for the line breaks.

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in private-key.pem -out private-key-pkcs8.key
```

E.g. `GITHUB_APP_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEvQ...`

Add `staticman.yml` to the root of your repository on `GITHUB_REPOSITORY_BRANCH`. [Example](https://github.com/zanechua/website/blob/master/staticman.yml)

## API

POST `https://your-worker-subdomain.workers.dev/api/handle/form`.

Support both `application/x-www-form-urlencoded` and `application/json` content types (must be specified in the `Content-Type` header).

<details>
<summary><b>JSON example</b></summary>

```json
{
  "fields": {
    "name": "John Doe",
    "email": "johndoe@example.com",
    "message": "Hello world!",
    "slug": "your/page/slug"
  },
  "options": {
    "url": "https://example.com"
  }
}
```

</details>

<details>
<summary><b>Form example</b></summary>

```html
<form
  submit="https://your-worker-subdomain.workers.dev/api/handle/form"
  method="POST"
>
  <div>
    <label for="fields[name]">Name</label>
    <input type="text" name="fields[name]" value="John Doe" required>
  </div>
  <div>
    <label for="fields[email]">Email</label>
    <input type="email" name="fields[email]" value="" required>
  </div>
  <div>
    <label for="options[url]">Website</label>
    <input type="url" name="options[url]" placeholder="https://example.com">
  <div>
    <label for="fields[message]">Message</label>
    <textarea name="fields[message]" required>Hello world!</textarea>
  </div>
  <div style="display: none">
    <label for="fields[slug]">Slug</label>
    <input type="text" name="fields[slug]" value="your/page/slug" readonly>
  </div>

  <button type="submit">Submit</button>
  <button type="reset">Reset</button>
</form>
```

</details>

# Manual Deployment

We're using Cloudflare workers + wrangler to handle the deployments, we have to use wrangler due to the features we are using that requires wrangler to package the bundle up.

You need to run the deploy command with the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` variables before running the command.

You can use the `example config` section in the `wrangler.toml` for easier deployment to your cloudflare worker, just uncomment the section and replace with your own values

```bash
CLOUDFLARE_ACCOUNT_ID=abc CLOUDFLARE_API_TOKEN=abc pnpm wrangler deploy
```

# Development Setup

Follow the setup section above first.

Create a `.dev.vars` at the root of the repository and the format should follow the `dotenv` format of `KEY=VALUE` and a new line for each of the environment variables

Run the following to load up the app
```bash
pnpm install
pnpm dev
```
