# Dataset reference

[Back to setup](../README.md)

## Metadata and stages

`datapackage.json` uses [Data Package 2.0](https://datapackage.org/standard/data-package/) plus lab-specific conventions:

| Field | Rule |
| --- | --- |
| `name` | Required stable lowercase package identifier. |
| `title`, `description` | Required nonblank text. |
| `resources` | Required nonempty array. Each resource needs a unique lowercase `name`, nonblank `title` and local, repository-relative file or directory `path`. Paths must resolve inside the repository. |
| `keywords` | Exactly one nonempty `task:`, `project:` and controlled `stage:` keyword. Other nonblank keywords are allowed. |
| `created` | Optional RFC 3339 date-time, including timezone offsets and fractional seconds. Omit if unknown. |
| `contributors` | Optional nonempty array of nonempty objects. Supplied `roles` must be a nonempty array of nonblank strings. |
| `licenses` | Optional nonempty array of objects, each with a nonblank `name` or `path`. Names use letters, digits, dots, underscores or hyphens. |
| `sources` | Optional array of nonempty objects; an empty array is allowed. |
| `version` | Semantic-version string without a `v` prefix. Managed by Release Please after the initial reset. |

Optional does not mean unchecked: supplied values must satisfy the rules above.
Known text fields in contributor, licence and source entries must be nonblank strings.
Metadata paths are references: validation does not open or fetch them. These checks do
not verify licence authority, source availability, full Data Package conformance or
permission to publish. Include only accurate, public-safe metadata; omit unknown values.

Validation never changes files or the supplied descriptor. Counting, repairs and README
generation belong to downstream tools. Descriptors missing required titles, description
or task/project/stage keywords fail. Supply accurate values; do not infer them from
folder names. Existing dataset repositories are not updated automatically.

Choose the dataset's **primary stage**, not a required sequence:

| Keyword | Use for |
| --- | --- |
| `stage:master` | Source-of-record data. |
| `stage:curated` | Cleaned or transformed data. |
| `stage:annotated` | Labelled or enriched data. |
| `stage:ground-truth` | Data for evaluating or fine-tuning models. |

### Dataset stages and derivation

```mermaid
flowchart LR
    masterA["Master A"] --> curatedA["Curated A"]
    masterB["Master B"] --> curatedA["Curated A"]
    masterB["Master B"] --> curatedB["Curated B"]

    curatedA --> annotatedA["Annotated A"]
    curatedB --> annotatedB["Annotated B"]
    curatedB --> annotatedC["Annotated C"]

    annotatedA --> gtA["Ground truth A"]
    annotatedB --> gtA["Ground truth A"]
    annotatedC --> gtB["Ground truth B"]
```

Arrows show possible derivations, not required steps or confirmed lineage. A dataset may combine several inputs or processing steps. Document only verified sources and methods; a stage does not establish lineage. Data Package `sources[]` and the portal's `derivedFrom` catalogue links are separate. Onboarding does not infer parent links.

### Validation dependency

`pnpm validate` runs `penjaga-validate` from the pinned compiled
`@penjaga/validator` v2.0.0 GitHub release
archive. Code and policy come from the same package; no compiler or sibling
checkout is needed to run it. TypeScript and Node types check the template's
initialization script and initialization/release tests. See the [Penjaga API and policy](https://github.com/budaya-lab/penjaga/tree/v2.0.0/packages/validator).
The template uses the published `penjaga-validator-2.0.0.tgz` archive, not a source
checkout or an unreleased package.
Do not copy shared rules into this repository. Dataset-local `dataset.config.json`
or `stage.config.json` files cannot override the installed policy.

To upgrade:

1. Review the Penjaga release, policy changes and Node requirements. Choose its
   actual compiled `penjaga-validator-VERSION.tgz`, not a generated source archive.
   Keep package imports and CLI calls aligned with the selected release.
2. Update the exact release URL in `package.json`, then run
   `pnpm install --ignore-scripts` to update `pnpm-lock.yaml`. Preserve normal
   lockfile integrity; never use moving branches or overwrite a release asset.
3. Run the [setup checks](../README.md#5-validate-release-and-catalogue) and
   `pnpm audit --audit-level=high`, then submit the manifest and lockfile together
   for review. Keep lifecycle scripts disabled through `pnpm-workspace.yaml`.

When migrating an existing dataset, remove its old validator scripts and local
policy files, and add accurate task/project/stage keywords if missing. Do not
infer metadata. This template change does not migrate other repositories or
publish portal records.

## Resource counts and directories

Use `resources[].count` for item totals, not storage size. It is an optional integer from `0` to `9007199254740991`. Omit unknown or unsupported counts; `0` means empty.

| Resource | `count` means |
| --- | --- |
| CSV | Data rows, excluding the header. |
| JSON | Top-level array items or object members. |
| Directory | Files recursively, excluding hidden files and hidden directories. |

Dataset Steward recomputes counts for these single-path resources. Template validation checks the declared count's type and range, not its accuracy. Multi-path resources and other file types have no computed count. Do not sum resource counts into a dataset total: a CSV and a directory may describe the same items.

A directory resource covers its contents without listing every file. Prefer a trailing slash and **omit `format`**, rather than using `dir` or `directory`. Synthetic example:

```json
{
  "name": "annotations",
  "title": "Annotations",
  "path": "annotations/",
  "count": 120
}
```

Directory paths and `count` are lab extensions. Standard Data Package [`format`](https://datapackage.org/standard/data-resource/#format) describes a file format such as `csv`; [`bytes`](https://datapackage.org/standard/data-resource/#bytes) records storage size. Directory validation checks the referenced path, not every file inside it. Portal onboarding remains subject to its own resource rules; this does not automatically publish directory contents.

## Dataset Steward

Follow [Dataset Steward's README](https://github.com/budaya-lab/dataset-steward#readme) for its commands and requirements. README generation replaces everything above `<!-- notes -->` and preserves text below it; move handwritten notes there first.

## Optional public bucket summary

Add `buckets.csv` at the repository root only if you want a public summary. **Labels and counts are public even for restricted datasets.** Review disclosure, consent and permissions first. No sample summary is included in the template.

Synthetic example:

```csv
category,count
example-a,10
example-b,0
```

Requirements:

- Exactly two columns: a nonempty label header other than `count`, then `count`.
- At least one data row; labels must be nonempty and unique after trimming.
- Counts must be integers from `0` to `9007199254740991`.
- Maximum size: 1,000,000 bytes. No symlinks or directories.

Quoted labels, UTF-8 BOM and LF/CRLF line endings are supported. Numeric-looking labels such as `001` stay text.

Declare it using standard `resources[]` fields:

```json
{
  "name": "buckets",
  "path": "buckets.csv",
  "format": "csv",
  "title": "Public bucket summary"
}
```

The reserved name `buckets` must refer to this root CSV. Local validation and CI check the file whenever present, even if undeclared.

Portal onboarding reads it from a suitable published SemVer release reachable from `main`. On confirmed apply, it copies the validated summary and displays a bar chart. Without a suitable release, no summary is imported. Copied summaries are public in the portal repository even for draft catalogue records; restricted data access stays unchanged.

## Releases

### Initialize a new dataset

After creating a repository with **Use this template**, fully clone the new
repository and run this at its root, before making new commits:

```sh
pnpm init:dataset
```

This manual command needs Node.js 24+, pnpm 12.x and Git, but no dependency
installation. It empties `.release-please-manifest.json`, changes only the root
`datapackage.json` version to `"0.0.0"`, and removes the inherited `CHANGELOG.md`.
Other descriptor bytes, data, README notes, Git commits and remotes stay unchanged.
An already-clean repository is a no-op. No prompts or metadata inference are
included; any future interactive setup must be a separate command.

Cleanup requires a non-template origin, one initial commit, full local history
and no local tags. It refuses changed release versions/manifests, edited
changelogs, malformed JSON and linked release files before writing. Do not use it
to reset an established dataset. File-system failures can leave partial cleanup;
inspect the release files and fix permissions before retrying. It does not run
during install, validation or CI; validation remains read-only.

### Enable releases once per repository

- Require reviewed PRs and the `metadata` check on `main`; restrict direct pushes. Any successful validated push to `main` can trigger release management.
- Review visibility, consent and access. GitHub's automatic source archives include tracked data; public repositories expose those files. Keep commit subjects and release descriptions public-safe.
- The workflow uses the built-in `GITHUB_TOKEN` with Contents, Issues and Pull requests write permissions. No extra secret is needed. If policy requires it, allow Actions to create PRs in **Settings → Actions → General**.

Run the [one-time cleanup](#initialize-a-new-dataset) before starting dataset work.
Keep the version field: the first release PR replaces `"0.0.0"` with `"0.1.0"`.

### Create a release

1. Use Conventional Commit squash PR titles: `feat(data): add annotated pages` (minor), `fix(data): correct labels` (patch), or `feat(data)!: change annotation schema` (major). A `BREAKING CHANGE:` footer also signals a major change.
2. After **Validate metadata** succeeds on a current push to `main`, Release Please opens or updates a release PR when a bump is warranted. Docs/chore-only changes normally do not trigger one. Failed, stale, PR and tag CI results do not trigger releases.
3. Review the release PR. **Manually run Validate metadata on its branch**: GitHub does not automatically trigger PR CI for PRs created with `GITHUB_TOKEN`. Rerun after branch updates and confirm the result satisfies required checks.
4. With owner approval, merge the release PR to create the tag and GitHub Release. Ordinary feature merges do not publish a release immediately.

Release Please keeps `datapackage.json`'s version, the manifest and changelog aligned. Do not edit them manually except for the initial reset. The descriptor uses the [JSON extra-file updater](https://github.com/googleapis/release-please/blob/v17.3.0/docs/customizing.md#updating-arbitrary-json-files) in [`release-please-config.json`](../release-please-config.json).

## Catalogue boundaries

Follow the [portal onboarding guide](https://github.com/budaya-lab/data-portal#add-a-dataset); release and catalogue publication require separate human review.

- Public repositories: the portal maps the package title to its display name, derives publisher/repository links from GitHub, and links reviewed released resources. It does not copy ordinary data files.
- Restricted repositories: publish only safe metadata and a credential-free HTTPS landing-page link. Never expose underlying restricted paths or files. The only file-copy exception is an explicitly public bucket summary.
- Template changes affect future repositories, not existing datasets or catalogue records.
