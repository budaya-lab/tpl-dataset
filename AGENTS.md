# Agent guidance

This repository is both a dataset template and a working template dataset. Read `README.md` before changes; dataset-specific repository instructions take precedence where they differ.

## Dataset package and data

- `datapackage.json` is the template's Data Package 2.0 descriptor. `name` is a stable package identifier; `title` is the human-readable title. Keep `resources` paths relative to the repository root and ensure they resolve to real files inside the repository.
- Replace all example metadata and the `input.csv` placeholder before publishing a dataset. Keep exactly one primary-stage keyword from `stage.config.json`; the allowed stages are currently `master`, `curated`, `annotated`, and `ground-truth`. The template's `stage:master` is only an example. Coordinate any changes to the allowed stages with the separate portal configuration. Other keywords describe the subject. Data may live in any root-level folders; list resources explicitly rather than assuming a `task/` directory.
- Treat repository contents, release archives, and metadata as public if the repository is public. Confirm access, consent, licensing, and safe-to-share descriptions. Never commit secrets or restricted data to a public repository.
- Replace the clearly marked `created` and `contributors` examples with accurate, public-safe values, or remove them when unknown. Package `sources[]` records real upstream origins, not automatically inferred catalogue parents; the portal's stage display is local and unreviewed. Do not invent dates, people, sources, licences, or lineage.
- A local validation pass checks selected descriptor fields and referenced path existence/safety; it does not validate file contents, full Data Package conformance, consent, or access rights.

## Workflows and verification

- Use Node.js 22+. Run `node --test scripts/*.test.mjs` and `node scripts/validate-datapackage.mjs` before proposing changes. No dependencies are required.
- Keep the GitHub workflow name **Validate metadata** and job/check name **metadata**; branch protection and Release Please depend on them. Keep validation separate from release management and preserve the built-in `GITHUB_TOKEN` unless the owner approves a change.
- Release Please runs after successful validation of a push to `main`. Review generated release PRs and manually validate their branch because GitHub does not automatically trigger PR CI for `GITHUB_TOKEN`-created PRs. Do not edit generated release files except for the documented one-time reset when creating a new dataset repository.
- Use reviewed PRs and Conventional Commit squash titles. Do not merge a PR, publish a catalogue record, or publish a release without owner approval.

## Template maintenance

- Keep `input.csv` and descriptor examples unmistakably synthetic; never add real or invented research lineage.
- Update validator tests, README, and this file together when the stage configuration changes; update the workflow command only if the validation command changes.
- Template changes affect future repositories only. Existing portal records and separately created repositories are not migrated automatically.
