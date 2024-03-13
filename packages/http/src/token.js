import path from "path";
import fs from "fs/promises";
import os from "os";

export const getToken = async (registry) => {
  
  // read the users' home directory for the npmrc file
  const homeDir = os.homedir();
  const npmrcPath = path.join(homeDir, ".npmrc");

  // read the npmrc file
  const npmrc = await fs.readFile(npmrcPath, "utf8");

  // find the line that contains the token
  const matches = npmrc.match(/(.*):_password=(.*)/);
  let token = "";
  if (matches && matches.length) {
    for (const match of matches) {
      const registry = matches[1];
      const feed = registry.match(/_packaging\/([\w]+)\//);
      if (feed && feed.length) {
        token = matches[2];
        break;
      }
    }
  }

  // decode base64
  return Buffer.from(token, "base64").toString("utf8");
};
