import { NodeCollection, LinkIndex, MapWithDefault } from "./nodeCollection";

type UnassignedPeerLink = {
  targetName: string;
  targetRange: string;
  optional: boolean;
};

export type Node = {
  name: string;
  version: string;
  isLocal: boolean;
  missing: string[];
  peerDeps: { [name: string]: Node };
};

export type PeerLink = UnassignedPeerLink & {
  parent: Node;
  source: Node;
};

class PendingPeerDeps {
  peerLinks: MapWithDefault<Node, Array<UnassignedPeerLink>>;
  nodeSet: Set<Node>;
  constructor() {
    this.peerLinks = new MapWithDefault<Node, Array<UnassignedPeerLink>>(Array);
    this.nodeSet = new Set();
  }
  forNode(node: Node): readonly UnassignedPeerLink[] {
    return this.peerLinks.get(node) || [];
  }
  add(node: Node, pl: UnassignedPeerLink): void {
    this.peerLinks.get(node).push(pl);
    this.nodeSet.add(node);
  }
  nodes(): readonly Node[] {
    return [...this.nodeSet];
  }
}

export class Graph {
  nodeCollection: NodeCollection<Node>;
  linkIndex: LinkIndex<Node>;
  pendingPeerDeps: PendingPeerDeps;

  constructor() {
    this.nodeCollection = new NodeCollection();
    this.linkIndex = new LinkIndex();
    this.pendingPeerDeps = new PendingPeerDeps();
  }

  addNode(name: string, version: string, isLocal: boolean): void {
    this.nodeCollection.add({
      name,
      version,
      peerDeps: {},
      isLocal,
      missing: [],
    });
  }

  getVirtualNode(
    source: Node,
    fulfilledPeerDepName: string,
    fulfilledPeerDep: Node
  ): Node | undefined {
    const oldNode = source;

    const name = oldNode.name;
    const version = oldNode.version;
    const peerDeps = oldNode.peerDeps;

    const matchingNodeWithSamePeerDeps = this.nodeCollection
      .withNameAndVersion(name, version)
      .find((o) => {
        if (
          Object.keys(o.peerDeps).length !==
          Object.keys(peerDeps).length + 1
        ) {
          return false;
        }
        for (let pd in peerDeps) {
          if (o.peerDeps[pd] !== peerDeps[pd]) {
            return false;
          }
        }
        if (o.peerDeps[fulfilledPeerDepName] !== fulfilledPeerDep) {
          return false;
        }
        return true;
      });

    if (matchingNodeWithSamePeerDeps !== undefined) {
      return matchingNodeWithSamePeerDeps;
    }
    return undefined;
  }

  createVirtualNode(
    source: Node,
    fulfilledPeerDepName: string,
    fulfilledPeerDep: Node
  ): Node {
    const newNode = this.cloneNode(source);
    newNode.peerDeps[fulfilledPeerDepName] = fulfilledPeerDep;
    newNode.missing = newNode.missing.filter((m) => m !== fulfilledPeerDepName);

    // add resolved dep as link
    this.linkIndex.add(newNode, fulfilledPeerDep);

    // copy peerDeps from source
    const oldPeerDeps = this.pendingPeerDeps.forNode(source);
    oldPeerDeps.forEach((pd) => {
      if (pd.targetName === fulfilledPeerDepName) {
        return;
      }
      this.pendingPeerDeps.add(newNode, pd);
    });

    return newNode;
  }

  cloneNode(node: Node): Node {
    let { missing, peerDeps, ...rest } = node;
    peerDeps = { ...peerDeps };
    missing = [...missing];

    const newNode = { ...rest, peerDeps, missing };
    this.nodeCollection.add(newNode);

    // duplicating links
    const targets = this.linkIndex.getTargets(node);
    targets.forEach((t) => this.linkIndex.add(newNode, t));

    return newNode;
  }

  hasLink(parent: Node, source: Node): boolean {
    return this.linkIndex.has(parent, source);
  }

  getPeerLinksFor(node: Node): readonly UnassignedPeerLink[] {
    return this.pendingPeerDeps.forNode(node);
  }

  getChildren(parent: Node): readonly Node[] {
    return this.linkIndex.getTargets(parent);
  }

  changeChildren(parent: Node, oldChild: Node, newChild: Node): void {
    this.linkIndex.delete(parent, oldChild);
    this.linkIndex.add(parent, newChild);
  }

  getNodeWithoutPeerDependencies(
    name: string,
    version: string
  ): Node | undefined {
    const list = this.nodeCollection.withNameAndVersion(name, version);
    const id = list.find((i) => Object.keys(i.peerDeps).length === 0);
    return id;
  }

  hasPeerLink(node: Node): boolean {
    return this.pendingPeerDeps.forNode(node).length !== 0;
  }

  getPeerLinks(): PeerLink[] {
    return (
      this.pendingPeerDeps
        .nodes()
        // We ignore peer deps of local packages // TODO: do we need this?
        .filter((node) => !node.isLocal)
        .flatMap((node) => {
          const parents = this.linkIndex.getSources(node);
          return parents.flatMap((parent) =>
            this.pendingPeerDeps.forNode(node).map((peerLink) => ({
              parent,
              source: node,
              targetName: peerLink.targetName,
              optional: peerLink.optional,
              targetRange: peerLink.targetRange,
            }))
          );
        })
    );
  }

  addPeerLink(
    source: Node,
    targetName: string,
    targetRange: string,
    optional: boolean
  ): void {
    this.pendingPeerDeps.add(source, { targetName, targetRange, optional });
  }

  addLink(source: Node, target: Node): void {
    this.linkIndex.add(source, target);
  }

  all(): readonly Node[] {
    return this.nodeCollection.getAll();
  }
}
