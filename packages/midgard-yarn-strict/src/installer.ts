import {
  Install,
  Lockfile,
  Config,
  NoopReporter,
  ProgressReporter,
} from "@scalekit/yraf";

/**
 * Create an instance of the yraf Install class
 */
export async function createInstaller({
  scope,
  frozenLockfile,
  showProgress,
  extraDependenciesFilepath,
}) {
  const reporter = showProgress ? new ProgressReporter() : new NoopReporter();
  const config = await Config.create(
    {
      cwd: process.cwd(),
      ignoreScripts: true,
    },
    reporter
  );

  const lockfile = await Lockfile.fromDirectory(
    config.lockfileFolder,
    reporter
  );

  const installer = new Install(
    { scope, frozenLockfile, ignoreEngines: true, extraDependenciesFilepath },
    config,
    reporter,
    lockfile
  );
  await installer.init();
  return installer;
}
