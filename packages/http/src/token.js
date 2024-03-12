import path from "path";
import fs from "fs/promises";
import os from "os";

export const getToken = async () => {
  // read the users' home directory for the npmrc file
  const homeDir = os.homedir();
  const npmrcPath = path.join(homeDir, ".npmrc");

  // read the npmrc file
  const npmrc = await fs.readFile(npmrcPath, "utf8");

  // find the line that contains the token
  const matches = npmrc.match(/:_password=(.*)/);
  let token = "";
  if (matches && matches.length) {
    token = matches[1];
  }

  // decode base64
  return Buffer.from(token, "base64").toString("utf8");
};
