import path from "path";
import IgnoreDynamicRequire from "webpack-ignore-dynamic-require";

export default () => {
  /**
   * @type {import('webpack').Configuration}
   */
  const config = {
    mode: "development",
    target: "node",
    entry: {
      "midgard-yarn-strict": "./src/index.ts",
    },
    output: {
      filename: "[name].bundle.js",
      path: path.join(__dirname, "dist"),
      pathinfo: false,
    },
    devtool: false,
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "ts-loader",
            },
          ],
        },
      ],
    },
    resolve: {
      extensions: [".js", ".tsx", ".ts", ".json"],
    },
    node: {
      // https://codeburst.io/use-webpack-with-dirname-correctly-4cad3b265a92
      __dirname: false,
    },
    optimization: {
      moduleIds: "natural",
    },
    plugins: [new IgnoreDynamicRequire()],
  };

  return config;
};
