import readline from "readline";

export const reportProgress = (name, completed, total) => {
  const progressPct = (total === 0 ? 1 : completed / total) * 100;
  readline.moveCursor(process.stdout, 0, -1); // up one line
  readline.clearLine(process.stdout, 1); // from cursor to end
  process.stdout.write(name + ": " + progressPct.toFixed(2) + "%\n");
};
