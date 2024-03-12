import { getJSON } from "@scalekit/http";

/**
 *
 * @param {object} options
 * @param {string} [options.name]
 * @param {string} [options.organization]
 * @param {string} [options.project]
 * @param {string} [options.feed]
 * @returns
 */
export function getPackageVersions({ name, organization, project, feed }) {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await getJSON(
        `https://feeds.dev.azure.com/${organization}/${project}/_apis/packaging/feeds/${feed}/packages?packageNameQuery=${name}`,
      );

      if (response.statusCode === 401) {
        reject(
          new Error(
            `Failed to get package versions for ${name}, check your token.`,
          ),
        );
      }

      let data = "";
      response.on("data", (chunk) => {
        data += chunk.toString();
      });

      response.on("end", () => {
        resolve(JSON.parse(data.toString()).value[0].versions[0].version);
      });
    } catch (e) {
      reject(e);
    }
  });
}
