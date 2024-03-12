export class MapWithDefault<K, T extends Object> {
  map: Map<K, T>;
  constructor(private defaultCreator: new () => T) {
    this.map = new Map();
  }
  get(key: K): T {
    if (!this.map.has(key)) {
      this.map.set(key, new this.defaultCreator());
    }
    return this.map.get(key)!;
  }
}

export class LinkIndex<T> {
  links: MapWithDefault<T, Set<T>>;
  reversedLinks: MapWithDefault<T, Set<T>>;

  constructor() {
    this.links = new MapWithDefault<T, Set<T>>(Set);
    this.reversedLinks = new MapWithDefault<T, Set<T>>(Set);
  }
  add(source: T, target: T): void {
    this.links.get(source).add(target);
    this.reversedLinks.get(target).add(source);
  }
  getTargets(source: T): readonly T[] {
    return [...this.links.get(source)];
  }
  getSources(target: T): readonly T[] {
    return [...this.reversedLinks.get(target)];
  }
  delete(source: T, target: T): void {
    if (!this.has(source, target)) {
      return;
    }
    this.links.get(source).delete(target);
    this.reversedLinks.get(target).delete(source);
  }
  has(source: T, target: T): boolean {
    return this.links.get(source).has(target);
  }
}

class Index<K, T> {
  nodes: MapWithDefault<K, Array<T>>;
  constructor() {
    this.nodes = new MapWithDefault<K, Array<T>>(Array);
  }
  add(key: K, value: T): void {
    this.nodes.get(key).push(value);
  }
  get(key: K): readonly T[] {
    return this.nodes.get(key);
  }
}

class DoubleIndex<T> {
  nodes: MapWithDefault<string, Index<string, T>>;

  constructor() {
    this.nodes = new MapWithDefault<string, Index<string, T>>(Index);
  }
  add(key1: string, key2: string, id: T): void {
    this.nodes.get(key1).add(key2, id);
  }
  get(key1: string, key2: string): readonly T[] {
    return this.nodes.get(key1).get(key2);
  }
}

export class NodeCollection<Props extends { name: string; version: string }> {
  index: DoubleIndex<Props>;
  collection: Array<Props>;

  constructor() {
    this.index = new DoubleIndex();
    this.collection = [];
  }
  add(props: Props): void {
    this.collection.push(props);
    this.index.add(props.name, props.version, props);
  }
  withNameAndVersion(name: string, version: string): readonly Props[] {
    return this.index.get(name, version);
  }
  getAll(): readonly Props[] {
    return this.collection;
  }
}
