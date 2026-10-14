import test from "node:test";
import assert from "node:assert/strict";

import {
  getTenantPropertyFromMembership,
  getPropertyIdForTenantMaintenance,
} from "./tenantProperty.js";

function createMockSupabase({
  assignment = null,
  assignmentHistory = false,
  membership = null,
  property = null,
}) {
  return {
    from(table) {
      let selectedColumns = "";
      const query = {
        select(columns) {
          selectedColumns = columns;
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        lte() {
          return query;
        },
        or() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          if (table === "tenant_assignments") {
            return {
              data:
                selectedColumns === "*"
                  ? assignment
                  : assignmentHistory
                    ? { id: "assignment-id" }
                    : null,
              error: null,
            };
          }
          if (table === "property_members")
            return { data: membership, error: null };
          if (table === "properties") return { data: property, error: null };
          return { data: null, error: null };
        },
      };
      return query;
    },
  };
}

test("resolves the property from the tenant's effective active assignment", async () => {
  const mockSupabase = createMockSupabase({
    assignment: {
      id: "assignment-id",
      property_id: "11111111-1111-4111-8111-111111111111",
      unit_id: "unit-id",
      status: "active",
      lease_start: "2026-10-01",
      created_at: "2026-10-01T00:00:00.000Z",
    },
    property: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Oak Crest Apartments",
      address: "42 Willow St",
    },
  });

  const result = await getTenantPropertyFromMembership(
    mockSupabase,
    "tenant-user-id",
  );
  assert.equal(result.property_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.unit_id, "unit-id");
  assert.equal(result.property.name, "Oak Crest Apartments");
});

test("returns null when there is no assignment or legacy membership", async () => {
  const result = await getPropertyIdForTenantMaintenance(
    createMockSupabase({}),
    "tenant-user-id",
  );
  assert.equal(result, null);
});

test("does not revive a legacy membership after an assignment has ended", async () => {
  const result = await getTenantPropertyFromMembership(
    createMockSupabase({
      assignment: null,
      assignmentHistory: true,
      membership: { property_id: "old-property-id", membership_role: "tenant" },
    }),
    "tenant-user-id",
  );
  assert.equal(result, null);
});
