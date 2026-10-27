# Repository Guidelines

## Project Structure & Module Organization

This is a uni-app application based on uni-starter, with Vue 3 selected in `manifest.json`.

- `App.vue` and `main.js` initialize the application and localization.
- `pages/` contains list, search, grid, account, and agreement screens (`.vue` and `.nvue`). Register routes and platform options in `pages.json`.
- `components/` holds shared UI; `common/` contains application initialization and platform helpers.
- `lang/` contains English and Simplified Chinese translations; `static/` stores images, icons, and fonts. Global styling lives in `uni.scss`.
- `uni_modules/` contains bundled uni UI, authentication, and cloud modules, including module-specific cloud functions and database definitions. Keep module edits focused and explain them in PRs.
- `uniCloud-alipay/` contains project-level cloud resources and a database JQL query.
- `server/` contains the persistent match runner, HTTP/admin APIs, model adapters, archive handling, and Node tests. Shared rules live in `common/xiangqi/`.
- `ui-preview/` contains the approved portrait UI prototype and its assets; it is separate from the uni-app entry point.

## Build, Test, and Development Commands

- `npm ci`: install locked frontend and backend workspace dependencies.
- `npm run setup`: create ignored local secrets and cloud gateway configuration without overwriting existing files.
- `npm run server`: start the match/API service; `npm run dev:h5` starts the frontend with an API proxy.
- `npm run build:h5`, `npm run build:mp-weixin`, `npm run build:mp-toutiao`: build each supported target. Mini programs require `VITE_API_BASE`.
- `npm test`: run Node rule, persistence, adapter, and HTTP integration tests.

Configure the associated uniCloud service before live mode. Demo mode uses isolated local persistence and never calls paid models. HBuilderX remains available for platform tooling and deployment.

## Coding Style & Naming Conventions

Match the surrounding file: application JavaScript and Vue files generally use tabs, single-quoted strings, and camelCase identifiers; semicolon usage varies. Follow existing component paths such as `components/refreshBox/refreshBox.vue` and page paths such as `pages/ucenter/settings/settings.vue`. Use `@/` for root-relative imports. Preserve uni-app conditional compilation directives (`#ifdef`, `#ifndef`) and `.nvue` platform constraints. No formatter or linter configuration is provided.

## Testing Guidelines

Tests use `node:test` in `server/test/*.test.mjs`; no coverage threshold is configured. Preserve tests for legal moves, save-before-publish, recovery, version conflicts, imports and credential redaction. Verify affected UI and platform branches, and distinguish successful compilation from real-device or cloud verification.

## Commit & Pull Request Guidelines

Existing Git history is too limited to establish a commit convention. Use concise, imperative subjects, for example `Fix search suggestion binding`. PRs should describe the change, link relevant issues, list validation, and include screenshots for UI changes.

## Security & Configuration

Keep authentication secrets and provider credentials out of commits. Configure uni-id through `uni-config-center/uni-id/config.json` in the cloud configuration module; the README documents missing configuration and `tokenSecret` errors. Review platform app IDs and deployment settings before publishing.
