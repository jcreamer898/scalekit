import fs from "fs";
import zlib from "zlib";
import path from "path";
import { parseTarball, toSharedArrayBuffer } from "@scalekit/tar-utils";
import { getTarball } from "@scalekit/http";


/**
 * @typedef {object} PackageTarball
 * @property {string} registry
 * @property {string} name
 * @property {string} version
 * @property {string} destination
 * @property {string[]} files
 */

/**
 *
 * @param {object} options
 * @param {string} options.registry
 * @param {string} options.name
 * @param {string} options.version
 * @param {string} options.destination
 * @returns {Promise<PackageTarball>}
 */
export function getPackageTarball({ registry, name, version, destination }) {
  return new Promise(async (resolve, reject) => {
    const nameWithoutScope = name.replace(/^@[^/]+\//, "");
    const pkg = await getTarball(
      `${registry}/${name}/-/${nameWithoutScope}-${version}.tgz`,
    );

    /**
     * @type {Buffer}
     */
    const buffer = await toSharedArrayBuffer(pkg);

    const tarContent = zlib.gunzipSync(buffer);
    const sharedArray = Buffer.from(new SharedArrayBuffer(tarContent.length));
    tarContent.copy(sharedArray);

    let files = parseTarball(sharedArray);
    try {
      let createdFolders = new Set();
      for (let [filename, fileInfo] of files) {
        const filepath = path.join(destination, nameWithoutScope, filename);
        const folder = path.dirname(filepath);

        if (!createdFolders.has(folder)) {
          createdFolders.add(folder);
          fs.mkdirSync(folder, { recursive: true });
        }

        const fd = fs.openSync(filepath, "w", fileInfo.mode);
        fs.writeSync(fd, sharedArray, fileInfo.offset, fileInfo.size);
        fs.closeSync(fd);
      }

      resolve({
        registry, name, version, destination,
        files: Array.from(files.keys()),
      });
    } catch (e) {
      reject(e);
    }
  });
}
