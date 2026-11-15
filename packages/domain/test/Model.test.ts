import * as Domain from "@alchemy.run/domain";
import { expect, it } from "@effect/vitest";
import { FamilyOs } from "../src/FamilyOs.model.ts";

it("the model is well defined", () => {
  expect(Domain.verify(FamilyOs)).toEqual([]);
});
