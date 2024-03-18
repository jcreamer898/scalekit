# typescript-auto-references

Maintaining Typescript monorepo is hard.

One of the more difficult tasks is making sure it's easy to navigate the code in VSCode.

That's where this package helps.

There's a script in the package, `"ts-auto-refs"` you can add to your monorepo's `"postinstall"` script which will automatically:

* Find all the `"@types"` packages in _each_ package in your monorepo, and add them to the `"types"` array in the `tsconfig.json`
* Update the package to `"composite": true`
* Create a `tsconfig.references.json` file in each package
* Automatically update the 👆 by looking at each package's `"dependencies"` and `"devDependencies"` for references to internal packages
* Therefore, your monorepo will be much easier to navigate!
