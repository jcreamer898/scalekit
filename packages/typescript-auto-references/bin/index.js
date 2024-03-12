#!/usr/bin/env node

import { getWorkspaces } from "workspace-tools";
import { updateTsConfig } from "../src/index.js";

const rootDir = process.cwd();

const workspaceInfo = getWorkspaces(rootDir);
await Promise.all(
  Object.values(workspaceInfo).map((workspace) => {
    return updateTsConfig(workspace.path);
  }),
);
