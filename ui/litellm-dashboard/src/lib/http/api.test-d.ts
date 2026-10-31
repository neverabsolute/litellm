import { expectTypeOf, test } from "vitest";
import type { components } from "./schema";
import type { userListCall } from "@/components/networking";
import type { TagNewRequest, TagUpdateRequest } from "@/components/tag_management/types";

test("API read functions expose the generated response contracts", () => {
  expectTypeOf<Awaited<ReturnType<typeof userListCall>>>().toEqualTypeOf<components["schemas"]["UserListResponse"]>();
});

test("tag payloads accept the generated request contracts", () => {
  expectTypeOf<TagNewRequest>().toEqualTypeOf<components["schemas"]["TagNewRequest"]>();
  expectTypeOf<TagUpdateRequest>().toEqualTypeOf<components["schemas"]["TagUpdateRequest"]>();
});
