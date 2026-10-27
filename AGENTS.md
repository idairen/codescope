# Repository Guidelines

## Project Structure & Module Organization

This workspace contains CodeScope: `src/` is the React UI, `server/` handles scanning and APIs, `shared/` contains contracts, `tests/` contains behavior tests, and `examples/` contains sample repositories. `skills/business-flow/` is a standalone model-independent skill; its Python helper and offline HTML assets must remain usable without the CodeScope application. `docs/business-flow/` contains its usage guide and generated example. No Git metadata is currently present.

Keep the root focused on project configuration and documentation. When adding code, use clearly named directories such as `src/`, `tests/`, and `docs/` where appropriate for the chosen stack. Store assets separately from executable code, and organize modules by responsibility.

## Build, Test, and Development Commands

Existing scripts include `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`, and `npm run format:check`. The standalone skill uses `npm run test:skill` and `npm run format:skill:check`; see `docs/business-flow/usage.md` for Python-only runtime commands. When introducing tooling, document exact installation, local development, build, and test commands in `README.md`. Provide repeatable scripts through the chosen package manager or build system. Do not document commands as supported until they work from a clean checkout.

## Coding Style & Naming Conventions

Follow the standard conventions of the language selected for the project. Configure a formatter and linter early, and let their configuration define indentation and formatting. Use descriptive names and consistent casing within each language. Keep modules focused and avoid unrelated formatting changes in functional patches.

## Testing Guidelines

Application tests use Node's test runner with tsx. Skill tests use Python unittest and Node's test runner with a simulated DOM; these do not prove browser rendering or live model behavior. No coverage threshold is established. Add suitable tests alongside the first implementation, using the selected framework's discovery and naming conventions. Cover externally observable behavior, error handling, and regressions. Document how to run the full suite and targeted tests; keep fixtures deterministic and free of credentials.

## Commit & Pull Request Guidelines

There is no Git history from which to infer commit conventions. Once Git is initialized, use concise, imperative commit subjects, such as `Add initial project configuration`. Keep commits scoped to one coherent change.

Pull requests should explain the problem, implementation, and verification performed. Link relevant issues and include screenshots for visible UI changes. Explicitly identify checks that were not run and any setup needed by reviewers.

## Security & Configuration

Never commit credentials, private data, or local environment files. Document required configuration with placeholder values, and add appropriate ignore rules when introducing tools or generated artifacts.
