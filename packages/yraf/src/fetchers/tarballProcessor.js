const { Worker } = require("worker_threads");
import { readIntegerFromEnv } from "./envParser.js";

const verbose = Boolean(process.env["MYS_VERBOSE_FETCH"]);
let poolSize = readIntegerFromEnv("MYS_TARBALL_POOL_SIZE", 4, verbose);

const workerCode = `
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const performance = require("perf_hooks").performance;
const { parentPort } = require("worker_threads");

parentPort.on("message", message => {
  const { dest, buffer, integrity, thisHash, requestId } = message;
  try {
    const value = processTarballInWorker(dest, buffer, thisHash, integrity);
    parentPort.postMessage({requestId, status: "success", value });
  } catch (e) {
    parentPort.postMessage({ requestId, status: "error", error: e});
  }
})


function parseTarball(buffer) {
  const files = new Map();
  function parseString(offset, length) {
    let end = offset;
    let max = length + offset;
    for (; buffer[end] !== 0 && end !== max; end++) {}
    return buffer.toString("utf8", offset, end);
  }
  function parseOctal(offset, length) {
    return parseInt(parseString(offset, length), 8);
  }
  let offset = 0;
  while (buffer[offset] !== 0) {
    let fileName = parseString(offset, 100);
    const mode = parseOctal(offset + 100, 8);
    const fileSize = parseOctal(offset + 124, 12);
    const fileType = parseOctal(offset + 156, 1);
    const prefix = parseString(offset + 345, 155);
    if (prefix) {
      fileName = \`\${prefix}/\${fileName}\`;
    }
    // trim the first part of the path
    fileName = fileName.replace(/^[^\\\\\\/]*[\\\\\\/]/, "");

    const isEntryAFile = fileType === 0 || fileType === 48;
    if (isEntryAFile) {
      files.set(fileName, { offset: offset + 512, mode, size: fileSize });
    }
    offset += 512 + 512 * Math.ceil(fileSize / 512);
  }
  return files;
}

function processTarballInWorker(dest, buffer, thisHash, remoteIntegrity) {
  buffer = Buffer.from(buffer);
  const hash = crypto.createHash("sha1").update(buffer).digest("hex");
  if (!thisHash) {
    throw new Error(\`package does not have a hash: \${this.reference}\`);
  }
  if (hash !== thisHash) {
    throw new Error(\`hash validation failed:\\nurl: \${this.reference}\\nexpected: \${thisHash}\\nreceived: \${hash}\`);
  }

  if (remoteIntegrity) {
    const [_, algo, integrityHash] = /^([^-]*)-(.*)\$/.exec(remoteIntegrity);
    const calculatedHash = Buffer.from(integrityHash, "base64").toString("hex");
    const hash = crypto.createHash(algo).update(buffer).digest("hex");
    if (calculatedHash !== hash) {
      throw new Error(\`integrity validation failed:\\nintegrity: \${remoteIntegrity}\\nurl: \${this.reference}\\nexpected: \${calculatedHash}\\nreceived: \${hash}\`);
    }
  } else {
    throw new Error("remote does not have an integrity");
  }

  const tarContent = zlib.gunzipSync(buffer);
  const sharedArray = Buffer.from(new SharedArrayBuffer(tarContent.length));
  tarContent.copy(sharedArray);

  let files = parseTarball(sharedArray);

  if (process.env["YARN_MEMORY_CACHE"]) {
    return { hash, files, buffer: sharedArray.buffer };
  } else {
    try {
      let createdFolders = new Set();
      for (let [name, fileInfo] of files) {
	const filepath = path.join(dest, name);
	const folder = path.dirname(filepath);
	if (!createdFolders.has(folder)) {
          createdFolders.add(folder);
          fs.mkdirSync(folder, { recursive: true });
	}
	const fd = fs.openSync(filepath, "w", fileInfo.mode);
	fs.writeSync(fd, sharedArray, fileInfo.offset, fileInfo.size);
	fs.closeSync(fd);
      }
    } catch (e) {
      throw new Error(
	[
          "Something went wrong while writing the following cache entry:",
          dest,
          "",
          e.message || e,
	].join("\\n")
      );
    }
    return { hash };
  }
}
`;

const running = new Map();

const pool = [];
let next = 0;
let counter = 0;
let timeout = undefined;
let workersAreDone = false;
function startPool() {
  for (let i = 0; i < poolSize; i++) {
    const worker = new Worker(workerCode, {
      eval: true,
      stdout: true,
      stderr: true,
    });
    worker.unref();
    worker.on("message", (message) => {
      const { requestId, status } = message;
      const { reject, resolve } = running.get(requestId);
      if (status === "success") {
        resolve(message.value);
      } else {
        reject(message.error);
      }
      running.delete(requestId);
    });
    pool.push(worker);
  }
}

export function terminatePool() {
  for (let worker of pool) {
    worker.terminate();
  }
}

export function processTarball(dest, buffer, thisHash, integrity) {
  if (pool.length === 0) {
    startPool();
  }
  const worker = pool[next];
  next++;
  if (next === poolSize) {
    next = 0;
  }
  const requestId = counter++;
  return new Promise((resolve, reject) => {
    running.set(requestId, { resolve, reject });
    worker.postMessage({ dest, buffer, thisHash, integrity, requestId });
  });
}
