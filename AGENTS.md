# Repository Guidelines

## Project Structure & Module Organization

This is a uni-app application based on uni-starter, with Vue 3 selected in `manifest.json`.

- `App.vue` and `main.js` initialize the application and localization.
- `pages/` contains list, search, grid, account, and agreement screens (`.vue` and `.nvue`). Register routes and platform options in `pages.json`.
- `components/` holds shared UI; `common/` contains application initialization and platform helpers.
- `lang/` contains English and Simplified Chinese translations; `static/` stores images, icons, and fonts. Global styling lives in `uni.scss`.
- `uni_modules/` contains bundled uni UI, authentication, and cloud modules, including module-specific cloud functions and database definitions. Keep module edits focused and explain them in PRs.
- `uniCloud-alipay/` contains project-level cloud resources and a database JQL query.
- `ui-preview/` contains the approved portrait UI prototype and its assets; it is separate from the uni-app entry point.

## Build, Test, and Development Commands

- `npm ci`: install the locked npm dependencies, currently `qrcodejs2`.
- Open the repository in HBuilderX. Use **Run** to launch the web target or a configured mini-program/device target.
- Use HBuilderX **Publish** to build the intended release target; verify its settings in `manifest.json` first.

`package.json` defines no development, build, lint, or test scripts. Do not assume `npm run build` or `npm test` works. Configure the associated uniCloud service before exercising cloud-backed features.

## Coding Style & Naming Conventions

Match the surrounding file: application JavaScript and Vue files generally use tabs, single-quoted strings, and camelCase identifiers; semicolon usage varies. Follow existing component paths such as `components/refreshBox/refreshBox.vue` and page paths such as `pages/ucenter/settings/settings.vue`. Use `@/` for root-relative imports. Preserve uni-app conditional compilation directives (`#ifdef`, `#ifndef`) and `.nvue` platform constraints. No formatter or linter configuration is provided.

## Testing Guidelines

No automated test suite or coverage threshold is configured. Manually verify affected screens, navigation, authentication, and cloud calls in HBuilderX. Check each affected platform branch and localization changes. Include the target, steps, and results in the PR.

## Commit & Pull Request Guidelines

Existing Git history is too limited to establish a commit convention. Use concise, imperative subjects, for example `Fix search suggestion binding`. PRs should describe the change, link relevant issues, list validation, and include screenshots for UI changes.

## Security & Configuration

Keep authentication secrets and provider credentials out of commits. Configure uni-id through `uni-config-center/uni-id/config.json` in the cloud configuration module; the README documents missing configuration and `tokenSecret` errors. Review platform app IDs and deployment settings before publishing.
