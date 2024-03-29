import { removeSuffix } from "../misc.js";

const semver = require("semver");

const REF_PREFIX = "refs/";
const REF_TAG_PREFIX = "refs/tags/";
const REF_BRANCH_PREFIX = "refs/heads/";
const REF_PR_PREFIX = "refs/pull/";

// This regex is designed to match output from git of the style:
//   ebeb6eafceb61dd08441ffe086c77eb472842494  refs/tags/v0.21.0
// and extract the hash and ref name as capture groups
const GIT_REF_LINE_REGEXP =
  /^([a-fA-F0-9]+)\s+(refs\/(?:tags|heads|pull|remotes)\/.*)$/;

const COMMIT_SHA_REGEXP = /^[a-f0-9]{5,40}$/;
const REF_NAME_REGEXP = /^refs\/(tags|heads)\/(.+)$/;

export const isCommitSha = (target) => COMMIT_SHA_REGEXP.test(target);

const tryVersionAsGitCommit = ({ version, refs, git }) => {
  const lowercaseVersion = version.toLowerCase();
  if (!isCommitSha(lowercaseVersion)) {
    return Promise.resolve(null);
  }
  for (const [ref, sha] of refs.entries()) {
    if (sha.startsWith(lowercaseVersion)) {
      return Promise.resolve({ sha, ref });
    }
  }
  return git.resolveCommit(lowercaseVersion);
};

const tryEmptyVersionAsDefaultBranch = ({ version, git }) =>
  version.trim() === "" ? git.resolveDefaultBranch() : Promise.resolve(null);

const tryWildcardVersionAsDefaultBranch = ({ version, git }) =>
  version === "*" ? git.resolveDefaultBranch() : Promise.resolve(null);

const tryRef = (refs, ref) => {
  const sha = refs.get(ref);
  return sha ? { sha, ref } : null;
};

const tryVersionAsFullRef = ({ version, refs }) =>
  version.startsWith("refs/") ? tryRef(refs, version) : null;

const tryVersionAsTagName = ({ version, refs }) =>
  tryRef(refs, `${REF_TAG_PREFIX}${version}`);

const tryVersionAsPullRequestNo = ({ version, refs }) =>
  tryRef(refs, `${REF_PR_PREFIX}${version}`);

const tryVersionAsBranchName = ({ version, refs }) =>
  tryRef(refs, `${REF_BRANCH_PREFIX}${version}`);

const tryVersionAsDirectRef = ({ version, refs }) =>
  tryRef(refs, `${REF_PREFIX}${version}`);

const computeSemverNames = ({ config, refs }) => {
  const names = {
    tags: [],
    heads: [],
  };
  for (const ref of refs.keys()) {
    const match = REF_NAME_REGEXP.exec(ref);
    if (!match) {
      continue;
    }
    const [, type, name] = match;
    if (semver.valid(name, config.looseSemver)) {
      names[type].push(name);
    }
  }
  return names;
};

const findSemver = (version, config, namesList) =>
  config.resolveConstraints(namesList, version);

const tryVersionAsTagSemver = async ({ version, config, refs }, names) => {
  const result = await findSemver(
    version.replace(/^semver:/, ""),
    config,
    names.tags,
  );
  return result ? tryRef(refs, `${REF_TAG_PREFIX}${result}`) : null;
};

const tryVersionAsBranchSemver = async ({ version, config, refs }, names) => {
  const result = await findSemver(
    version.replace(/^semver:/, ""),
    config,
    names.heads,
  );
  return result ? tryRef(refs, `${REF_BRANCH_PREFIX}${result}`) : null;
};

const tryVersionAsSemverRange = async (options) => {
  const names = computeSemverNames(options);
  return (
    (await tryVersionAsTagSemver(options, names)) ||
    tryVersionAsBranchSemver(options, names)
  );
};

const VERSION_RESOLUTION_STEPS = [
  tryEmptyVersionAsDefaultBranch,
  tryVersionAsGitCommit,
  tryVersionAsFullRef,
  tryVersionAsTagName,
  tryVersionAsPullRequestNo,
  tryVersionAsBranchName,
  tryVersionAsSemverRange,
  tryWildcardVersionAsDefaultBranch,
  tryVersionAsDirectRef,
];

/**
 * Resolve a git-url hash (version) to a git commit sha and branch/tag ref
 * Returns null if the version cannot be resolved to any commit
 */

export const resolveVersion = async (options) => {
  for (const testFunction of VERSION_RESOLUTION_STEPS) {
    const result = await testFunction(options);
    if (result !== null) {
      return result;
    }
  }
  return null;
};

/**
 * Parse Git ref lines into hash of ref names to SHA hashes
 */

export const parseRefs = (stdout) => {
  // store references
  const refs = new Map();

  // line delimited
  const refLines = stdout.split("\n");

  for (const line of refLines) {
    const match = GIT_REF_LINE_REGEXP.exec(line);

    if (match) {
      const [, sha, tagName] = match;

      // As documented in gitrevisions:
      //   https://www.kernel.org/pub/software/scm/git/docs/gitrevisions.html#_specifying_revisions
      // "A suffix ^ followed by an empty brace pair means the object could be a tag,
      //   and dereference the tag recursively until a non-tag object is found."
      // In other words, the hash without ^{} is the hash of the tag,
      //   and the hash with ^{} is the hash of the commit at which the tag was made.
      const name = removeSuffix(tagName, "^{}");

      refs.set(name, sha);
    }
  }

  return refs;
};
