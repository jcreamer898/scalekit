import { Worker } from "worker_threads";
import readline from "readline";
import os from "os";

export type NodeLoc =
  | {
      t: "memory";
      files: Map<
        string,
        {
          offset: number;
          size: number;
          mode: number;
        }
      >;
      buffer: SharedArrayBuffer;
    }
  | {
      t: "disk";
      loc: string;
    };

export type CopyQueueItem = {
  src: NodeLoc;
  dest: string;
};

export type CopyQueue = Array<CopyQueueItem>;

const workerScript = `
const path = require("path");
function getNodeModulesFolder(location) {
  if (path.basename(path.resolve(location, "..")) === "node_modules") {
    return path.resolve(location, "..");
  }
  return path.resolve(location, "..", "..");
}

const {parentPort, workerData} = require('worker_threads');
const fs = require('fs');

const isMac = process.platform === "darwin";


// The size was determined experimentalement.
const BUFF_SIZE = 1024 * 1024 * 1; // 1MB

const buff = !isMac && Buffer.allocUnsafe(BUFF_SIZE);

// Queue that aims to have little memory allocation cost
// and don't really care about retaining objects longer than
// necessary
const makeQueue = function(size) {
  let array = [];
  let start = 0;
  let end = 0;
  return {
    push: (o) => {
      array[end] = o;
      end++;
      if (end === size) { end = 0 }
      if (end === start) { throw new Error("The queue is full") }
    },
    pop: () => {
      if (end === start) {
        return undefined;
      }
      const result = array[start];
      start++;
      if (start === size) { start = 0 }
      return result;
    }
  }
};

const filo = function() {
  let start = undefined;
  return {
    push: (o) => {
      const toQueue = { value: o }
      if (start === undefined) {
        start = toQueue;
      } else {
        toQueue.next = start;
	start = toQueue;
      }
    },
    pop: () => {
      if (start === undefined) {
        return undefined;
      }
      const next = start;
      start = start.next;
      return next.value;
    }
  }
}

// cheap concurrency limiter
function limit(concurrency, call) {
  let running = 0;
  let queue = makeQueue(1000000);
  async function fn(...args) {
    if (running === concurrency) {
      return new Promise((resolve) => {
      queue.push({ resolve, args });
    });
    }
    running++;
    await new Promise(async (resolve) => {
      await call(...args);
      resolve();
      let next = queue.pop();
      while (next !== undefined) {
        const resolve = next.resolve;
        await call(...next.args);
        resolve();
	next = queue.pop();
      }
      running--;
    })
  }
  return fn;
}

const copyFile = limit(1000, (src, dest) => fs.promises.copyFile(src, dest, fs.constants.COPYFILE_FICLONE));

async function copyDirMac(source, destination, filo, exclusionList) {
  await fs.promises.mkdir(destination);
  const entries = await fs.promises.readdir(source, { withFileTypes: true});
  await Promise.all(entries.map(async e => {
    if (e.isDirectory()) {
      await copyDirMac(path.join(source, e.name), path.join(destination, e.name), filo);
    } else {
      if (exclusionList && exclusionList.includes(e.name)) {
        return;
      }
      const dest = path.join(destination, e.name);
      const src = path.join(source, e.name);
      filo.push(copyFile(src, dest, fs.constants.COPYFILE_FICLONE));
    }
  }));
}

function copyDir(source, destination, exclusionList) {
  fs.mkdirSync(destination);
  fs.readdirSync(source, { withFileTypes: true }).forEach(e => {
    if (e.isDirectory()) {
       copyDir(path.join(source, e.name), path.join(destination, e.name));
    }
    else if (e.isFile()) {
      if (!exclusionList || !exclusionList.includes(e.name)) {
        const dest = path.join(destination, e.name);
        const src = path.join(source, e.name);
           let fdSrc = fs.openSync(src, 0);
          let stat = fs.fstatSync(fdSrc);
          let size = stat.size;
          let fdDest = fs.openSync(dest, 'w', stat.mode);
          let length;
          while(true) {
            length = fs.readSync(fdSrc, buff, 0, BUFF_SIZE);
            if (length === 0) break;
            fs.writeSync(fdDest, buff, 0, length);
            if (length < BUFF_SIZE) break;
          }

          fs.closeSync(fdSrc);
          fs.closeSync(fdDest);
       }
    }
  })
}


parentPort.on('message', async o => {
    if (isMac) {
      const myFilo = filo();
        await Promise.all(o.actions.map(async a => {
	  let foldersCreated = new Set();
          await fs.promises.rm(a.dest, { recursive: true, force: true });
          await fs.promises.mkdir(path.dirname(a.dest), { recursive: true });
	  foldersCreated.add(path.dirname(a.dest));
          if (a.src.t === "memory") {
	    for (let [fileName, file] of (a.src.files || [])) {
	      let filePath = path.join(a.dest, fileName);
	      const folder = path.dirname(filePath);
	      if (!foldersCreated.has(folder)) {
                foldersCreated.add(folder);
		await fs.promises.mkdir(folder, { recursive: true });
	      }
	      const fd = await fs.promises.open(filePath, 'w', file.mode);
              await fd.write(Buffer.from(a.src.buffer, file.offset, file.size));
	      await fd.close();
	    }
	  } else {
            await copyDirMac(a.src.loc, a.dest, myFilo, workerData);
	  }
      }));
      let p; 
      while (p = myFilo.pop()) {
        await p;
      }
      parentPort.postMessage('');
    } else {
      o.actions.forEach(a => {
        let foldersCreated = new Set();
        fs.rmSync(a.dest, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(a.dest), { recursive: true });
        foldersCreated.add(path.dirname(a.dest));
          if (a.src.t === "memory") {
            for (let [fileName, file] of (a.src.files || [])) {
	      let filePath = path.join(a.dest, fileName);
  	      const folder = path.dirname(filePath);
	      if (!foldersCreated.has(folder)) {
                foldersCreated.add(folder);
	        fs.mkdirSync(folder, { recursive: true });
	      }
              const fd = fs.openSync(filePath, 'w', file.mode);
              fs.writeSync(fd, Buffer.from(a.src.buffer, file.offset, file.size));
	      fs.closeSync(fd);
	    }
	  } else {
	    copyDir(a.src.loc, a.dest, workerData);
	  }
    parentPort.postMessage('progress');
    
      });
      parentPort.postMessage('');
    }
});
`;

function spawnWorker() {
  return new Worker(workerScript, { eval: true });
}

const numberOfWorkers = process.env.WORKERS_LIMIT
  ? parseInt(process.env.WORKERS_LIMIT)
  : Math.ceil(os.cpus().length * 0.75);

export function createWorkers(numWorkers: number, exclusionList?: string[]) {
  const workers = [];

  for (let i = 0; i < numWorkers; i++) {
    const worker = new Worker(workerScript, {
      eval: true,
      workerData: exclusionList || [],
      stdout: true,
    });
    worker.unref();
    workers.push(worker);
  }

  return workers;
}

const splitWork = <T>(queue: Array<T>) => {
  const split = queue
    .reduce(
      (acc, curr) => {
        const isWorkerFull =
          acc[acc.length - 1].length <
          Math.ceil(queue.length / numberOfWorkers);

        if (isWorkerFull) {
          acc[acc.length - 1].push(curr);
        } else {
          acc.push([curr]);
        }

        return acc;
      },
      [[]] as [T[]],
    )
    .filter((ac) => ac && ac.length);

  return split;
};

function reportProgress(name: string, completed: number, total: number) {
  const progressPct = (total === 0 ? 1 : completed / total) * 100;
  readline.moveCursor(process.stdout, 0, -1); // up one line
  readline.clearLine(process.stdout, 1); // from cursor to end
  process.stdout.write(name + ": " + progressPct.toFixed(2) + "%\n");
}

async function executeWork<T>(
  workers: Worker[],
  queue: T[],
  showProgress = false,
) {
  await new Promise<void>((resolve, reject) => {
    const split = splitWork(queue);

    if (!split.length) {
      resolve();
    }

    let completed = 0;
    let running = split.length;
    split.forEach((ac, i) => {
      const worker = workers[i];
      const onError = (err: Error) => {
        worker.off("error", onError);
        worker.off("close", onError);
        worker.off("message", onMessage);

        reject(err);
      };
      const onMessage = (msg: string) => {
        if (msg == "progress") {
          if (showProgress) {
            reportProgress("📋 Copying files", ++completed, queue.length);
          }
          return;
        }

        worker.off("error", onError);
        worker.off("close", onError);
        worker.off("message", onMessage);

        running -= 1;
        if (running === 0) {
          resolve();
        }
      };

      worker.on("error", onError);
      worker.on("close", onError);
      worker.on("message", onMessage);

      worker.postMessage({ actions: ac });
    });
  }).finally(() => workers.forEach((w) => w.terminate()));
}

export async function copyFiles(
  queue: CopyQueue,
  exclusionList?: string[],
  showProgress?: boolean,
): Promise<void> {
  if (queue.length === 0) {
    return;
  }
  const workers = createWorkers(numberOfWorkers, exclusionList);
  await executeWork(workers, queue, showProgress);
}
