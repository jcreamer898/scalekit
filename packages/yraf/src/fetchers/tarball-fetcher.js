import normalizeUrl from "normalize-url";
import { processTarball, terminatePool } from "./tarballProcessor.js";
import { readIntegerFromEnv } from "./envParser.js";
import BaseFetcher from "./base-fetcher.js";
import path from "path";
import dns from "dns";

const url = require("url");
const https = require("https");

const verboseFetch = Boolean(process.env["MYS_VERBOSE_FETCH"]);
const platform = process.platform;

const defaultMaxFeedConnections =
  {
    win32: 80,
    linux: 60,
    darwin: 80,
  }[platform] || 70;

let maxFeedConnections = readIntegerFromEnv(
  "MYS_MAX_FEED_CONNECTIONS",
  defaultMaxFeedConnections,
  verboseFetch,
);

const defaultMaxBlobStoragesConnections =
  {
    win32: 80,
    linux: 60,
    darwin: 80,
  }[platform] || 70;

let maxBlobStoragesConnections = readIntegerFromEnv(
  "MYS_MAX_BLOB_STORAGE_CONNECTIONS",
  defaultMaxBlobStoragesConnections,
  verboseFetch,
);

/**
 * @type {Map<string, string[]>}
 */
const hostsToIPs = new Map();

/**
 * Keep a list of the running requests
 * @type {Set<string>}
 */
const runningRequests = new Set();

/**
 * Getting the parameters for the lookup function
 * @typedef {Parameters<import("net").LookupFunction>} LookupParams
 */

/**
 * Getting the 3rd one, which is the callback function
 * @typedef {LookupParams[2]} LookupCallback
 */

/**
 * @type {Map<string, { callback: LookupCallback, opts: any }[]>}
 */
const callbacksForHost = new Map();

/**
 * @param {object} opts
 * @param {string[]} opts.addresses
 * @param {any} opts.opts
 * @param {LookupCallback} callback
 */
const callLookup = ({ opts, addresses }, callback) => {
  // check node version is 18 or less (v18.8.3 is an example of what the process.version returns)
  const majorNodeVersion = Number(
    process.version.replace(/^v/, "").split(".").shift(),
  );
  if (majorNodeVersion < 20) {
    return callLookupNode18({ opts, addresses }, callback);
  }

  if (opts.all) {
    callback(
      undefined,
      addresses.map((addr) => ({
        address: addr,
        family: 4,
      })),
    );
  } else {
    callback(undefined, [{ address: addresses[0], family: 4 }]);
  }
};

/**
 * Unforunately, there's a difference between how this was called in v18 vs v20
 * In the "net" library, the callback signature is different between v18 and v20
 * Because they defaulted the autoSelectFamily to true in...
 * https://github.com/nodejs/node/pull/46790
 * @param {object} opts
 * @param {string[]} opts.addresses
 * @param {any} opts.opts
 * @param {any} callback The callback here is marked as any to support node v18
 */
const callLookupNode18 = ({ opts, addresses }, callback) => {
  if (opts.all) {
    callback(undefined, addresses, 4);
  } else {
    callback(undefined, addresses[0], 4);
  }
};

/**
 * Custom lookup function that will cache the results of the DNS
 * It takes in a domain name, and calls a callback with the resolved IP addresses
 * It uses resolve4 which is a faster lookup,
 * and also caches results for given hostnames
 * @type {import("net").LookupFunction}
 */
const lookup = (name, opts, callback) => {
  const alreadyResolved = hostsToIPs.has(name);
  if (alreadyResolved) {
    callLookup({ opts, addresses: hostsToIPs.get(name) }, callback);
  } else {
    // A lookup is already running for this hostname, so add a callback to a list for later
    if (runningRequests.has(name)) {
      if (!callbacksForHost.has(name)) {
        callbacksForHost.set(name, []);
      }

      callbacksForHost.get(name).push({ callback, opts });
    } else {
      runningRequests.add(name);

      // This resolve4 function is much faster than the normal dns.lookup
      // Hence us swapping out the lookup implementation for this
      dns.resolve4(name, (err, addresses) => {
        if (err) {
          throw err;
        }

        if (!addresses.length || !addresses[0]) {
          throw new Error("Missing address for " + name);
        }

        // Cache the results for this hostname
        hostsToIPs.set(name, addresses);

        // Clear this running request
        runningRequests.delete(name);

        // Call all the callbacks for this hostname
        if (callbacksForHost.has(name)) {
          callbacksForHost.get(name).forEach(({ callback: cb, opts }) => {
            callLookup({ opts, addresses }, cb);
          });
        }

        callLookup({ opts, addresses }, callback);
      });
    }
  }
};

const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  scheduling: "fifo",
  lookup,
  maxSockets: maxFeedConnections,
});

class BlobAgent extends https.Agent {
  constructor() {
    super({
      keepAlive: true,
      keepAliveMsecs: 1000,
      scheduling: "fifo",
      lookup,
      maxSockets: maxBlobStoragesConnections,
    });
  }
  getName() {
    // Because all the blob domain points to the same IP
    // We do this to make the agent reuse sockets regardless
    // of the domain.
    return "blob";
  }
}

const blobAgent = new BlobAgent();

const noop = () => {};

/**
 *
 * @param {string} url a fully qualified url such as https://registry.yarnpkg.com/foo/bar
 * @param {*} headers
 * @returns
 */
const fetchRedirect = (url, headers) => {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        headers: { ...headers, Connection: "keep-alive" },
        method: "GET",
        hostname: parsed.hostname,
        path: parsed.pathname,
        port: 443,
        lookup,
        agent,
        timeout: 5 * 60 * 1000, // fail for requests taking more than 5min.
      },
      (res) => {
        res.on("end", noop); // handler needed to complete the request
        res.on("data", noop); // handler needed to complete the request
        if (res.statusCode === 303) {
          resolve(res.headers.location);
        } else if (res.statusCode === 200) {
          resolve(url);
        } else {
          reject(
            new Error(
              `request failed with status code ${res.statusCode}: ${url}`,
            ),
          );
        }
      },
    );
    r.on("error", (e) => {
      reject(new Error(`request failed\n${url}\n${e.message}`));
    });
    r.end();
  });
};

function toSharedArrayBuffer(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    readableStream.on("end", () => {
      const result = Buffer.from(new SharedArrayBuffer(length));
      let offset = 0;
      for (let chunk of chunks) {
        chunk.copy(result, offset);
        offset += chunk.length;
      }
      resolve(result);
    });
    readableStream.on("error", (e) => {
      reject(e);
    });
    readableStream.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      length += chunk.length;
    });
  });
}

const RE_URL_NAME_MATCH =
  /\/(?:(@[^/]+)(?:\/|%2f))?[^/]+\/(?:-|_attachments)\/(?:@[^/]+\/)?([^/]+)$/;

class TarballFetcher extends BaseFetcher {
  getLocalPaths(override) {
    const paths = [override ? path.resolve(this.config.cwd, override) : null];
    // $FlowFixMe: https://github.com/facebook/flow/issues/1414
    return paths.filter((path) => path != null);
  }

  async fetchFromExternal(retryLeft) {
    const registry = this.config.registries[this.registry];

    const headers = this.requestHeaders();
    const params = registry.getParams(
      this.reference,
      {
        headers: {
          "Accept-Encoding": "gzip",
          ...headers,
        },
        buffer: true,
      },
      this.packageName,
    );

    try {
      const redirect = await fetchRedirect(params.url, params.headers);
      const req = await new Promise((resolve, reject) => {
        const r = https.request(
          redirect,
          {
            headers: { Connection: "keep-alive" },
            lookup,
            agent: blobAgent,
            timeout: 5 * 60 * 1000, // fail for requests taking more than 5min.
          },
          (res) => {
            if (res.statusCode < 200 || res.statusCode > 300) {
              reject(
                new Error(
                  `request failed with status code ${res.statusCode}: ${redirect}`,
                ),
              );
            } else {
              resolve(res);
            }
          },
        );
        r.on("error", (e) =>
          reject(new Error(`request failed\n${redirect}\n${e.message}`)),
        );
        r.end();
      });
      const buffer = await toSharedArrayBuffer(req);

      const result = await processTarball(
        this.dest,
        buffer.buffer,
        this.hash,
        this.remote.integrity && this.remote.integrity.toString(),
      );
      return result;
    } catch (e) {
      if (retryLeft === 0) {
        throw e;
      } else {
        if (verboseFetch) {
          console.error(`[WARN] fetching failed, retrying\n${e.message}`);
        }
        return await this.fetchFromExternal(retryLeft - 1);
      }
    }
  }

  requestHeaders() {
    const registry = this.config.registries.yarn;
    const config = registry.config;
    const requestParts = urlParts(this.reference);
    return Object.keys(config).reduce((headers, option) => {
      const parts = option.split(":");
      if (parts.length === 3 && parts[1] === "_header") {
        const registryParts = urlParts(parts[0]);
        if (
          requestParts.host === registryParts.host &&
          requestParts.path.startsWith(registryParts.path)
        ) {
          const headerName = parts[2];
          const headerValue = config[option];
          headers[headerName] = headerValue;
        }
      }
      return headers;
    }, {});
  }

  _fetch() {
    return this.fetchFromExternal(2);
  }
}

TarballFetcher.cleanup = () => {
  terminatePool();
};

export default TarballFetcher;

function urlParts(requestUrl) {
  const normalizedUrl = normalizeUrl(requestUrl);
  const parsed = new url.URL(normalizedUrl);
  const host = parsed.host || "";
  const path = parsed.path || "";
  return { host, path };
}
