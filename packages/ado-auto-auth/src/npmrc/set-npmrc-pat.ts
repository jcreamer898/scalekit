import fs from "fs";
import { EOL } from "os";
import { generateNpmrcPat } from "./generate-npmrc-pat.js";
import { NpmrcOrg, getRepoNpmrcAdoOrganizations } from "./get-repo-npmrc-ado-orgs.js";
import { getUserNPMRC, readNpmRC } from "./npmrc.js";
import { getFeedWithoutProtocol } from "./getFeedWithoutProtocol.js";

// /**
//  * URL for the user's PAT settings
//  * @param { string } organization
//  */
// const getTokenUrl = (organization: string) =>
//   `https://dev.azure.com/${organization}/_usersSettings/tokens`;

/**
 * Default user to be used in the .npmrc
 */
const defaultUser = "me";

/**
 * Default email to be used in the .npmrc
 */
const defaultEmail = "me@example.com";

/**
 * Create a base64 encoded string from a string
 * @param {string} input
 * @returns {string}
 */
const base64 = (input: string) => {
  return Buffer.from(input).toString("base64");
};


/**
 * Create the user npmrc given an array of registry urls and a token
 * @param {object} options
 * @param {Array<import("../../utils/pat.js").NpmrcOrg> } options.feeds
 * @param {string} options.existingNpmrc
 * @returns {string}
 */
const createUserNpmrc = async ({ feeds, existingNpmrc }: { 
  feeds: Array<NpmrcOrg>, 
  existingNpmrc: string,
}) => {
  let newUserNpmRc = existingNpmrc;

  if (newUserNpmRc.indexOf("Azure Artifacts Auth") === -1) {
    newUserNpmRc = `# Generated by Azure Artifacts Auth${EOL}${newUserNpmRc}`;
  }

  for (const feed of feeds) {
    const feedWithoutProtocol = "//" + getFeedWithoutProtocol(feed.feed);
    let isAlreadyInNpmrc = newUserNpmRc.indexOf(feedWithoutProtocol) > -1;
    if (isAlreadyInNpmrc) {
      newUserNpmRc = newUserNpmRc.replace(
        new RegExp(`${feedWithoutProtocol}:_password\=(.*)`),
        `${feedWithoutProtocol}:_password=${feed.pat}`
      );
    } else {
      const entry = [
        `${feedWithoutProtocol}:username=${defaultUser}`,
        `${feedWithoutProtocol}:email=${defaultEmail}`,
        `${feedWithoutProtocol}:_password=${feed.pat}`,
        "",
      ].join(EOL);

      newUserNpmRc += entry + EOL;
    }
  }

  return newUserNpmRc;
};

const userNpmrc = getUserNPMRC();

/**
 *
 * @param {Object} options
 * @param {Record<string, string>} [options.organizationPatMap] Map of ADO Organization to packaging PAT for that org
 * @param {boolean} [options.accept]
 * @param {string} [options.npmrcFilePath]
 * @param {boolean} [options.silent]
 * @returnsshort
 */
export const setupNpmrc = async function ({
  organizationPatMap = {},
  feeds,
}: {
  organizationPatMap: Record<string, string>;
  feeds: NpmrcOrg[];
}) {
  for (const feed of feeds) {
    try {
      let pat = organizationPatMap[feed.organization];

      if (!pat) {
        throw new Error(`No PAT found for ${feed.organization}`);
      }

      const b64Pat = base64(pat);
      feed.pat = b64Pat;

    } catch (e) {
      throw new Error(
        `Error setting up npmrc for ${feed.organization} organization: ${(e as any).message}`
      );
    }
  }

  let userNpmrcFile = "";
  try {
    userNpmrcFile = await readNpmRC({ npmrc: userNpmrc });
  } catch (e) {
    /* No user .npmrc file, that's ok */
  }
  // const newnpmrc = 
  let newnpmrc = await createUserNpmrc({
    existingNpmrc: userNpmrcFile,
    feeds,
  });

  await fs.promises.writeFile(userNpmrc, newnpmrc);
};

export const setNpmrcPat = async (): Promise<void> => {
  const adoOrgs = await getRepoNpmrcAdoOrganizations();

  // get a token for each feed
  const organizationPatMap: Record<string, string> = {};
  for (const adoOrg of adoOrgs) {
    organizationPatMap[adoOrg.organization] = await generateNpmrcPat(
      adoOrg.organization,
      false
    );
  }

  await setupNpmrc({
    organizationPatMap,
    feeds: adoOrgs
  });
};