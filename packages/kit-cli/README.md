# fast-exec

`npx` is really slow in a large monorepo.

This is way faster.

Also, there are certain tools, like a custom built package manager, that you may need _before_ you have actually installed anything. This tool can go grab a package with a bundle from a registry, and unzip it _before_ the install happens.

Create a `scalekit.json` file in the root of your repository.

```json
{
  "registries": {
    "ado": "https://jcreamer.pkgs.visualstudio.com/_packaging/jcreamer/npm/registry/"
  },
  "tools": [{
    "name": "@jcreamer898/midgard-yarn-strict",
    "version": "1.2.5"
  }, {
    "name": "@jcreamer898/some-tool",
    "version": "1.0.1",
    "registry": "ado"
  }]
}
```

Then when you run `kit install`, it will download the packages and unzip them directly into `./.tools`.

You can then run them with `kit run <binary-name>`.
