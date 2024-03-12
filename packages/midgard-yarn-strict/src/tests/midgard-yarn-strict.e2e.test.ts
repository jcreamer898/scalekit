import Monorepo from "./monorepo";
import { Package } from "./types";
interface ExternalPackages {
  [name: string]: Package;
}

const MOCK_EXTERNAL_PACKAGES: ExternalPackages = {
  hasOneDepA: {
    version: "1.0.0",
    name: "one-dep-a",
    dependencies: {
      "one-peer-dep-a": "1.0.0",
      react: "^16.0.0",
    },
    devDependencies: {
      "@types/react": "^16.0.0",
    },
  },
  hasOneDepB: {
    version: "1.0.0",
    name: "one-dep-b",
    dependencies: {
      "one-peer-dep-a": "1.0.0",
    },
    peerDependencies: {
      react: "^16.0.0",
    },
  },
  hasOnePeerDepA: {
    version: "1.0.0",
    name: "one-peer-dep-a",
    peerDependencies: {
      react: "^16.0.0",
    },
  },
  hasOnePeerDepB: {
    version: "1.0.0",
    name: "one-peer-dep-b",
    peerDependencies: {
      react: "^16.0.0",
    },
  },
  hasTwoPeerDepsA: {
    version: "1.0.0",
    name: "two-peer-deps-a",
    peerDependencies: {
      react: "^16.0.0",
      "@types/react": "^16.0.0",
    },
  },
  hasTwoPeerDepsB: {
    version: "1.0.0",
    name: "two-peer-deps-b",
    peerDependencies: {
      lodash: "^4.17.0",
      express: "^4.10.0",
    },
  },
  multipleLevelPeerDepsA: {
    version: "1.0.0",
    name: "multiple-level-peer-deps-a",
    peerDependencies: {
      "one-peer-dep-a": "1.0.0",
    },
  },
  multipleLevelPeerDepsB: {
    version: "1.0.0",
    name: "multiple-level-peer-deps-b",
    dependencies: {
      react: "16.0.0",
    },
    devDependencies: {
      "@types/react": "^16.0.0",
    },
    peerDependencies: {
      "one-peer-dep-b": "1.0.0",
    },
  },
};

describe("Midgard-yarn-strict should be able to detect missing peer dependencies in a monorepo", () => {
  /* SETUP */
  jest.setTimeout(30000); // TODO increase this if it isnt enough
  let monorepo: Monorepo = null;

  beforeEach(async () => {
    monorepo = new Monorepo();
    await monorepo.setup();
  });

  afterEach(async () => {
    await monorepo.teardown();
  });

  /* TEST CASES */
  describe("when all the peerDependencies are fulfilled by an internal package", () => {
    it("there should be a .store folder created and no warnings displayed", async () => {
      // prepare
      // create external packages
      const hasOnePeerDepA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasOnePeerDepA
      );
      await monorepo.addPackage({
        name: "tea",
        dependencies: {
          [hasOnePeerDepA.name]: hasOnePeerDepA.location,
          ...hasOnePeerDepA.peerDependencies,
        },
      });

      // execute
      const result = await monorepo.run("yarn strict");

      // result
      expect(result.error).toBe(null);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(
        "There are 0 missing internal peer dependencies"
      );
      expect(result.stdout).toContain(
        "There are 0 missing external peer dependencies"
      );
    });
  });

  describe("when all the peerDependencies are fulfilled by an external package", () => {
    it("there should be a .store folder created and no warnings displayed", async () => {
      // prepare
      // create external packages
      const hasOnePeerDepA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasOnePeerDepA
      );
      const hasOneDepA = await monorepo.createExternalPackage({
        ...MOCK_EXTERNAL_PACKAGES.hasOneDepA,
        dependencies: {
          ...MOCK_EXTERNAL_PACKAGES.hasOneDepA?.dependencies,
          [hasOnePeerDepA.name]: hasOnePeerDepA.location,
        },
      });
      await monorepo.addPackage({
        name: "tea",
        dependencies: {
          [hasOneDepA.name]: hasOneDepA.location,
        },
      });

      // execute
      const result = await monorepo.run("yarn strict");

      // result
      expect(result.error).toBe(null);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(
        "There are 0 missing internal peer dependencies"
      );
      expect(result.stdout).toContain(
        "There are 0 missing external peer dependencies"
      );
    });
  });

  describe("when all the peerDependencies are fulfilled by an external package", () => {
    it("there should be a .store folder created and no warnings displayed", async () => {
      // prepare
      // create external packages
      const hasOnePeerDepA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasOnePeerDepA
      );
      const hasOneDepB = await monorepo.createExternalPackage({
        ...MOCK_EXTERNAL_PACKAGES.hasOneDepB,
        dependencies: {
          ...MOCK_EXTERNAL_PACKAGES.hasOneDepA?.dependencies,
          [hasOnePeerDepA.name]: hasOnePeerDepA.location,
        },
      });
      await monorepo.addPackage({
        name: "tea",
        dependencies: {
          [hasOneDepB.name]: hasOneDepB.location,
          react: "^16.0.0",
        },
        devDependencies: {
          "@types/react": "^16.0.0",
        },
      });

      // execute
      const result = await monorepo.run("yarn strict");

      // result
      expect(result.error).toBe(null);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(
        "There are 0 missing internal peer dependencies"
      );
      expect(result.stdout).toContain(
        "There are 0 missing external peer dependencies"
      );
    });
  });

  describe("when one of the peerDependencies is not fulfilled", () => {
    it("there should be a .store folder created and warning messages should be displayed", async () => {
      // prepare
      // create external packages
      const hasOnePeerDepA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasOnePeerDepA
      );
      await monorepo.addPackage({
        name: "bar",
        dependencies: {
          [hasOnePeerDepA.name]: hasOnePeerDepA.location,
        },
      });

      // execute
      const result = await monorepo.run("yarn strict");

      // result
      expect((result.stderr.match(/\[WARNING\]/g) || []).length).toBe(1);
      expect(result.stdout).toContain(
        "There are 0 missing internal peer dependencies"
      );
      expect(result.stdout).toContain(
        "There are 1 missing external peer dependencies"
      );
    });
  });

  describe("when one of the peerDependencies is not fulfilled in multiple packages", () => {
    it("there should be a .store folder created and warning messages should be displayed", async () => {
      // prepare
      // create external packages
      const hasOnePeerDepA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasOnePeerDepA
      );
      const hasOnePeerDepB = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasOnePeerDepB
      );
      await monorepo.addPackage({
        name: "death-star",
        dependencies: {
          [hasOnePeerDepA.name]: hasOnePeerDepA.location,
          [hasOnePeerDepB.name]: hasOnePeerDepB.location,
        },
      });

      // execute
      const result = await monorepo.run("yarn strict");

      // result
      expect((result.stderr.match(/\[WARNING\]/g) || []).length).toBe(2);
      expect(result.stdout).toContain(
        "There are 0 missing internal peer dependencies"
      );
      expect(result.stdout).toContain(
        "There are 2 missing external peer dependencies"
      );
    });
  });

  describe("when multiple peerDependencies is not fulfilled in one package", () => {
    it("there should be a .store folder created and warning messages should be displayed", async () => {
      // prepare
      // create external packages
      const hasTwoPeerDepsA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasTwoPeerDepsA
      );
      await monorepo.addPackage({
        name: "death-star",
        dependencies: {
          [hasTwoPeerDepsA.name]: hasTwoPeerDepsA.location,
        },
      });

      // execute
      const result = await monorepo.run("yarn strict");

      // result
      expect((result.stderr.match(/\[WARNING\]/g) || []).length).toBe(2);
      expect(result.stdout).toContain(
        "There are 0 missing internal peer dependencies"
      );
      expect(result.stdout).toContain(
        "There are 1 missing external peer dependencies"
      );
    });
  });

  describe("when multiple level of peerDependencies is not fulfilled in one package", () => {
    it("there should be a .store folder created and warning messages should be displayed", async () => {
      // prepare
      // create external packages
      const hasOnePeerDepA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasOnePeerDepA
      );
      const multipleLevelPeerDepsA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.multipleLevelPeerDepsA
      );

      await monorepo.addPackage({
        name: "death-star",
        dependencies: {
          [multipleLevelPeerDepsA.name]: multipleLevelPeerDepsA.location,
          [hasOnePeerDepA.name]: hasOnePeerDepA.location,
        },
      });

      // execute
      const result = await monorepo.run("yarn strict");

      // result
      expect((result.stderr.match(/\[WARNING\]/g) || []).length).toBe(2);
      expect(result.stdout).toContain(
        "There are 0 missing internal peer dependencies"
      );
      expect(result.stdout).toContain(
        "There are 2 missing external peer dependencies"
      );
    });
  });

  describe("when missing deps from multiple peers which are declared on multiple external packages", () => {
    it("there should be a .store folder created and warning messages should be displayed", async () => {
      const hasTwoPeerDepsA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasTwoPeerDepsA
      );
      const hasTwoPeerDepsB = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasTwoPeerDepsB
      );

      // create package A with dependency on X
      monorepo.addPackage({
        name: "A",
        version: "1.0.0",
        dependencies: {
          [hasTwoPeerDepsA.name]: hasTwoPeerDepsA.location,
        },
      });

      // create package C with dependency on J
      monorepo.addPackage({
        name: "B",
        version: "1.0.0",
        dependencies: {
          [hasTwoPeerDepsB.name]: hasTwoPeerDepsB.location,
        },
      });

      const result = await monorepo.run("yarn strict");
      expect((result.stderr.match(/\[WARNING\]/g) || []).length).toBe(4);
      expect(result.stdout).toContain(
        "There are 0 missing internal peer dependencies"
      );
      expect(result.stdout).toContain(
        "There are 2 missing external peer dependencies"
      );
    });
  });

  describe("when multiple external deps are missing deps from peer external package", () => {
    it("there should be a .store folder created and warning messages should be displayed", async () => {
      const hasOnePeerDepB = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasOnePeerDepB
      );
      const multipleLevelPeerDepsA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.multipleLevelPeerDepsA
      );
      const multipleLevelPeerDepsB = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.multipleLevelPeerDepsB
      );

      // create package A with dependency on X
      monorepo.addPackage({
        name: "A",
        version: "1.0.0",
        dependencies: {
          [multipleLevelPeerDepsA.name]: multipleLevelPeerDepsA.location,
        },
      });

      // create package C with dependency on J
      monorepo.addPackage({
        name: "B",
        version: "1.0.0",
        dependencies: {
          [multipleLevelPeerDepsB.name]: multipleLevelPeerDepsB.location,
          [hasOnePeerDepB.name]: hasOnePeerDepB.location,
        },
      });

      const result = await monorepo.run("yarn strict");
      expect((result.stderr.match(/\[WARNING\]/g) || []).length).toBe(1);
      expect(result.stdout).toContain(
        "There are 0 missing internal peer dependencies"
      );
      expect(result.stdout).toContain(
        "There are 1 missing external peer dependencies"
      );
    });
  });

  describe("when there are when missing deps from multiple peers and multiple external deps are missing deps from peer external package", () => {
    it("there should be a .store folder created and warning messages should be displayed", async () => {
      const hasTwoPeerDepsA = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.hasTwoPeerDepsA
      );
      const multipleLevelPeerDepsB = await monorepo.createExternalPackage(
        MOCK_EXTERNAL_PACKAGES.multipleLevelPeerDepsB
      );

      // create package A with dependency on X
      monorepo.addPackage({
        name: "A",
        version: "1.0.0",
        dependencies: {
          [hasTwoPeerDepsA.name]: hasTwoPeerDepsA.location,
        },
      });

      // create package C with dependency on J
      monorepo.addPackage({
        name: "B",
        version: "1.0.0",
        dependencies: {
          [multipleLevelPeerDepsB.name]: multipleLevelPeerDepsB.location,
        },
      });

      const result = await monorepo.run("yarn strict");
      expect((result.stderr.match(/\[WARNING\]/g) || []).length).toBe(3);
      expect(result.stdout).toContain(
        "There are 0 missing internal peer dependencies"
      );
      expect(result.stdout).toContain(
        "There are 2 missing external peer dependencies"
      );
    });
  });
});
