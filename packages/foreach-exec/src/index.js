import { exec as _exec } from "child_process";
import { getWorkspaces } from "workspace-tools";
import { promisify } from "util";

const exec = promisify(_exec);

const cwd = process.cwd();
const command = process.argv.slice(2).join(" ");

const workspaces = await getWorkspaces(cwd);

for (const workspace of workspaces) {
  const { stdout, stderr } = await exec(command, {
    cwd: workspace.path,
    env: {
      ...process.env,
      PATH: `${process.env.PATH}:${workspace.path}/node_modules/.bin:${cwd}/node_modules/.bin`,
    },
  });

  if (stderr.length) {
    console.error("Error running command:" + command);
    console.error(stderr);
    process.exit(1);
  }

  console.log(stdout);
}
