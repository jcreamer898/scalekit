import path from "path";
import IgnoreDynamicRequire from "webpack-ignore-dynamic-require";
import webpack from "webpack";

export default () => {
  /**
   * @type {import('webpack').Configuration}
   */
  const config = {
    mode: "production",
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
      moduleIds: "deterministic",
    },
    plugins: [
      new IgnoreDynamicRequire(),
      new webpack.DefinePlugin({
        "process.env.NPM_CONFIG_PRODUCTION": JSON.stringify("false"),
        "process.env.YARN_PRODUCTION": JSON.stringify("false"),
      }),
    ],
  };

  return config;
};
