import https from "node:https";
import { getToken } from "./token.js";

/**
 *
 * @param {*} url
 * @param {Object} options
 * @param {import("http").ClientRequestArgs["headers"]} [options.headers]
 * @returns {Promise<import("http").IncomingMessage>}
 */
export const get = (url, { headers } = {}) =>
  new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            ...headers,
          },
        },
        (response) => {
          resolve(response);
        },
      )
      .on("error", reject);
  });

const authHeader = async (token = process.env.REGISTRY_TOKEN) => {
  const authToken = token || (await getToken());

  return {
    Authorization: `Basic ${Buffer.from(`.:${authToken}`).toString("base64")}`,
  };
};

/**
 *
 * @param {*} url
 * @param {Object} options
 * @param {import("http").ClientRequestArgs["headers"]} [options.headers]
 * @returns {Promise<import("http").IncomingMessage>}
 */
export const getJSON = async (url, options = {}) => {
  const headers = {
    ...(await authHeader()),
    Accept: "application/json",
  };

  const response = await get(url, {
    headers,
    ...options,
  });

  return response;
};

/**
 *
 * @param {string} url
 */
export const getTarball = async (url) => {
  const response = await get(url, {
    headers: {
      ...(await authHeader()),
      "Accept-Encoding": "gzip",
    },
  });
  let pkg = response;

  if (response.statusCode === 303) {
    pkg = await get(response.headers.location);
  }

  return pkg;
};
