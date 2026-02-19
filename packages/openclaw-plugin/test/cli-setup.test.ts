import { describe, expect, it } from "vitest";

import { runSetupWizard } from "../src/cli/setup.js";

describe("cli-setup", () => {
  describe("runSetupWizard", () => {
    it("is a function", () => {
      expect(runSetupWizard).toBeTypeOf("function");
    });

    it("returns a Promise (placeholder resolves without error)", async () => {
      const result = runSetupWizard();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });
  });
});
