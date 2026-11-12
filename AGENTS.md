# Agent guidance

This repository is both a dataset template and a working template dataset. Read `README.md` before changes; dataset-specific repository instructions take precedence where they differ.

## Dataset package and data

- `datapackage.json` is the template's Data Package 2.0 descriptor. Require package `name`, nonblank `title` and `description`, stage-bearing `keywords`, and nonempty `resources`. Each resource requires a unique `name`, nonblank `title` and valid `path`. Keep `resources` paths relative to the repository root and ensure they resolve to real files or directories inside the repository. Directory resources cover their contents and must omit `format`.
- Replace all example metadata and the `input.csv` placeholder before publishing a dataset. Keep exactly one primary-stage keyword from `stage.config.json`; the allowed stages are currently `master`, `curated`, `annotated`, and `ground-truth`. The template's `stage:master` is only an example. Coordinate any changes to the allowed stages with the separate portal configuration. Other keywords describe the subject. Data may live in any root-level folders; list resources explicitly rather than assuming a `task/` directory.
- Treat repository contents, release archives, and metadata as public if the repository is public. Confirm access, consent, licensing, and safe-to-share descriptions. Never commit secrets or restricted data to a public repository.
- Replace the clearly marked `created` and `contributors` examples with accurate, public-safe values, or remove them when unknown. Package `sources[]` records real upstream origins, not automatically inferred catalogue parents; the portal's stage display is local and unreviewed. Do not invent dates, people, sources, licences, or lineage.
- Optional root `buckets.csv` is a public summary even for a restricted dataset. Use standard resource fields (`name: buckets`, `path: buckets.csv`, `format: csv`), not custom metadata. Validate two columns (label header, then `count`), unique nonempty text labels, and non-negative safe-integer counts. CI checks it even when undeclared; reject invalid CSV, symlinks, and files over 1,000,000 bytes. Owners must review labels/counts for public disclosure. Portal import requires a suitable release and copies only the summary on confirmed apply.
- Optional resource `count` is a lab extension for item totals, never bytes: CSV data rows, JSON top-level items, or nonhidden files recursively in a directory. It must be a non-negative safe integer; omit unknown counts. Dataset Steward computes single-path counts; the template validates only their type/range, not accuracy. Do not sum counts across resources that may describe the same items.
- Optional metadata must be valid when supplied: `created` is an RFC 3339 date-time; contributors and licenses are nonempty arrays of nonempty objects; sources may be an empty array. Check supplied known entry text fields, contributor roles and license name/path requirements. Do not fetch metadata references or infer missing values. See `docs/reference.md` for the contract.
- Validation must never write files or mutate the supplied descriptor. Counting, repair and README generation belong to downstream tools. A local validation pass checks selected descriptor fields, referenced path existence/safety, and optional bucket contents; it does not inspect directory contents or other resource contents, or validate full Data Package conformance, consent, or access rights.

## Workflows and verification

- Use Node.js 22+. Run `node --test scripts/*.test.mjs` and `node scripts/validate-datapackage.mjs` before proposing changes. No dependencies are required.
- Keep the GitHub workflow name **Validate metadata** and job/check name **metadata**; branch protection and Release Please depend on them. Keep validation separate from release management and preserve the built-in `GITHUB_TOKEN` unless the owner approves a change.
- Release Please runs after successful validation of a push to `main`. Review generated release PRs and manually validate their branch because GitHub does not automatically trigger PR CI for `GITHUB_TOKEN`-created PRs. Release Please updates `datapackage.json`'s `version` through the JSON `extra-files` entry in `release-please-config.json`; keep the field as a semantic-version string without a `v` prefix. Do not edit that version or generated release files except for the documented one-time reset when creating a new dataset repository (empty manifest, descriptor version `0.0.0`, and removal of the inherited changelog).
- Use reviewed PRs and Conventional Commit squash titles. Do not merge a PR, publish a catalogue record, or publish a release without owner approval.

## Template maintenance

- Keep `input.csv` and descriptor examples unmistakably synthetic; never add real or invented research lineage.
- Update validator tests, README, and this file together when the stage configuration changes; update the workflow command only if the validation command changes.
- Template changes affect future repositories only. Existing portal records and separately created repositories are not migrated automatically.
