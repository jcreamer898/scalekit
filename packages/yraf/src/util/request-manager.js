import fs from "fs";
import http from "http";
import url from "url";
import invariant from "invariant";

import {
  MessageError,
  ResponseError,
  OneTimePasswordError,
} from "../errors.js";
import BlockingQueue from "./blocking-queue.js";
import * as constants from "../constants.js";
import * as network from "./network.js";
import map from "../util/map.js";

const https = require("https");

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

const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 400000,
  scheduling: "fifo",
  timeout: 400000,
  maxCachedSessions: 10000,
});
const memo = new Map();
const lookup = (name, opts, callback) => {
  if (memo.has(name)) {
    callback(undefined, memo.get(name), 4);
  } else {
    require("dns").resolve4(name, (err, addresses) => {
      memo.set(name, addresses[0]);
      callback(undefined, addresses[0], 4);
    });
  }
};

import { Transform } from "stream";

const successHosts = map();
const controlOffline = network.isOffline();

export default class RequestManager {
  constructor(reporter) {
    this._requestModule = null;
    this.offlineQueue = [];
    this.httpsProxy = "";
    this.ca = null;
    this.httpProxy = "";
    this.strictSSL = true;
    this.userAgent = "";
    this.reporter = reporter;
    this.running = 0;
    this.queue = [];
    this.max = constants.NETWORK_CONCURRENCY;
    this.maxRetryAttempts = 5;
  }

  setOptions(opts) {
    if (opts.userAgent != null) {
      this.userAgent = opts.userAgent;
    }

    if (opts.httpProxy != null) {
      this.httpProxy = opts.httpProxy || "";
    }

    if (opts.httpsProxy === "") {
      this.httpsProxy = opts.httpProxy || "";
    } else if (opts.httpsProxy === false) {
      this.httpsProxy = false;
    } else {
      this.httpsProxy = opts.httpsProxy || "";
    }

    if (opts.strictSSL !== null && typeof opts.strictSSL !== "undefined") {
      this.strictSSL = opts.strictSSL;
    }

    if (opts.ca != null && opts.ca.length > 0) {
      this.ca = opts.ca;
    }

    if (opts.networkConcurrency != null) {
      this.max = opts.networkConcurrency;
    }

    if (opts.networkTimeout != null) {
      this.timeout = opts.networkTimeout;
    }

    if (opts.maxRetryAttempts != null) {
      this.maxRetryAttempts = opts.maxRetryAttempts;
    }

    if (opts.cafile != null && opts.cafile != "") {
      // The CA bundle file can contain one or more certificates with comments/text between each PEM block.
      // tls.connect wants an array of certificates without any comments/text, so we need to split the string
      // and strip out any text in between the certificates
      try {
        const bundle = fs.readFileSync(opts.cafile).toString();
        const hasPemPrefix = (block) => block.startsWith("-----BEGIN ");
        // opts.cafile overrides opts.ca, this matches with npm behavior
        this.ca = bundle
          .split(/(-----BEGIN .*\r?\n[^-]+\r?\n--.*)/)
          .filter(hasPemPrefix);
      } catch (err) {
        this.reporter.error(`Could not open cafile: ${err.message}`);
      }
    }

    if (opts.cert != null) {
      this.cert = opts.cert;
    }

    if (opts.key != null) {
      this.key = opts.key;
    }
  }

  /**
   * Queue up a request.
   */

  request(params) {
    params.method = params.method || "GET";
    params.forever = true;
    params.retryAttempts = 0;
    params.strictSSL = this.strictSSL;
    params.headers = Object.assign(
      {
        "User-Agent": this.userAgent,
      },
      params.headers,
    );

    const promise = new Promise((resolve, reject) => {
      /*
       * This is a workaround for a bug that we have not been able to track down.
       *
       * Sometimes yarn would quit in the middle of fetching the packages
       * with an exit code of 0. This typically happens when node has no more external resources or timeouts
       * to wait for. This is an issue because yarn reports a success but the dependencies are
       * not installed.
       *
       * A timeout prevents node from successfully exiting when this bug hits.
       * When a promise takes more than 10min to resolve, we are likely hitting this bug, we then hard fail
       * to properly report the failure.
       */
      const t = setTimeout(
        () => {
          throw new Error(
            `Fetching/extracting of package ${params.url} seems to be hanging.`,
          );
        },
        10 * 60 * 1000,
      );

      const rej = (...args) => {
        reject(...args);
        clearTimeout(t);
      };
      const res = (...args) => {
        resolve(...args);
        clearTimeout(t);
      };

      this.queue.push({ params, reject: rej, resolve: res });
      this.shiftQueue();
    });

    return promise;
  }

  /**
   * Clear the request cache. This is important as we cache all HTTP requests so you'll
   * want to do this as soon as you can.
   */

  clearCache() {}

  /**
   * Check if an error is possibly due to lost or poor network connectivity.
   */

  isPossibleOfflineError(err) {
    const { code, hostname } = err;
    if (!code) {
      return false;
    }

    // network was previously online but now we're offline
    const possibleOfflineChange = !controlOffline && !network.isOffline();
    if (code === "ENOTFOUND" && possibleOfflineChange) {
      // can't resolve a domain
      return true;
    }

    // used to be able to resolve this domain! something is wrong
    if (code === "ENOTFOUND" && hostname && successHosts[hostname]) {
      // can't resolve this domain but we've successfully resolved it before
      return true;
    }

    // network was previously offline and we can't resolve the domain
    if (code === "ENOTFOUND" && controlOffline) {
      return true;
    }

    // connection was reset or dropped
    if (code === "ECONNRESET") {
      return true;
    }

    // TCP timeout
    if (code === "ESOCKETTIMEDOUT" || code === "ETIMEDOUT") {
      return true;
    }

    return false;
  }

  /**
   * Queue up request arguments to be retried. Start a network connectivity timer if there
   * isn't already one.
   */

  queueForRetry(opts) {
    if (opts.retryReason) {
      let containsReason = false;

      for (const queuedOpts of this.offlineQueue) {
        if (queuedOpts.retryReason === opts.retryReason) {
          containsReason = true;
          break;
        }
      }

      if (!containsReason) {
        this.reporter.info(opts.retryReason);
      }
    }

    if (!this.offlineQueue.length) {
      this.initOfflineRetry();
    }

    this.offlineQueue.push(opts);
  }

  /**
   * Begin timers to retry failed requests when we possibly establish network connectivity
   * again.
   */

  initOfflineRetry() {
    setTimeout(() => {
      const queue = this.offlineQueue;
      this.offlineQueue = [];
      for (const opts of queue) {
        this.execute(opts);
      }
    }, 3000);
  }

  getParams(params) {
    params.method = params.method || "GET";
    params.forever = true;
    params.strictSSL = this.strictSSL;
    params.headers = Object.assign(
      {
        "User-Agent": this.userAgent,
      },
      params.headers,
    );

    if (params.buffer) {
      params.encoding = null;
    }

    let proxy = this.httpProxy;
    if (params.url.startsWith("https:")) {
      proxy = this.httpsProxy;
    }

    if (proxy) {
      // if no proxy is set, do not pass a proxy down to request.
      // the request library will internally check the HTTP_PROXY and HTTPS_PROXY env vars.
      params.proxy = String(proxy);
    } else if (proxy === false) {
      // passing empty string prevents the underlying library from falling back to the env vars.
      // an explicit false in the yarn config should override the env var. See #4546.
      params.proxy = "";
    }

    if (this.ca != null) {
      params.ca = this.ca;
    }

    if (this.cert != null) {
      params.cert = this.cert;
    }

    if (this.key != null) {
      params.key = this.key;
    }

    if (this.timeout != null) {
      params.timeout = this.timeout;
    }

    return params;
  }

  /**
   * Execute a request.
   */

  execute(opts) {
    const { params } = opts;
    const { reporter } = this;

    const buildNext = (fn) => (data) => {
      fn(data);
      this.running--;
      this.shiftQueue();
    };

    const resolve = buildNext(opts.resolve);

    const rejectNext = buildNext(opts.reject);
    const reject = function (err) {
      err.message = `${params.url}: ${err.message}`;
      rejectNext(err);
    };

    const rejectWithoutUrl = function (err) {
      err.message = err.message;
      rejectNext(err);
    };

    const queueForRetry = (reason) => {
      const attempts = params.retryAttempts || 0;
      if (attempts >= this.maxRetryAttempts - 1) {
        return false;
      }
      if (opts.params.method && opts.params.method.toUpperCase() !== "GET") {
        return false;
      }
      params.retryAttempts = attempts + 1;
      if (typeof params.cleanup === "function") {
        params.cleanup();
      }
      opts.retryReason = reason;
      this.queueForRetry(opts);
      return true;
    };

    let calledOnError = false;
    const onError = (err) => {
      if (calledOnError) {
        return;
      }
      calledOnError = true;

      if (this.isPossibleOfflineError(err)) {
        if (!queueForRetry(this.reporter.lang("offlineRetrying"))) {
          reject(err);
        }
      } else {
        reject(err);
      }
    };

    if (!params.process) {
      const parts = new url.URL(params.url);

      params.callback = (err, res, body) => {
        if (err) {
          onError(err);
          return;
        }

        successHosts[parts.hostname] = true;

        this.reporter.verbose(
          this.reporter.lang(
            "verboseRequestFinish",
            params.url,
            res.statusCode,
          ),
        );

        if (res.statusCode === 408 || res.statusCode >= 500) {
          const description = `${res.statusCode} ${
            http.STATUS_CODES[res.statusCode]
          }`;
          if (
            !queueForRetry(
              this.reporter.lang("internalServerErrorRetrying", description),
            )
          ) {
            throw new ResponseError(
              this.reporter.lang("requestFailed", description),
              res.statusCode,
            );
          } else {
            return;
          }
        }

        if (
          res.statusCode === 401 &&
          res.caseless &&
          res.caseless.get("server") === "GitHub.com"
        ) {
          const message = `${res.body.message}. If using GITHUB_TOKEN in your env, check that it is valid.`;
          rejectWithoutUrl(
            new Error(
              this.reporter.lang(
                "unauthorizedResponse",
                res.caseless.get("server"),
                message,
              ),
            ),
          );
        }

        if (res.statusCode === 401 && res.headers["www-authenticate"]) {
          const authMethods = res.headers["www-authenticate"]
            .split(/,\s*/)
            .map((s) => s.toLowerCase());

          if (authMethods.indexOf("otp") !== -1) {
            reject(new OneTimePasswordError());
            return;
          }
        }

        if (body && typeof body.error === "string") {
          reject(new Error(body.error));
          return;
        }

        if (
          [400, 401, 404]
            .concat(params.rejectStatusCode || [])
            .indexOf(res.statusCode) !== -1
        ) {
          // So this is actually a rejection ... the hosted git resolver uses this to know whether http is supported
          resolve(false);
        } else if (res.statusCode >= 400) {
          const errMsg =
            (body && body.message) ||
            reporter.lang("requestError", params.url, res.statusCode);
          reject(new Error(errMsg));
        } else {
          resolve(body);
        }
      };
    }

    if (params.buffer) {
      params.encoding = null;
    }

    let proxy = this.httpProxy;
    if (params.url.startsWith("https:")) {
      proxy = this.httpsProxy;
    }

    if (proxy) {
      // if no proxy is set, do not pass a proxy down to request.
      // the request library will internally check the HTTP_PROXY and HTTPS_PROXY env vars.
      params.proxy = String(proxy);
    } else if (proxy === false) {
      // passing empty string prevents the underlying library from falling back to the env vars.
      // an explicit false in the yarn config should override the env var. See #4546.
      params.proxy = "";
    }

    if (this.ca != null) {
      params.ca = this.ca;
    }

    if (this.cert != null) {
      params.cert = this.cert;
    }

    if (this.key != null) {
      params.key = this.key;
    }

    if (this.timeout != null) {
      params.timeout = this.timeout;
    }

    const r = https.request(
      params.url,
      {
        lookup,
        headers: { ...(params.headers || {}), Connection: "keep-alive" },
        agent,
        timeout: 800000,
      },
      async (res) => {
        let body = (await toSharedArrayBuffer(res)).toString("utf8");
        if (params.json) {
          body = JSON.parse(body);
        }
        params.callback(null, res, body);
      },
    );
    r.on("error", (e) => onError);
    r.end();

    this.reporter.verbose(
      this.reporter.lang("verboseRequestStart", params.method, params.url),
    );
  }

  /**
   * Remove an item from the queue. Create it's request options and execute it.
   */

  shiftQueue() {
    if (this.running >= this.max || !this.queue.length) {
      return;
    }

    const opts = this.queue.shift();

    this.running++;
    this.execute(opts);
  }
}
