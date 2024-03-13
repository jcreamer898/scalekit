# midgard-yarn-strict

midgard-yarn-strict is a fast package manager based on pnpm and yarn. The
goal of MYS is to use npm so we can lean on the npm team to deliver a first
class support for our package manager.

midgard-yarn-strict is a fork of
[midgard-yarn](https://www.npmjs.com/package/midgard-yarn), which is itself a
fork of [yarn v1](https://www.npmjs.com/package/yarn).

## Improvements over yarn

- _[reliability]_ retry on more errors.
- _[performance]_ detect abnormally long requests and when detected create
  racing requests.
- _[performance]_ use workers to copy files from cache to node_modules.
- _[performance]_ optimize cycle-detection algorithm from o(n2) to o(n.log(n)).
- _[feature]_ add support for --frozen-lockfile in monorepos.
- _[bug fix]_ yarn would not properly remove scoped package from `node_modules`
  after uninstalling this dependency.
- _[performance and reliability]_ optimize creation of bin scripts for large
  repos.

## Improvements over [midgard-yarn](https://www.npmjs.com/package/midgard-yarn)

- midgard-yarn-strict implementes the
  [isolated-mode npm's RFC](https://github.com/npm/rfcs/blob/main/accepted/0042-isolated-mode.md).
  This brings the following benefits:
  - _scoped install_: unrelated workspaces will not impact your installation
    time.
  - _performance_: isolated-mode allows for a maximal de-duplication of
    dependencies, which leads to lower installation time.
  - _incremental installation_: the performance of the installation depends only
    on packages that have never been installed before. This means that switching
    back and forth between two branches is very fast.

## Usage

### Install

Instead of `yarn install`, run

```bash
$ npx midgard-yarn-strict
```

The installation flags supported by yarn are not supported by the CLI but some
are still supported via the yarn config file.

Optionally a scope can be given:

```bash
$ `npx midgard-yarn-strict "build-tools-*"`
```

This will install the dependencies of the local packages matching the glob
provided.

By default, midgard-yarn-strict does incremental installs by storing a `.hash`
in each `node_modules` directory.

If you want to run without leveraging incremental, you can run with the
`--skip-cache` flag, or alternatively, you can simply
`rm -rf path/to/packages/*/node_modules/.hash`.

### Upgrade or add a dependency

Manual edits to the package.json files is the only current supported way to
manage dependencies, no CLI tool is available yet.

### yarn link

Not supported yet.

### yarn run

The yarn-run command is not affected by midgard-yarn-strict, so you can still
run `yarn test` for example.

## Configuration

`midgard-yarn-strict` allows you to declare dependencies on behalf of external
packages, this is useful when external packages forgot to declare all their
dependencies.

In the example below, webpack with a version matching "^4.0.0" will be installed
as if it had declared a dependency on webpack-cli.

### Using package.json

```javascript
{
  // rest of package.json
  "extraDependencies": {
    "webpack": {
      "^4.0.0": {
        "dependencies": {
          "webpack-cli": "^4.0.0"
        }
      }
    }
  }
}
```

### Using extraDependencies.json

```javascript
{
  "webpack": {
    "^4.0.0": {
      "dependencies": {
        "webpack-cli": "^4.0.0"
      }
    }
  }
}
```

### ENV VARIABLES

#### MYS_VERBOSE_FETCH

Output extra information to diagnose fetch issues.

#### MYS_MAX_FEED_CONNECTIONS

Maximum simultaneous connections to the npm feed

#### MYS_MAX_BLOB_STORAGE_CONNECTIONS

Maximum simultaneous connections to the blob storage (per domain).

#### YARN_CACHE_FOLDER

Customize location of cache folder. Can be relative of absolute path.

#### YARN_MEMORY_CACHE

Do not write packages to cache.

## Prior art

This package manager is built on the learnings brought by npm, yarn and pnpm.
