export declare const Install: any;
export declare const Lockfile: any;
export declare const NoopReporter: any;
export declare const ProgressReporter: any;
export declare const Config: any;

export declare type ResolutionMap = {
  [name: string]: {
    [range: string]: string;
  };
};
export declare type LocationMap = {
  name: string;
  version: string;
  location: string;
  isLocal?: boolean;
  dependencies?: {
    [name: string]: string;
  };
  devDependencies?: {
    [name: string]: string;
  };
  peerDependencies?: {
    [name: string]: string;
  };
  optionalDependencies?: {
    [name: string]: string;
  };
  peerDependenciesMeta?: {
    [name: string]: {
      optional?: boolean;
    };
  };
}[];
export declare function resolveAndFetch(scope?: string): Promise<{
  resolutionMap: ResolutionMap;
  locationMap: LocationMap;
}>;
