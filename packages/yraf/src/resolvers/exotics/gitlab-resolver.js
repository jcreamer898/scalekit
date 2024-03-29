import HostedGitResolver from "./hosted-git-resolver.js";

export default class GitLabResolver extends HostedGitResolver {
  static getTarballUrl(parts, hash) {
    return `https://${this.hostname}/${parts.user}/${parts.repo}/repository/archive.tar.gz?ref=${hash}`;
  }

  static getGitHTTPBaseUrl(parts) {
    return `https://${this.hostname}/${parts.user}/${parts.repo}`;
  }

  static getGitHTTPUrl(parts) {
    return `${GitLabResolver.getGitHTTPBaseUrl(parts)}.git`;
  }

  static getGitSSHUrl(parts) {
    return (
      `git+ssh://git@${this.hostname}/${parts.user}/${parts.repo}.git` +
      `${parts.hash ? "#" + decodeURIComponent(parts.hash) : ""}`
    );
  }

  static getHTTPFileUrl(parts, filename, commit) {
    return `https://${this.hostname}/${parts.user}/${parts.repo}/raw/${commit}/${filename}`;
  }
}
GitLabResolver.hostname = "gitlab.com";
GitLabResolver.protocol = "gitlab";
