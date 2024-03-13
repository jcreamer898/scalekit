import fs from "fs/promises";

/**
 *
 * @param {string} file
 * @returns
 */
export const readJson = async (file) => {
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw);
};
