import { resolve } from "path";
import userHome from "../util/user-home-dir";

export function getPosixPath(path) {
  return path.replace(/\\/g, "/");
}

export function resolveWithHome(path) {
  const homePattern = process.platform === "win32" ? /^~(\/|\\)/ : /^~\//;
  if (homePattern.test(path)) {
    return resolve(userHome, path.substr(2));
  }

  return resolve(path);
}
