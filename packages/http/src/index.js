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

/**
 * 
 * @param {object} options
 * @param {string} [options.token]
 * @param {string} options.url
 * @returns 
 */
const authHeader = async ({ token = process.env.REGISTRY_TOKEN, url }) => {
  const authToken = token || (await getToken(url));

  return {
    Authorization: `Basic ${Buffer.from(`.:${authToken}`).toString("base64")}`,
  };
};

/**
 *
 * @param {*} url
 * @param {Object} options
 * @param {import("http").ClientRequestArgs["headers"]} [options.headers]
 * @returns {Promise<any>}
 */
export const getJSON = async (url, options = {}) => {
  return new Promise(async (resolve, reject) => {
    const headers = {
      ...(await authHeader({ url })),
      Accept: "application/json",
    };
  
    const response = await get(url, {
      headers,
      ...options,
    });
  
    if (response.statusCode === 401) {
      reject(new Error(
        `Request failed with 401. check your token.`,
      ));
    }
  
    let data = "";
    response.on("data", (chunk) => {
      data += chunk.toString();
    });
  
    response.on("end", () => {
      resolve(JSON.parse(data.toString()))
    });
  });
};

/**
 *
 * @param {string} url
 */
export const getTarball = async (url) => {
  const response = await get(url, {
    headers: {
      ...(await authHeader({ url })),
      "Accept-Encoding": "gzip",
    },
  });
  let pkg = response;

  if (response.statusCode === 303) {
    pkg = await get(response.headers.location);
  }

  return pkg;
};
