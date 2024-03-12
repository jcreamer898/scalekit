# scalekit

A monorepo of tools that helps sublinearly scale large monorepos.

## @scalekit/artifacts

There are a few utilities in here.

This one can get the version of a package from Azure DevOps registries.

```bash
yarn aza get-version @foo/bar --organization foo --project bar --feed foofeed
```

This one can download and unzip a package from any registry.

```bash
yarn aza get-tarball --name jquery --registry https://registry.npmjs.org --version 3.6.0 --destination ./vendor
```
