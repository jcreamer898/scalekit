import { getJSON } from "@scalekit/http";

/**
 * @param {object} options
 * @param {string} [options.name]
 * @param {string} [options.organization]
 * @param {string} [options.project]
 * @param {string} [options.feed]
 * @param {string} [options.version]
 * @returns
 */
export function getPackageVersion({ name, organization, project, feed, version }) {
  return new Promise(async (resolve, reject) => {
    try {
      let data;
      if (version) {
        data = await getJSON(
          `https://feeds.dev.azure.com/${organization}/${project}/_apis/packaging/feeds/${feed}/packages?packageNameQuery=${name}&$top=100&includeAllVersions=true&getTopPackageVersions=true`,
        );
      } else {
        data = await getJSON(
          `https://feeds.dev.azure.com/${organization}/${project}/_apis/packaging/feeds/${feed}/packages?packageNameQuery=${name}`,
        );
      }
      
      const pkg = data.value[0];
      const lastVersion = version ? pkg.versions.find((/** @type{PackageVersion} */v) => v.version === version) : pkg.versions[0];
      
      const prov = await getJSON(
        `https://feeds.dev.azure.com/${organization}/${project}/_apis/packaging/feeds/${feed}/packages/${pkg.id}/versions/${lastVersion.id}/provenance`,
      );

      resolve({
        version: lastVersion.version,
        build: prov.provenance.data
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * @typedef {object} PackageVersion
 * @property {string} id - The unique identifier of the package version.
 * @property {string} normalizedVersion - The normalized version of the package.
 * @property {string} version - The version of the package.
 * @property {boolean} isLatest - A flag indicating if this is the latest version of the package.
 * @property {boolean} isListed - A flag indicating if this version of the package is listed.
 * @property {string} storageId - The storage identifier of the package version.
 * @property {Array<object>} views - An array of view objects related to the package version.
 * @property {string} publishDate - The date when the package version was published.
 */

/**
 * @typedef {object} VersionsReponse
 * @property {Array<PackageVersion>} versions
 */

/**
 * @param {object} options
 * @param {string} [options.name]
 * @param {string} [options.organization]
 * @param {string} [options.project]
 * @param {string} [options.feed]
 */
export function getPackageVersions({ name, organization, project, feed }) {
  return new Promise(async (resolve, reject) => {
    try {
      const data = await getJSON(
        `https://feeds.dev.azure.com/${organization}/${project}/_apis/packaging/feeds/${feed}/packages?packageNameQuery=${name}&$top=20&includeAllVersions=true&getTopPackageVersions=true`,
      );
      const pkg = data.value[0];

      resolve({
        versions: pkg.versions,
      });
    } catch (e) {
      reject(e);
    }
  });
}