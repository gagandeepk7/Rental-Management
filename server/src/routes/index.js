import { completeRegistrationRole } from '../utils/registrationRole.js';
import { publicDatabaseError } from '../utils/publicError.js';
import { formatTime } from "../../../shared/time.mjs";
import express from "express";
import { randomUUID } from "node:crypto";
import {
  createSupabaseAdminClient,
  hasSupabaseConfig,
} from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import {
  validateAmenityBookingRequest,
  timesOverlap,
  toMinutes,
  isValidDate,
} from "../utils/bookingRules.js";
import { getTenantPropertyFromMembership } from "../utils/tenantProperty.js";

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}


function getLocalDateAndMinutes(timeZone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function minutesUntilBooking(bookingDate, startMinutes, localNow) {
  const dayDifference =
    (Date.parse(`${bookingDate}T00:00:00Z`) -
      Date.parse(`${localNow.date}T00:00:00Z`)) /
    86400000;
  return dayDifference * 1440 + startMinutes - localNow.minutes;
}

async function getUserProfile(supabase, userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return data || null;
}

async function getOwnedPropertyIds(supabase, userId) {
  const { data, error } = await supabase
    .from("properties")
    .select("id")
    .eq("owner_id", userId);
  if (error) throw error;
  return (data || []).map((property) => property.id);
}

async function recordActivity(
  supabase,
  { propertyId, actorId, entityType, entityId, action, details = {} },
) {
  const { error } = await supabase.from("activity_events").insert({
    property_id: propertyId,
    actor_id: actorId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    details,
  });
  if (error) console.error("Unable to record activity:", error.message);
}

async function createNotification(
  supabase,
  { userId, type, title, message, entityType, entityId },
) {
  if (!userId) return;
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    notification_type: type,
    title,
    message,
    entity_type: entityType || null,
    entity_id: entityId || null,
  });
  if (error) console.error("Unable to create notification:", error.message);
}

async function getAccessibleMaintenanceRequest(supabase, requestId, userId) {
  const { data: request, error } = await supabase
    .from("maintenance_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  if (!request) return { request: null, profile: null, isManager: false };

  const profile = await getUserProfile(supabase, userId);
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("owner_id")
    .eq("id", request.property_id)
    .maybeSingle();
  if (propertyError) throw propertyError;
  const isManager =
    profile?.role === "manager" && property?.owner_id === userId;
  const isTenant = profile?.role === "tenant" && request.tenant_id === userId;
  const isAssignedStaff =
    profile?.role === "maintenance_staff" && request.assigned_to === userId;
  return { request, profile, isManager, isTenant, isAssignedStaff, property };
}

async function addUnitCounts(supabase, properties) {
  if (!properties.length) return [];
  const { data: units, error } = await supabase
    .from("property_units")
    .select("property_id, is_active")
    .in("property_id", properties.map((property) => property.id));
  if (error) throw error;
  const counts = new Map();
  for (const unit of units || []) {
    const propertyCounts = counts.get(unit.property_id) || {
      unit_count: 0,
      active_unit_count: 0,
    };
    propertyCounts.unit_count += 1;
    if (unit.is_active) propertyCounts.active_unit_count += 1;
    counts.set(unit.property_id, propertyCounts);
  }
  return properties.map((property) => ({
    ...property,
    unit_count: counts.get(property.id)?.unit_count || 0,
    active_unit_count: counts.get(property.id)?.active_unit_count || 0,
  }));
}

async function hasValidUnitSelection(supabase, propertyId, unitId) {
  const { data, error } = await supabase
    .from("property_units")
    .select("id")
    .eq("property_id", propertyId)
    .eq("is_active", true);
  if (error) throw error;
  const activeUnits = data || [];
  return unitId
    ? activeUnits.some((unit) => unit.id === unitId)
    : activeUnits.length === 0;
}

router.get("/health", async (req, res) => {
  res.json({
    status: "ok",
    service: "property-management-api",
    supabaseConfigured: hasSupabaseConfig(),
    timestamp: new Date().toISOString(),
  });
});

router.post(
  "/auth/signup",
  asyncHandler(async (req, res) => {
    const { email, password, full_name, role = "tenant" } = req.body || {};
    if (!["tenant", "manager", "maintenance_staff"].includes(role)) {
      return res.status(400).json({ error: "Choose a valid account type." });
    }

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required." });
    }

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({
        error:
          "Supabase is not configured. Add your project credentials to the server .env file.",
      });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.FRONTEND_ORIGIN?.split(",")[0] || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:5173")}/login`,
        data: {
          full_name: full_name || email.split("@")[0],
          registration_role: role,
        },
      },
    });

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    return res
      .status(201)
      .json({ user: data?.user || null, session: data?.session || null });
  }),
);

router.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required." });
    }

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return res.status(401).json({ error: publicDatabaseError(error) });
    }

    return res.json({
      session: data?.session || null,
      user: data?.user || null,
    });
  }),
);

router.post("/auth/logout", requireAuth, async (req, res) => {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return res.status(500).json({ error: "Supabase is not configured." });
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    return res.status(400).json({ error: publicDatabaseError(error) });
  }

  return res.json({ success: true, message: "Logged out." });
});

router.get("/auth/session", requireAuth, async (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.app_metadata?.role || "tenant",
    },
  });
});

router.get(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", req.user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    return res.json({
      profile: data ? await completeRegistrationRole(supabase, req.user, data) : {
        id: req.user.id,
        full_name: req.user.email,
        role: "tenant",
      },
    });
  }),
);

router.patch(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { full_name, role } = req.body || {};
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const existingProfile = await getUserProfile(supabase, req.user.id);
    if (role && role !== existingProfile?.role) {
      return res.status(403).json({
        error:
          "Role assignment must be managed through a trusted admin process.",
      });
    }

    const profileChanges = {
      id: req.user.id,
      full_name: full_name || existingProfile?.full_name || req.user.email,
      updated_at: new Date().toISOString(),
    };
    if (!existingProfile) profileChanges.role = "tenant";

    const { data, error } = await supabase
      .from("profiles")
      .upsert(profileChanges)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    return res.json({ profile: data });
  }),
);

router.get(
  "/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    return res.json({ notifications: data || [] });
  }),
);

router.get(
  "/staff/permissions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "maintenance_staff")
      return res.json({ check_in_property_ids: [] });
    const { data, error } = await supabase
      .from("property_members")
      .select("property_id, can_manage_bookings")
      .eq("user_id", req.user.id)
      .eq("membership_role", "maintenance_staff")
      .eq("can_manage_bookings", true);
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    return res.json({
      check_in_property_ids: (data || []).map(
        (membership) => membership.property_id,
      ),
    });
  }),
);

router.patch(
  "/notifications/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    if (!data)
      return res.status(404).json({ error: "Notification not found." });
    return res.json({ notification: data });
  }),
);

router.get(
  "/manager/activity",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const propertyIds = await getOwnedPropertyIds(supabase, req.user.id);
    if (!propertyIds.length) return res.json({ activity: [] });
    const { data, error } = await supabase
      .from("activity_events")
      .select("*")
      .in("property_id", propertyIds)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    return res.json({ activity: data || [] });
  }),
);

router.get(
  "/dashboard",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.json({
        totalMaintenance: 0,
        pending: 0,
        inProgress: 0,
        completed: 0,
        unitCount: 0,
        overdueMaintenance: 0,
        upcomingBookings: 0,
        availableAmenities: 0,
        propertyCount: 0,
        activity: [],
      });
    const profile = await getUserProfile(supabase, req.user.id);
    let propertyIds = [];
    if (profile?.role === "manager")
      propertyIds = await getOwnedPropertyIds(supabase, req.user.id);
    else if (profile?.role === "tenant") {
      const property = await getTenantPropertyFromMembership(
        supabase,
        req.user.id,
      );
      if (property?.property_id) propertyIds = [property.property_id];
    } else if (profile?.role === "maintenance_staff") {
      const { data: memberships } = await supabase
        .from("property_members")
        .select("property_id")
        .eq("user_id", req.user.id)
        .eq("membership_role", "maintenance_staff")
        .eq("can_manage_bookings", true);
      propertyIds = [
        ...new Set((memberships || []).map((member) => member.property_id)),
      ];
    }
    let maintenanceQuery = supabase
      .from("maintenance_requests")
      .select("id, status, due_at, property_id");
    if (profile?.role === "tenant")
      maintenanceQuery = maintenanceQuery.eq("tenant_id", req.user.id);
    else if (profile?.role === "maintenance_staff")
      maintenanceQuery = maintenanceQuery.eq("assigned_to", req.user.id);
    else if (propertyIds.length)
      maintenanceQuery = maintenanceQuery.in("property_id", propertyIds);
    else maintenanceQuery = null;
    const [maintenanceResult, bookingResult, amenityResult, activityResult, unitResult] =
      await Promise.all([
        maintenanceQuery
          ? maintenanceQuery
          : Promise.resolve({ data: [], error: null }),
        profile?.role === "tenant"
          ? supabase
              .from("amenity_bookings")
              .select("status, booking_date")
              .eq("user_id", req.user.id)
          : propertyIds.length
            ? supabase
                .from("amenity_bookings")
                .select("status, booking_date")
                .in("property_id", propertyIds)
            : Promise.resolve({ data: [], error: null }),
        propertyIds.length
          ? supabase
              .from("amenities")
              .select("is_active")
              .in("property_id", propertyIds)
          : Promise.resolve({ data: [], error: null }),
        profile?.role === "manager" && propertyIds.length
          ? supabase
              .from("activity_events")
              .select("id, action, details, created_at, entity_type")
              .in("property_id", propertyIds)
              .order("created_at", { ascending: false })
              .limit(8)
          : Promise.resolve({ data: [], error: null }),
        profile?.role === "manager" && propertyIds.length
          ? supabase
              .from("property_units")
              .select("id")
              .in("property_id", propertyIds)
              .eq("is_active", true)
          : Promise.resolve({ data: [], error: null }),
      ]);
    for (const result of [
      maintenanceResult,
      bookingResult,
      amenityResult,
      activityResult,
      unitResult,
    ]) {
      if (result.error)
        return res.status(400).json({ error: publicDatabaseError(result.error) });
    }
    const maintenanceItems = maintenanceResult.data || [];
    const bookings = bookingResult.data || [];
    const amenities = amenityResult.data || [];
    return res.json({
      totalMaintenance: maintenanceItems.length,
      pending: maintenanceItems.filter((item) => item.status === "pending")
        .length,
      inProgress: maintenanceItems.filter(
        (item) => item.status === "in_progress",
      ).length,
      completed: maintenanceItems.filter((item) => item.status === "completed")
        .length,
      overdueMaintenance: maintenanceItems.filter(
        (item) =>
          item.status !== "completed" &&
          item.due_at &&
          new Date(item.due_at).getTime() < Date.now(),
      ).length,
      upcomingBookings: bookings.filter(
        (booking) =>
          booking.status === "confirmed" &&
          booking.booking_date >= new Date().toISOString().slice(0, 10),
      ).length,
      availableAmenities: amenities.filter((amenity) => amenity.is_active)
        .length,
      unitCount: unitResult.data?.length || 0,
      propertyCount: propertyIds.length,
      activity: activityResult.data || [],
    });
  }),
);

router.get(
  "/properties",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.json({ properties: [] });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role === "manager") {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("owner_id", req.user.id)
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(400).json({ error: publicDatabaseError(error) });
      }

      return res.json({ properties: await addUnitCounts(supabase, data || []) });
    }

    if (profile?.role === "tenant") {
      const tenantProperty = await getTenantPropertyFromMembership(
        supabase,
        req.user.id,
      );
      return res.json({
        properties: tenantProperty?.property ? [tenantProperty.property] : [],
      });
    }

    return res.json({ properties: [] });
  }),
);

router.post(
  "/properties",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, address } = req.body || {};
    if (!name || !address) {
      return res.status(400).json({ error: "Name and address are required." });
    }

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager") {
      return res.status(403).json({ error: "Manager access required." });
    }

    const { data, error } = await supabase
      .from("properties")
      .insert({
        name,
        address,
        owner_id: req.user.id,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    await recordActivity(supabase, {
      propertyId: data.id,
      actorId: req.user.id,
      entityType: "property",
      entityId: data.id,
      action: "property_created",
      details: { name },
    });

    return res.status(201).json({ property: data });
  }),
);

router.patch(
  "/manager/properties/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });

    const { name, address, booking_cancellation_hours, timezone } =
      req.body || {};
    if ((name !== undefined && (typeof name !== "string" || !name.trim())) ||
        (address !== undefined && (typeof address !== "string" || !address.trim())) ||
        (booking_cancellation_hours !== undefined && (!Number.isInteger(booking_cancellation_hours) || booking_cancellation_hours < 0)))
      return res.status(400).json({ error: "Valid property details and a nonnegative integer cancellation cutoff are required." });
    if (timezone !== undefined) {
      try { getLocalDateAndMinutes(timezone); } catch {
        return res.status(400).json({ error: "Use a valid IANA property timezone." });
      }
    }
    const { data, error } = await supabase
      .from("properties")
      .update({ name, address, booking_cancellation_hours, timezone })
      .eq("id", req.params.id)
      .eq("owner_id", req.user.id)
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    if (!data) return res.status(404).json({ error: "Property not found." });
    await recordActivity(supabase, {
      propertyId: data.id,
      actorId: req.user.id,
      entityType: "property",
      entityId: data.id,
      action: "property_updated",
      details: { name: data.name },
    });
    return res.json({ property: data });
  }),
);

router.get(
  "/manager/properties/:propertyId/units",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const property = await supabase
      .from("properties")
      .select("id")
      .eq("id", req.params.propertyId)
      .eq("owner_id", req.user.id)
      .maybeSingle();
    if (property.error)
      return res.status(400).json({ error: publicDatabaseError(property.error) });
    if (!property.data)
      return res.status(404).json({ error: "Property not found." });
    const { data, error } = await supabase
      .from("property_units")
      .select("*")
      .eq("property_id", req.params.propertyId)
      .order("unit_number");
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    return res.json({ units: data || [] });
  }),
);

router.post(
  "/manager/properties/:propertyId/units",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const { unit_number, bedrooms = 0, bathrooms = 1 } = req.body || {};
    if (!unit_number?.trim())
      return res
        .status(400)
        .json({ error: "Unit name or number is required." });
    const property = await supabase
      .from("properties")
      .select("id")
      .eq("id", req.params.propertyId)
      .eq("owner_id", req.user.id)
      .maybeSingle();
    if (property.error)
      return res.status(400).json({ error: publicDatabaseError(property.error) });
    if (!property.data)
      return res.status(404).json({ error: "Property not found." });
    const { data, error } = await supabase
      .from("property_units")
      .insert({
        property_id: req.params.propertyId,
        unit_number: unit_number.trim(),
        bedrooms,
        bathrooms,
      })
      .select()
      .single();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    await recordActivity(supabase, {
      propertyId: req.params.propertyId,
      actorId: req.user.id,
      entityType: "unit",
      entityId: data.id,
      action: "unit_created",
      details: { unit_number: data.unit_number },
    });
    return res.status(201).json({ unit: data });
  }),
);

router.patch(
  "/manager/units/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const { data: unit, error: unitError } = await supabase
      .from("property_units")
      .select("id, property_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (unitError) return res.status(400).json({ error: publicDatabaseError(unitError) });
    if (!unit) return res.status(404).json({ error: "Unit not found." });
    const { data: property } = await supabase
      .from("properties")
      .select("id")
      .eq("id", unit.property_id)
      .eq("owner_id", req.user.id)
      .maybeSingle();
    if (!property)
      return res.status(403).json({ error: "You do not manage this unit." });
    const allowedFields = ["unit_number", "bedrooms", "bathrooms", "is_active"];
    const changes = Object.fromEntries(
      Object.entries(req.body || {}).filter(([field]) =>
        allowedFields.includes(field),
      ),
    );
    if (!Object.keys(changes).length)
      return res.status(400).json({ error: "No valid unit changes supplied." });
    const { data, error } = await supabase
      .from("property_units")
      .update(changes)
      .eq("id", unit.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    return res.json({ unit: data });
  }),
);

router.get(
  "/manager/staff",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const propertyIds = await getOwnedPropertyIds(supabase, req.user.id);
    if (!propertyIds.length) return res.json({ staff: [] });
    const { data: memberships, error } = await supabase
      .from("property_members")
      .select("user_id, property_id, can_manage_bookings")
      .in("property_id", propertyIds)
      .eq("membership_role", "maintenance_staff");
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    const staffIds = [
      ...new Set((memberships || []).map((member) => member.user_id)),
    ];
    if (!staffIds.length) return res.json({ staff: [] });
    const { data: staffProfiles, error: staffError } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("id", staffIds)
      .eq("role", "maintenance_staff");
    if (staffError) return res.status(400).json({ error: publicDatabaseError(staffError) });
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const emails = new Map(
      (authUsers?.users || []).map((user) => [user.id, user.email]),
    );
    return res.json({
      staff: (staffProfiles || []).map((item) => ({
        ...item,
        email: emails.get(item.id) || null,
        property_ids: (memberships || [])
          .filter((member) => member.user_id === item.id)
          .map((member) => member.property_id),
        booking_permission_property_ids: (memberships || [])
          .filter(
            (member) =>
              member.user_id === item.id && member.can_manage_bookings,
          )
          .map((member) => member.property_id),
      })),
    });
  }),
);

router.post(
  "/manager/staff",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const {
      email,
      full_name,
      property_id,
      can_manage_bookings = false,
    } = req.body || {};
    if (!email || !full_name || !property_id)
      return res
        .status(400)
        .json({ error: "Name, email, and property are required." });
    const { data: property } = await supabase
      .from("properties")
      .select("id")
      .eq("id", property_id)
      .eq("owner_id", req.user.id)
      .maybeSingle();
    if (!property)
      return res
        .status(403)
        .json({ error: "You do not manage this property." });
    const { data: authUsers, error: usersError } =
      await supabase.auth.admin.listUsers();
    if (usersError) return res.status(400).json({ error: publicDatabaseError(usersError) });
    const existingUser = (authUsers?.users || []).find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );
    let staffUser = existingUser;
    let staffName = full_name;
    if (existingUser) {
      const existingProfile = await getUserProfile(supabase, existingUser.id);
      if (existingProfile?.role !== "maintenance_staff")
        return res.status(400).json({
          error: "That email already belongs to a non-staff account.",
        });
      staffName = existingProfile.full_name || full_name;
    } else {
      const { data: invitation, error: inviteError } =
        await supabase.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${process.env.FRONTEND_ORIGIN?.split(",")[0] || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:5173")}/reset-password`,
          data: { full_name },
        });
      if (inviteError)
        return res.status(400).json({ error: publicDatabaseError(inviteError) });
      staffUser = invitation.user;
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({ id: staffUser.id, full_name, role: "maintenance_staff" });
      if (profileError)
        return res.status(400).json({ error: publicDatabaseError(profileError) });
    }
    const { error: membershipError } = await supabase
      .from("property_members")
      .upsert(
        {
          property_id,
          user_id: staffUser.id,
          membership_role: "maintenance_staff",
          can_manage_bookings: Boolean(can_manage_bookings),
        },
        { onConflict: "property_id,user_id" },
      );
    if (membershipError)
      return res.status(400).json({ error: publicDatabaseError(membershipError) });
    await recordActivity(supabase, {
      propertyId: property_id,
      actorId: req.user.id,
      entityType: "staff",
      entityId: staffUser.id,
      action: existingUser ? "staff_added_to_property" : "staff_invited",
      details: { email },
    });
    return res
      .status(201)
      .json({ staff: { id: staffUser.id, full_name: staffName, email } });
  }),
);

router.patch(
  "/manager/staff/:staffId/permissions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const { property_id, can_manage_bookings } = req.body || {};
    if (typeof can_manage_bookings !== "boolean")
      return res.status(400).json({ error: "Booking permission must be true or false." });
    const { data: property } = await supabase
      .from("properties")
      .select("id")
      .eq("id", property_id)
      .eq("owner_id", req.user.id)
      .maybeSingle();
    if (!property)
      return res
        .status(403)
        .json({ error: "You do not manage this property." });
    const { data, error } = await supabase
      .from("property_members")
      .update({ can_manage_bookings: Boolean(can_manage_bookings) })
      .eq("property_id", property_id)
      .eq("user_id", req.params.staffId)
      .eq("membership_role", "maintenance_staff")
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    if (!data)
      return res.status(404).json({ error: "Staff membership not found." });
    return res.json({ membership: data });
  }),
);

router.delete(
  "/manager/staff/:staffId/properties/:propertyId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const { data: property } = await supabase
      .from("properties")
      .select("id")
      .eq("id", req.params.propertyId)
      .eq("owner_id", req.user.id)
      .maybeSingle();
    if (!property)
      return res
        .status(403)
        .json({ error: "You do not manage this property." });
    const { data: membership, error: membershipError } = await supabase
      .from("property_members")
      .delete()
      .eq("property_id", property.id)
      .eq("user_id", req.params.staffId)
      .eq("membership_role", "maintenance_staff")
      .select("id")
      .maybeSingle();
    if (membershipError)
      return res.status(400).json({ error: publicDatabaseError(membershipError) });
    if (!membership)
      return res.status(404).json({ error: "Staff membership not found." });
    await supabase
      .from("maintenance_requests")
      .update({
        assigned_to: null,
        status: "pending",
        completion_submitted_at: null,
        completion_reviewed_at: null,
        completion_reviewed_by: null,
        completion_review_notes: null,
        resolution_notes: null,
        resolved_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("property_id", property.id)
      .eq("assigned_to", req.params.staffId)
      .neq("status", "completed");
    await recordActivity(supabase, {
      propertyId: property.id,
      actorId: req.user.id,
      entityType: "staff",
      entityId: req.params.staffId,
      action: "staff_removed_from_property",
      details: {},
    });
    return res.json({ success: true });
  }),
);

router.get(
  "/manager/properties",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    if (!profile || profile.role !== "manager") {
      return res.status(403).json({ error: "Manager access required." });
    }

    const { data, error } = await supabase
      .from("properties")
      .select("*")
      .eq("owner_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    return res.json({ properties: await addUnitCounts(supabase, data || []) });
  }),
);

router.get(
  "/manager/tenants",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    if (!profile || profile.role !== "manager") {
      return res.status(403).json({ error: "Manager access required." });
    }

    const propertyIds = await getOwnedPropertyIds(supabase, req.user.id);
    if (!propertyIds.length) return res.json({ tenants: [] });
    const { data: assignments, error: assignmentError } = await supabase
      .from("tenant_assignments")
      .select("tenant_id")
      .in("property_id", propertyIds);
    if (assignmentError)
      return res.status(400).json({ error: publicDatabaseError(assignmentError) });
    const tenantIds = [
      ...new Set((assignments || []).map((assignment) => assignment.tenant_id)),
    ];
    if (!tenantIds.length) return res.json({ tenants: [] });
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role, created_at")
      .in("id", tenantIds)
      .eq("role", "tenant")
      .order("full_name", { ascending: true });

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    const { data: authUsers, error: usersError } =
      await supabase.auth.admin.listUsers();
    if (usersError) {
      return res.status(400).json({ error: publicDatabaseError(usersError) });
    }

    const userMap = new Map(
      (authUsers?.users || []).map((user) => [user.id, user.email]),
    );
    const tenants = (data || []).map((tenant) => ({
      ...tenant,
      email: userMap.get(tenant.id) || null,
    }));

    const search = String(req.query.search || "")
      .trim()
      .toLowerCase();
    const filteredTenants = search
      ? tenants.filter((tenant) => {
          const matchesName = tenant.full_name?.toLowerCase().includes(search);
          const matchesEmail = tenant.email?.toLowerCase().includes(search);
          return matchesName || matchesEmail;
        })
      : tenants;

    return res.json({ tenants: filteredTenants });
  }),
);

router.get(
  "/manager/assignments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    if (!profile || profile.role !== "manager") {
      return res.status(403).json({ error: "Manager access required." });
    }

    const { data, error } = await supabase
      .from("tenant_assignments")
      .select("*")
      .order("lease_start", { ascending: false });

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    const assignments = await Promise.all(
      (data || []).map(async (assignment) => {
        const [propertyResponse, tenantResponse, unitResponse] =
          await Promise.all([
            supabase
              .from("properties")
              .select("id, name, address, owner_id")
              .eq("id", assignment.property_id)
              .maybeSingle(),
            supabase
              .from("profiles")
              .select("id, full_name, role")
              .eq("id", assignment.tenant_id)
              .maybeSingle(),
            assignment.unit_id
              ? supabase
                  .from("property_units")
                  .select("id, unit_number")
                  .eq("id", assignment.unit_id)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null }),
          ]);

        if (
          propertyResponse.error &&
          propertyResponse.error.code !== "PGRST116"
        ) {
          throw propertyResponse.error;
        }
        if (tenantResponse.error && tenantResponse.error.code !== "PGRST116") {
          throw tenantResponse.error;
        }
        if (unitResponse.error && unitResponse.error.code !== "PGRST116") {
          throw unitResponse.error;
        }

        return {
          ...assignment,
          property: propertyResponse.data,
          tenant: tenantResponse.data,
          unit: unitResponse.data,
        };
      }),
    );

    return res.json({
      assignments: assignments.filter(
        (assignment) => assignment.property?.owner_id === req.user.id,
      ),
    });
  }),
);

router.post(
  "/tenant-assignments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      tenant_id,
      property_id,
      unit_id,
      lease_start,
      lease_end,
      status = "active",
    } = req.body || {};

    if (!tenant_id || !property_id || !lease_start) {
      return res.status(400).json({
        error: "Tenant, property, and lease start date are required.",
      });
    }

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    if (!profile || profile.role !== "manager") {
      return res.status(403).json({ error: "Manager access required." });
    }

    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("*")
      .eq("id", property_id)
      .maybeSingle();

    if (propertyError) {
      return res.status(400).json({ error: publicDatabaseError(propertyError) });
    }

    if (!property || property.owner_id !== req.user.id) {
      return res.status(403).json({
        error: "You cannot assign tenants to a property you do not manage.",
      });
    }

    if (!(await hasValidUnitSelection(supabase, property_id, unit_id))) {
      return res.status(400).json({
        error: "Select an active unit in this property before assigning a tenant.",
      });
    }

    const { data: tenant, error: tenantError } = await supabase
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", tenant_id)
      .maybeSingle();

    if (tenantError) {
      return res.status(400).json({ error: publicDatabaseError(tenantError) });
    }

    if (!tenant || tenant.role !== "tenant") {
      return res
        .status(400)
        .json({ error: "Only tenant profiles can be assigned to a property." });
    }

    if (status !== "active" && status !== "pending") {
      return res
        .status(400)
        .json({ error: "Assignments must start as pending or active." });
    }

    if (lease_end && lease_end < lease_start) {
      return res.status(400).json({
        error: "Lease end date must be on or after the lease start date.",
      });
    }

    const { data: existingAssignments, error: assignmentError } = await supabase
      .from("tenant_assignments")
      .select("*")
      .eq("tenant_id", tenant_id)
      .in("status", ["pending", "active"]);

    if (assignmentError) {
      return res.status(400).json({ error: publicDatabaseError(assignmentError) });
    }

    const newStart = new Date(lease_start);
    const newEnd = lease_end ? new Date(lease_end) : null;
    const hasOverlap = (existingAssignments || []).some((assignment) => {
      const currentStart = new Date(assignment.lease_start);
      const currentEnd = assignment.lease_end
        ? new Date(assignment.lease_end)
        : null;
      const startsBeforeEnd = !currentEnd || newStart <= currentEnd;
      const endsAfterStart = !newEnd || currentStart <= newEnd;
      return startsBeforeEnd && endsAfterStart;
    });

    if (hasOverlap) {
      return res.status(409).json({
        error: "This tenant already has an overlapping active lease period.",
      });
    }

    const { data, error } = await supabase
      .from("tenant_assignments")
      .insert({
        tenant_id,
        property_id,
        unit_id: unit_id || null,
        lease_start,
        lease_end: lease_end || null,
        status,
      })
      .select()
      .single();

    if (error) {
      return res.status(error.code === "23P01" ? 409 : 400).json({
        error:
          error.code === "23P01"
            ? "This unit is already assigned during that lease period."
            : error.message,
      });
    }

    await supabase.from("property_members").upsert(
      {
        property_id,
        user_id: tenant_id,
        membership_role: "tenant",
      },
      { onConflict: "property_id,user_id" },
    );

    await Promise.all([
      createNotification(supabase, {
        userId: tenant_id,
        type: "lease",
        title: "Property assigned",
        message: `You have been assigned to ${property.name}.`,
        entityType: "tenant_assignment",
        entityId: data.id,
      }),
      recordActivity(supabase, {
        propertyId: property_id,
        actorId: req.user.id,
        entityType: "tenant_assignment",
        entityId: data.id,
        action: "tenant_assigned",
        details: { tenant_id, unit_id: unit_id || null },
      }),
    ]);

    return res.status(201).json({ assignment: data });
  }),
);

router.patch(
  "/tenant-assignments/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status, lease_end, unit_id } = req.body || {};
    const hasUnitUpdate = Object.hasOwn(req.body || {}, "unit_id");
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    if (!profile || profile.role !== "manager") {
      return res.status(403).json({ error: "Manager access required." });
    }
    if (status && !["pending", "active", "ended"].includes(status)) {
      return res.status(400).json({ error: "Invalid assignment status." });
    }

    const { data: assignment, error: assignmentError } = await supabase
      .from("tenant_assignments")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (assignmentError) {
      return res.status(400).json({ error: publicDatabaseError(assignmentError) });
    }

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found." });
    }

    const { data: property } = await supabase
      .from("properties")
      .select("owner_id")
      .eq("id", assignment.property_id)
      .maybeSingle();

    if (!property || property.owner_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "You cannot update this assignment." });
    }
    if (hasUnitUpdate &&
        !(await hasValidUnitSelection(supabase, assignment.property_id, unit_id || null))) {
      return res.status(400).json({
        error: "Select an active unit in this property before updating the assignment.",
      });
    }

    const { data, error } = await supabase
      .from("tenant_assignments")
      .update({
        status: status || assignment.status,
        lease_end: lease_end || assignment.lease_end || null,
        ...(hasUnitUpdate ? { unit_id: unit_id || null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", assignment.id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    if (data.status === "ended") {
      const { data: remainingAssignments } = await supabase
        .from("tenant_assignments")
        .select("id")
        .eq("property_id", assignment.property_id)
        .eq("tenant_id", assignment.tenant_id)
        .in("status", ["pending", "active"]);
      if (!remainingAssignments?.length) {
        await supabase
          .from("property_members")
          .delete()
          .eq("property_id", assignment.property_id)
          .eq("user_id", assignment.tenant_id);
      }
      await createNotification(supabase, {
        userId: assignment.tenant_id,
        type: "lease",
        title: "Property assignment ended",
        message: "Your property assignment has ended.",
        entityType: "tenant_assignment",
        entityId: assignment.id,
      });
    }
    await recordActivity(supabase, {
      propertyId: assignment.property_id,
      actorId: req.user.id,
      entityType: "tenant_assignment",
      entityId: assignment.id,
      action: `assignment_${data.status}`,
      details: {
        tenant_id: assignment.tenant_id,
        unit_id: hasUnitUpdate ? data.unit_id : assignment.unit_id,
      },
    });

    return res.json({ assignment: data });
  }),
);

router.post(
  "/manager/tenants/invite",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const { email, full_name, property_id, unit_id, lease_start, lease_end } =
      req.body || {};
    if (!email || !full_name || !property_id || !lease_start)
      return res.status(400).json({
        error: "Name, email, property, and lease start are required.",
      });
    const { data: property } = await supabase
      .from("properties")
      .select("id, name")
      .eq("id", property_id)
      .eq("owner_id", req.user.id)
      .maybeSingle();
    if (!property)
      return res
        .status(403)
        .json({ error: "You do not manage this property." });
    if (lease_end && lease_end < lease_start)
      return res
        .status(400)
        .json({ error: "Lease end must be on or after lease start." });
    if (!(await hasValidUnitSelection(supabase, property_id, unit_id))) {
      return res.status(400).json({
        error: "Select an active unit in this property before assigning a tenant.",
      });
    }
    const { data: authUsers, error: usersError } =
      await supabase.auth.admin.listUsers();
    if (usersError) return res.status(400).json({ error: publicDatabaseError(usersError) });
    const existingUser = (authUsers?.users || []).find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );
    let tenantId = existingUser?.id;
    if (tenantId) {
      const existingProfile = await getUserProfile(supabase, tenantId);
      if (existingProfile?.role !== "tenant")
        return res.status(400).json({
          error: "That email already belongs to a non-tenant account.",
        });
      const { data: priorAssignments, error: priorError } = await supabase
        .from("tenant_assignments")
        .select("lease_start, lease_end, status")
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "active"]);
      if (priorError)
        return res.status(400).json({ error: publicDatabaseError(priorError) });
      const newStart = new Date(lease_start);
      const newEnd = lease_end ? new Date(lease_end) : null;
      const hasOverlap = (priorAssignments || []).some(
        (item) =>
          (!item.lease_end || newStart <= new Date(item.lease_end)) &&
          (!newEnd || new Date(item.lease_start) <= newEnd),
      );
      if (hasOverlap)
        return res.status(409).json({
          error: "This tenant already has an overlapping active lease period.",
        });
    } else {
      const { data: invitation, error: inviteError } =
        await supabase.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${process.env.FRONTEND_ORIGIN?.split(",")[0] || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:5173")}/reset-password`,
          data: { full_name },
        });
      if (inviteError)
        return res.status(400).json({ error: publicDatabaseError(inviteError) });
      tenantId = invitation.user.id;
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({ id: tenantId, full_name, role: "tenant" });
      if (profileError)
        return res.status(400).json({ error: publicDatabaseError(profileError) });
    }
    const { data: assignment, error: assignmentError } = await supabase
      .from("tenant_assignments")
      .insert({
        tenant_id: tenantId,
        property_id,
        unit_id: unit_id || null,
        lease_start,
        lease_end: lease_end || null,
        status: "active",
      })
      .select()
      .single();
    if (assignmentError)
      return res.status(400).json({ error: publicDatabaseError(assignmentError) });
    const { error: membershipError } = await supabase
      .from("property_members")
      .upsert(
        { property_id, user_id: tenantId, membership_role: "tenant" },
        { onConflict: "property_id,user_id" },
      );
    if (membershipError)
      return res.status(400).json({ error: publicDatabaseError(membershipError) });
    await recordActivity(supabase, {
      propertyId: property_id,
      actorId: req.user.id,
      entityType: "tenant_assignment",
      entityId: assignment.id,
      action: "tenant_invited_and_assigned",
      details: { tenant_id: tenantId, email },
    });
    return res
      .status(201)
      .json({ tenant: { id: tenantId, full_name, email }, assignment });
  }),
);

router.get(
  "/tenant/property",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const tenantProperty = await getTenantPropertyFromMembership(
      supabase,
      req.user.id,
    );

    if (!tenantProperty?.property_id || !tenantProperty.property) {
      return res.status(403).json({
        error: "You are not currently linked to an active property.",
        property: null,
      });
    }
    const property = tenantProperty.property;

    const unit = tenantProperty.unit_id
      ? await supabase
          .from("property_units")
          .select("id, unit_number, bedrooms, bathrooms")
          .eq("id", tenantProperty.unit_id)
          .maybeSingle()
      : { data: null, error: null };
    if (unit.error) return res.status(400).json({ error: publicDatabaseError(unit.error) });
    const { data: manager } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", property.owner_id)
      .maybeSingle();

    return res.json({
      assignment: {
        lease_start: tenantProperty.lease_start || null,
        lease_end: tenantProperty.lease_end || null,
        status: tenantProperty.status || "active",
      },
      property: {
        id: property.id,
        name: property.name,
        address: property.address,
        owner_id: property.owner_id,
        manager_name: manager?.full_name || null,
        unit: unit.data,
      },
    });
  }),
);

router.get(
  "/maintenance",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.json({ maintenanceRequests: [] });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    let query = supabase.from("maintenance_requests").select("*");
    if (profile?.role === "tenant") {
      query = query.eq("tenant_id", req.user.id);
    } else if (profile?.role === "maintenance_staff") {
      query = query.eq("assigned_to", req.user.id);
    } else if (profile?.role === "manager") {
      const propertyIds = await getOwnedPropertyIds(supabase, req.user.id);
      if (!propertyIds.length) return res.json({ maintenanceRequests: [] });
      query = query.in("property_id", propertyIds);
    } else {
      return res.status(403).json({
        error: "Maintenance access is not available for this account.",
      });
    }
    const { data, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    const requests = data || [];
    const unitlessTenantIds = [...new Set(
      requests
        .filter((request) => !request.unit_id && request.status !== "completed")
        .map((request) => request.tenant_id),
    )];
    const currentUnitByTenantProperty = new Map();
    if (unitlessTenantIds.length) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: activeAssignments, error: assignmentsError } = await supabase
        .from("tenant_assignments")
        .select("tenant_id, property_id, unit_id")
        .in("tenant_id", unitlessTenantIds)
        .eq("status", "active")
        .lte("lease_start", today)
        .or(`lease_end.is.null,lease_end.gte.${today}`);
      if (assignmentsError)
        return res.status(400).json({ error: publicDatabaseError(assignmentsError) });
      for (const assignment of activeAssignments || []) {
        if (assignment.unit_id) {
          currentUnitByTenantProperty.set(
            `${assignment.tenant_id}:${assignment.property_id}`,
            assignment.unit_id,
          );
        }
      }
    }

    const maintenanceRequests = await Promise.all(
      requests.map(async (request) => {
        const unitId = request.unit_id || (request.status !== "completed"
          ? currentUnitByTenantProperty.get(`${request.tenant_id}:${request.property_id}`)
          : null);
        const [tenantResult, propertyResult, unitResult, photoResult] =
          await Promise.all([
            supabase
              .from("profiles")
              .select("id, full_name")
              .eq("id", request.tenant_id)
              .maybeSingle(),
            supabase
              .from("properties")
              .select("id, name, address")
              .eq("id", request.property_id)
              .maybeSingle(),
            unitId
              ? supabase
                  .from("property_units")
                  .select("unit_number")
                  .eq("id", unitId)
                  .maybeSingle()
              : Promise.resolve({ data: null }),
            supabase
              .from("maintenance_photos")
              .select("id, object_path, file_name, content_type, uploaded_by, is_completion_proof, created_at")
              .eq("request_id", request.id)
              .order("created_at"),
          ]);
        for (const result of [tenantResult, propertyResult, unitResult, photoResult]) {
          if (result.error) throw result.error;
        }
        const photos = await Promise.all(
          (photoResult.data || []).map(async (photo) => {
            const { data: signed } = await supabase.storage
              .from("maintenance-photos")
              .createSignedUrl(photo.object_path, 3600);
            return { ...photo, url: signed?.signedUrl || null };
          }),
        );
        return {
          ...request,
          tenant: tenantResult.data,
          property: propertyResult.data,
          unit: unitResult.data,
          photos,
        };
      }),
    );
    return res.json({ maintenanceRequests });
  }),
);

router.post(
  "/maintenance",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { title, description, priority = "medium" } = req.body || {};

    const clientPropertyId = req.body?.property_id;

    if (typeof title !== "string" || !title.trim() || title.length > 200 ||
        typeof description !== "string" || !description.trim() || description.length > 10000 ||
        !["low", "medium", "high", "urgent"].includes(priority)) {
      return res
        .status(400)
        .json({ error: "Title and description are required." });
    }

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "tenant") {
      return res
        .status(403)
        .json({ error: "Only tenants can create maintenance requests." });
    }

    const tenantProperty = await getTenantPropertyFromMembership(
      supabase,
      req.user.id,
    );

    if (!tenantProperty || !tenantProperty.property_id) {
      return res.status(403).json({
        error: "You are not currently linked to an active property.",
      });
    }

    if (clientPropertyId && clientPropertyId !== tenantProperty.property_id) {
      return res.status(403).json({
        error:
          "Property association is determined from your active rental record and cannot be overridden.",
      });
    }

    const { data, error } = await supabase
      .from("maintenance_requests")
      .insert({
        property_id: tenantProperty.property_id,
        unit_id: tenantProperty.unit_id || null,
        tenant_id: req.user.id,
        title: title.trim(),
        description: description.trim(),
        priority,
        due_at: new Date(
          Date.now() +
            ({ urgent: 4, high: 24, medium: 72, low: 168 }[priority] || 72) *
              60 *
              60 *
              1000,
        ).toISOString(),
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    await Promise.all([
      createNotification(supabase, {
        userId: tenantProperty.property.owner_id,
        type: "maintenance",
        title: "New maintenance request",
        message: title,
        entityType: "maintenance_request",
        entityId: data.id,
      }),
      recordActivity(supabase, {
        propertyId: tenantProperty.property_id,
        actorId: req.user.id,
        entityType: "maintenance_request",
        entityId: data.id,
        action: "request_created",
        details: { title },
      }),
    ]);

    return res.status(201).json({ maintenanceRequest: data });
  }),
);

router.patch(
  "/maintenance/:id/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status, action, resolution_notes, review_notes } = req.body || {};
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const access = await getAccessibleMaintenanceRequest(
      supabase,
      req.params.id,
      req.user.id,
    );
    if (!access.request)
      return res.status(404).json({ error: "Maintenance request not found." });
    if (!access.isManager && !access.isAssignedStaff) {
      return res.status(403).json({
        error:
          "Only the property manager or assigned staff can update this request.",
      });
    }

    const now = new Date().toISOString();
    let changes;
    let activityAction;
    let notificationMessage;
    let notificationUserId = access.request.tenant_id;

    if (action === "approve_completion" || action === "request_changes") {
      if (!access.isManager) {
        return res.status(403).json({ error: "Manager access required." });
      }
      if (!access.request.completion_submitted_at) {
        return res.status(400).json({ error: "There is no staff completion awaiting review." });
      }
      if (action === "request_changes" &&
          (typeof review_notes !== "string" || !review_notes.trim() || review_notes.length > 10000)) {
        return res.status(400).json({ error: "Explain what needs to be changed before sending the task back." });
      }
      if (action === "approve_completion") {
        changes = {
          status: "completed",
          completion_reviewed_at: now,
          completion_reviewed_by: req.user.id,
          completion_review_notes: null,
          resolved_at: now,
          updated_at: now,
        };
        activityAction = "request_completed";
        notificationMessage = `Resolved: ${access.request.title}`;
      } else {
        const feedback = review_notes.trim();
        changes = {
          status: "in_progress",
          completion_submitted_at: null,
          completion_reviewed_at: now,
          completion_reviewed_by: req.user.id,
          completion_review_notes: feedback,
          resolved_at: null,
          updated_at: now,
        };
        activityAction = "completion_changes_requested";
        notificationMessage = `More work is needed on ${access.request.title}.`;
        notificationUserId = access.request.assigned_to;
      }
    } else if (status === "completed") {
      if (!access.isAssignedStaff) {
        return res.status(403).json({ error: "Only assigned staff can submit work for manager review." });
      }
      if (access.request.status !== "in_progress" || access.request.completion_submitted_at) {
        return res.status(400).json({ error: "Start the task before submitting it, and wait for manager review before resubmitting." });
      }
      if (typeof resolution_notes !== "string" || !resolution_notes.trim() || resolution_notes.length > 10000) {
        return res.status(400).json({ error: "Add resolution notes before submitting this task for review." });
      }
      const { data: proofPhotos, error: proofError } = await supabase
        .from("maintenance_photos")
        .select("id")
        .eq("request_id", access.request.id)
        .eq("uploaded_by", req.user.id)
        .eq("is_completion_proof", true);
      if (proofError) throw proofError;
      if (!proofPhotos?.length) {
        return res.status(400).json({ error: "Upload at least one completion proof photo before submitting the task." });
      }
      changes = {
        completion_submitted_at: now,
        completion_reviewed_at: null,
        completion_reviewed_by: null,
        completion_review_notes: null,
        resolution_notes: resolution_notes.trim(),
        updated_at: now,
      };
      activityAction = "completion_submitted";
      notificationMessage = `Work is ready for review: ${access.request.title}`;
      notificationUserId = access.property?.owner_id;
    } else if (["pending", "in_progress"].includes(status)) {
      if (access.request.status === "completed") {
        return res.status(409).json({ error: "Completed maintenance requests cannot be reopened through this status action." });
      }
      if (status === "pending" && !access.isManager) {
        return res.status(403).json({ error: "Only the property manager can return a task to pending." });
      }
      if (access.request.completion_submitted_at) {
        return res.status(400).json({ error: "The manager must review the submitted work before changing its status." });
      }
      changes = { status, updated_at: now };
      activityAction = `request_${status}`;
      notificationMessage = `${access.request.title} is now ${status.replace("_", " ")}.`;
    } else {
      return res.status(400).json({
        error: "A valid maintenance status or manager review action is required.",
      });
    }

    const { data, error } = await supabase
      .from("maintenance_requests")
      .update(changes)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    await createNotification(supabase, {
      userId: notificationUserId,
      type: "maintenance",
      title: action === "approve_completion" ? "Maintenance work approved" :
        action === "request_changes" ? "Maintenance work needs changes" :
          status === "completed" ? "Work submitted for manager review" : "Maintenance request updated",
      message: notificationMessage,
      entityType: "maintenance_request",
      entityId: data.id,
    });
    await recordActivity(supabase, {
      propertyId: data.property_id,
      actorId: req.user.id,
      entityType: "maintenance_request",
      entityId: data.id,
      action: activityAction,
      details: {
        title: data.title,
        resolution_notes: data.resolution_notes,
        review_notes: data.completion_review_notes,
      },
    });

    return res.json({ maintenanceRequest: data });
  }),
);

router.get(
  "/maintenance/:id/comments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const access = await getAccessibleMaintenanceRequest(
      supabase,
      req.params.id,
      req.user.id,
    );
    if (
      !access.request ||
      (!access.isManager && !access.isTenant && !access.isAssignedStaff)
    ) {
      return res.status(404).json({ error: "Maintenance request not found." });
    }
    let query = supabase
      .from("maintenance_comments")
      .select("*")
      .eq("request_id", req.params.id)
      .order("created_at");
    if (access.isTenant) query = query.eq("is_internal", false);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    const comments = await Promise.all(
      (data || []).map(async (comment) => {
        const { data: author } = await supabase
          .from("profiles")
          .select("id, full_name, role")
          .eq("id", comment.author_id)
          .maybeSingle();
        return { ...comment, author };
      }),
    );
    return res.json({ comments });
  }),
);

router.post(
  "/maintenance/:id/comments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const access = await getAccessibleMaintenanceRequest(
      supabase,
      req.params.id,
      req.user.id,
    );
    if (
      !access.request ||
      (!access.isManager && !access.isTenant && !access.isAssignedStaff)
    ) {
      return res.status(404).json({ error: "Maintenance request not found." });
    }
    if (typeof req.body?.body !== "string" || req.body.body.length > 10000 ||
        (req.body.is_internal !== undefined && typeof req.body.is_internal !== "boolean"))
      return res.status(400).json({ error: "A comment of at most 10000 characters and a boolean visibility setting are required." });
    const body = req.body.body.trim();
    const isInternal = req.body.is_internal === true;
    if (!body)
      return res.status(400).json({ error: "Comment text is required." });
    if (isInternal && !access.isManager && !access.isAssignedStaff) {
      return res.status(403).json({
        error: "Only managers and assigned staff can add internal comments.",
      });
    }
    const { error } = await req.supabase
      .from("maintenance_comments")
      .insert({
        request_id: access.request.id,
        author_id: req.user.id,
        body,
        is_internal: isInternal,
      });
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    if (!isInternal && req.user.id !== access.request.tenant_id) {
      await createNotification(supabase, {
        userId: access.request.tenant_id,
        type: "maintenance",
        title: "Maintenance update",
        message: body,
        entityType: "maintenance_request",
        entityId: access.request.id,
      });
    }
    await recordActivity(supabase, {
      propertyId: access.request.property_id,
      actorId: req.user.id,
      entityType: "maintenance_request",
      entityId: access.request.id,
      action: "comment_added",
      details: { internal: isInternal },
    });
    return res.status(201).json({ success: true });
  }),
);

router.post(
  "/maintenance/:id/photos/upload-url",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const access = await getAccessibleMaintenanceRequest(
      supabase,
      req.params.id,
      req.user.id,
    );
    if (
      !access.request ||
      (!access.isManager && !access.isTenant && !access.isAssignedStaff)
    ) {
      return res.status(404).json({ error: "Maintenance request not found." });
    }

    const { file_name, content_type, is_completion_proof = false } = req.body || {};
    if (
      typeof file_name !== "string" ||
      !file_name.trim() ||
      file_name.length > 255 ||
      !["image/jpeg", "image/png", "image/webp", "image/heic"].includes(content_type) ||
      typeof is_completion_proof !== "boolean"
    ) {
      return res.status(400).json({ error: "Valid image filename, content type, and proof flag are required." });
    }
    if (
      is_completion_proof &&
      (!access.isAssignedStaff ||
        access.request.status !== "in_progress" ||
        access.request.completion_submitted_at)
    ) {
      return res.status(403).json({
        error: "Only assigned staff can upload completion proof while work is in progress.",
      });
    }
    if (access.isAssignedStaff && !is_completion_proof) {
      return res.status(400).json({ error: "Staff uploads must be marked as completion proof." });
    }

    const { count, error: countError } = await supabase
      .from("maintenance_photos")
      .select("id", { head: true, count: "exact" })
      .eq("request_id", access.request.id);
    if (countError) throw countError;
    if ((count || 0) >= 5) {
      return res.status(400).json({ error: "A request can include at most five photos." });
    }

    const extensionByType = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
    };
    const objectPath = `${access.request.id}/${randomUUID()}.${extensionByType[content_type]}`;
    const { data, error } = await supabase.storage
      .from("maintenance-photos")
      .createSignedUploadUrl(objectPath);
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    return res.json({ object_path: data.path, token: data.token });
  }),
);

router.post(
  "/maintenance/:id/photos",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const access = await getAccessibleMaintenanceRequest(
      supabase,
      req.params.id,
      req.user.id,
    );
    if (
      !access.request ||
      (!access.isManager && !access.isTenant && !access.isAssignedStaff)
    ) {
      return res.status(404).json({ error: "Maintenance request not found." });
    }
    const photos = Array.isArray(req.body?.photos) ? req.body.photos : [];
    const isCompletionProof = req.body?.is_completion_proof === true;
    if (req.body?.is_completion_proof !== undefined && typeof req.body.is_completion_proof !== "boolean") {
      return res.status(400).json({ error: "Photo proof metadata is invalid." });
    }
    if (isCompletionProof &&
        (!access.isAssignedStaff || access.request.status !== "in_progress" || access.request.completion_submitted_at)) {
      return res.status(403).json({ error: "Only assigned staff can attach completion proof while work is in progress." });
    }
    if (access.isAssignedStaff && !isCompletionProof) {
      return res.status(400).json({ error: "Staff uploads must be marked as completion proof." });
    }
    if (!photos.length)
      return res
        .status(400)
        .json({ error: "At least one uploaded photo is required." });
    if (photos.length > 5)
      return res
        .status(400)
        .json({ error: "A request can include at most five photos." });
    const { count: photoCount, error: photoCountError } = await supabase
      .from("maintenance_photos").select("id", { head: true, count: "exact" }).eq("request_id", access.request.id);
    if (photoCountError) throw photoCountError;
    if ((photoCount || 0) + photos.length > 5)
      return res.status(400).json({ error: "A request can include at most five photos in total." });
    for (const photo of photos) {
      if (
        typeof photo.object_path !== "string" ||
        !photo.object_path?.startsWith(`${access.request.id}/`) ||
        typeof photo.file_name !== "string" || !photo.file_name.trim() ||
        !/^image\/(jpeg|png|webp|heic)$/.test(photo.content_type || "")
      ) {
        return res.status(400).json({ error: "Photo metadata is invalid." });
      }
      const { data: stored, error: storageError } = await supabase.storage
        .from("maintenance-photos").list(access.request.id, { search: photo.object_path.slice(access.request.id.length + 1) });
      if (storageError) throw storageError;
      if (!stored?.some((file) => file.name === photo.object_path.slice(access.request.id.length + 1)))
        return res.status(400).json({ error: "Upload each photo before attaching it to the request." });
    }
    const { data, error } = await supabase
      .from("maintenance_photos")
      .insert(
        photos.map((photo) => ({
          request_id: access.request.id,
          uploaded_by: req.user.id,
          object_path: photo.object_path,
          file_name: photo.file_name,
          content_type: photo.content_type,
          is_completion_proof: isCompletionProof,
        })),
      )
      .select();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    return res.status(201).json({ photos: data || [] });
  }),
);

router.patch(
  "/manager/maintenance/:id/assignment",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const access = await getAccessibleMaintenanceRequest(
      supabase,
      req.params.id,
      req.user.id,
    );
    if (!access.request || !access.isManager)
      return res.status(404).json({ error: "Maintenance request not found." });
    if (access.request.completion_submitted_at)
      return res.status(409).json({ error: "Review or return the submitted work before changing its assignment." });
    const staffId = req.body?.staff_id || null;
    if (staffId) {
      const { data: staff } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", staffId)
        .maybeSingle();
      const { data: member } = await supabase
        .from("property_members")
        .select("id")
        .eq("user_id", staffId)
        .eq("property_id", access.request.property_id)
        .eq("membership_role", "maintenance_staff")
        .maybeSingle();
      if (staff?.role !== "maintenance_staff" || !member)
        return res
          .status(400)
          .json({ error: "Select staff assigned to this property." });
    }
    const { data, error } = await supabase
      .from("maintenance_requests")
      .update({ assigned_to: staffId, updated_at: new Date().toISOString() })
      .eq("id", access.request.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    if (staffId)
      await createNotification(supabase, {
        userId: staffId,
        type: "maintenance",
        title: "Task assigned",
        message: data.title,
        entityType: "maintenance_request",
        entityId: data.id,
      });
    await recordActivity(supabase, {
      propertyId: data.property_id,
      actorId: req.user.id,
      entityType: "maintenance_request",
      entityId: data.id,
      action: staffId ? "staff_assigned" : "staff_unassigned",
      details: { staff_id: staffId },
    });
    return res.json({ maintenanceRequest: data });
  }),
);

router.get(
  "/amenities",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.json({ amenities: [] });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    let propertyIds = [];
    if (profile?.role === "manager")
      propertyIds = await getOwnedPropertyIds(supabase, req.user.id);
    else if (profile?.role === "tenant") {
      const tenantProperty = await getTenantPropertyFromMembership(
        supabase,
        req.user.id,
      );
      if (tenantProperty?.property_id)
        propertyIds = [tenantProperty.property_id];
    } else if (profile?.role === "maintenance_staff") {
      const { data: memberships } = await supabase
        .from("property_members")
        .select("property_id")
        .eq("user_id", req.user.id)
        .eq("membership_role", "maintenance_staff");
      propertyIds = [
        ...new Set((memberships || []).map((member) => member.property_id)),
      ];
    }
    if (!propertyIds.length) return res.json({ amenities: [] });
    let query = supabase
      .from("amenities")
      .select("*")
      .in("property_id", propertyIds);
    if (profile?.role !== "manager") query = query.eq("is_active", true);
    const { data, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    return res.json({ amenities: data || [] });
  }),
);

router.post(
  "/amenities",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      property_id,
      name,
      description,
      opening_time,
      closing_time,
      slot_duration_minutes,
      is_active = true,
    } = req.body || {};

    if (!property_id || !name) {
      return res
        .status(400)
        .json({ error: "Property and amenity name are required." });
    }

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const { data: property } = await supabase
      .from("properties")
      .select("id")
      .eq("id", property_id)
      .eq("owner_id", req.user.id)
      .maybeSingle();
    if (!property)
      return res
        .status(403)
        .json({ error: "You do not manage this property." });

    const { data, error } = await supabase
      .from("amenities")
      .insert({
        property_id,
        name,
        description,
        opening_time,
        closing_time,
        slot_duration_minutes,
        is_active,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    await recordActivity(supabase, {
      propertyId: property_id,
      actorId: req.user.id,
      entityType: "amenity",
      entityId: data.id,
      action: "amenity_created",
      details: { name },
    });

    return res.status(201).json({ amenity: data });
  }),
);

router.patch(
  "/amenities/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const { data: current, error: currentError } = await supabase
      .from("amenities")
      .select("id, property_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (currentError)
      return res.status(400).json({ error: publicDatabaseError(currentError) });
    if (!current) return res.status(404).json({ error: "Amenity not found." });
    const { data: property } = await supabase
      .from("properties")
      .select("id")
      .eq("id", current.property_id)
      .eq("owner_id", req.user.id)
      .maybeSingle();
    if (!property)
      return res.status(403).json({ error: "You do not manage this amenity." });
    const allowedFields = [
      "name",
      "description",
      "opening_time",
      "closing_time",
      "slot_duration_minutes",
      "is_active",
    ];
    const update = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) =>
        allowedFields.includes(key),
      ),
    );
    const { data, error } = await supabase
      .from("amenities")
      .update(update)
      .eq("id", current.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    await recordActivity(supabase, {
      propertyId: current.property_id,
      actorId: req.user.id,
      entityType: "amenity",
      entityId: data.id,
      action: "amenity_updated",
      details: { name: data.name },
    });
    return res.json({ amenity: data });
  }),
);

router.get(
  "/amenities/:id/availability",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { date } = req.query || {};
    if (date !== undefined && !isValidDate(date))
      return res.status(400).json({ error: "A valid availability date is required." });
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.json({ slots: [] });
    }

    const { data: amenity, error: amenityError } = await supabase
      .from("amenities")
      .select("id, property_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (amenityError)
      return res.status(400).json({ error: publicDatabaseError(amenityError) });
    if (!amenity) return res.status(404).json({ error: "Amenity not found." });
    const profile = await getUserProfile(supabase, req.user.id);
    let canView = false;
    if (profile?.role === "manager") {
      const { data: property } = await supabase
        .from("properties")
        .select("id")
        .eq("id", amenity.property_id)
        .eq("owner_id", req.user.id)
        .maybeSingle();
      canView = Boolean(property);
    } else if (profile?.role === "tenant") {
      const tenantProperty = await getTenantPropertyFromMembership(
        supabase,
        req.user.id,
      );
      canView = tenantProperty?.property_id === amenity.property_id;
    } else if (profile?.role === "maintenance_staff") {
      const { data: membership } = await supabase
        .from("property_members")
        .select("id")
        .eq("user_id", req.user.id)
        .eq("property_id", amenity.property_id)
        .eq("membership_role", "maintenance_staff")
        .maybeSingle();
      canView = Boolean(membership);
    }
    if (!canView)
      return res
        .status(403)
        .json({ error: "You cannot view this property's availability." });
    const { data, error } = await supabase
      .from("amenity_bookings")
      .select("check_in_time, check_out_time")
      .eq("amenity_id", req.params.id)
      .eq("booking_date", date || new Date().toISOString().slice(0, 10))
      .eq("status", "confirmed");

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    const { data: availabilityProperty, error: availabilityPropertyError } = await supabase
      .from("properties").select("timezone").eq("id", amenity.property_id).single();
    if (availabilityPropertyError) throw availabilityPropertyError;
    return res.json({ slots: data || [], local_now: getLocalDateAndMinutes(availabilityProperty.timezone), timezone: availabilityProperty.timezone });
  }),
);

router.get(
  "/bookings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.json({ bookings: [] });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    let query = supabase.from("amenity_bookings").select("*");
    if (profile?.role === "tenant") {
      query = query.eq("user_id", req.user.id);
    } else if (profile?.role === "manager") {
      const propertyIds = await getOwnedPropertyIds(supabase, req.user.id);
      if (!propertyIds.length) return res.json({ bookings: [] });
      query = query.in("property_id", propertyIds);
    } else if (profile?.role === "maintenance_staff") {
      const { data: memberships, error: membershipError } = await supabase
        .from("property_members")
        .select("property_id")
        .eq("user_id", req.user.id)
        .eq("membership_role", "maintenance_staff")
        .eq("can_manage_bookings", true);
      if (membershipError)
        return res.status(400).json({ error: publicDatabaseError(membershipError) });
      const propertyIds = [
        ...new Set((memberships || []).map((member) => member.property_id)),
      ];
      if (!propertyIds.length) return res.json({ bookings: [] });
      query = query.in("property_id", propertyIds);
    } else {
      return res
        .status(403)
        .json({ error: "Booking access is not available for this account." });
    }
    const { data, error } = await query.order("booking_date", {
      ascending: true,
    });

    if (error) {
      return res.status(400).json({ error: publicDatabaseError(error) });
    }

    const bookings = await Promise.all(
      (data || []).map(async (booking) => {
        const [amenityResult, propertyResult, userResult, disputeResult] =
          await Promise.all([
            supabase
              .from("amenities")
              .select("name")
              .eq("id", booking.amenity_id)
              .maybeSingle(),
            supabase
              .from("properties")
              .select(
                "name, address, owner_id, timezone, booking_cancellation_hours",
              )
              .eq("id", booking.property_id)
              .maybeSingle(),
            profile?.role === "manager" || booking.user_id === req.user.id
              ? supabase
                  .from("profiles")
                  .select("full_name")
                  .eq("id", booking.user_id)
                  .maybeSingle()
              : Promise.resolve({ data: null }),
            profile?.role === "manager" || booking.user_id === req.user.id
              ? supabase
                  .from("booking_disputes")
                  .select("id, status, details, resolution, created_at")
                  .eq("booking_id", booking.id)
                  .order("created_at", { ascending: false })
              : Promise.resolve({ data: [] }),
          ]);
        const safeBooking = { ...booking };
        if (profile?.role === "maintenance_staff") delete safeBooking.user_id;
        return {
          ...safeBooking,
          amenity: amenityResult.data,
          property: propertyResult.data,
          user: userResult.data,
          disputes: disputeResult.data || [],
        };
      }),
    );
    return res.json({ bookings });
  }),
);

router.post(
  "/bookings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      amenity_id,
      property_id,
      booking_date,
      check_in_time,
      check_out_time,
      status = "confirmed",
    } = req.body || {};

    if (
      !amenity_id ||
      !property_id ||
      !booking_date ||
      !check_in_time ||
      !check_out_time
    ) {
      return res
        .status(400)
        .json({ error: "Amenity, property, date, and times are required." });
    }

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const amenityResult = await supabase
      .from("amenities")
      .select("*")
      .eq("id", amenity_id)
      .single();
    if (amenityResult.error || !amenityResult.data) {
      return res.status(404).json({ error: "Amenity not found." });
    }

    if (amenityResult.data.property_id !== property_id) {
      return res.status(400).json({
        error: "The selected amenity does not belong to the selected property.",
      });
    }

    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role === "manager") {
      const { data: property, error: propertyError } = await supabase
        .from("properties")
        .select("owner_id")
        .eq("id", property_id)
        .maybeSingle();

      if (propertyError) {
        return res.status(400).json({ error: publicDatabaseError(propertyError) });
      }
      if (!property || property.owner_id !== req.user.id) {
        return res
          .status(403)
          .json({ error: "You do not manage this property." });
      }
    } else if (profile?.role === "tenant") {
      const tenantProperty = await getTenantPropertyFromMembership(
        supabase,
        req.user.id,
      );
      if (tenantProperty?.property_id !== property_id) {
        return res.status(403).json({
          error: "You can only book amenities at your linked property.",
        });
      }
    } else {
      return res
        .status(403)
        .json({ error: "Booking access is not available for this account." });
    }

    const { data: bookingProperty, error: bookingPropertyError } = await supabase
      .from("properties").select("timezone").eq("id", property_id).single();
    if (bookingPropertyError) throw bookingPropertyError;
    if (status !== "confirmed")
      return res.status(400).json({ error: "New bookings must be confirmed." });
    const validation = validateAmenityBookingRequest({
      bookingDate: booking_date,
      checkInTime: check_in_time,
      checkOutTime: check_out_time,
      openingTime: amenityResult.data.opening_time || "09:00",
      closingTime: amenityResult.data.closing_time || "21:00",
      isActive: amenityResult.data.is_active,
      minBookingMinutes: amenityResult.data.slot_duration_minutes,
      localNow: getLocalDateAndMinutes(bookingProperty.timezone),
    });

    if (!validation.valid) {
      return res.status(400).json({ error: publicDatabaseError(validation) });
    }

    const slotLength = Number(amenityResult.data.slot_duration_minutes) || 60;
    const startOffset =
      toMinutes(check_in_time) -
      toMinutes(amenityResult.data.opening_time || "09:00");
    const bookingLength = toMinutes(check_out_time) - toMinutes(check_in_time);
    if (startOffset % slotLength !== 0 || bookingLength % slotLength !== 0) {
      return res.status(400).json({
        error: `Bookings must use ${slotLength}-minute amenity slots.`,
      });
    }

    const { data: existingBookings, error: existingBookingsError } = await supabase
      .from("amenity_bookings")
      .select("booking_date, check_in_time, check_out_time, status")
      .eq("amenity_id", amenity_id)
      .eq("booking_date", booking_date)
      .eq("status", "confirmed");
    if (existingBookingsError) throw existingBookingsError;

    const hasOverlap = (existingBookings || []).some((booking) => {
      return (
        booking.booking_date === booking_date &&
        timesOverlap(
          check_in_time,
          check_out_time,
          booking.check_in_time,
          booking.check_out_time,
        )
      );
    });

    if (hasOverlap) {
      return res.status(409).json({
        error: "This amenity slot is already booked for the selected time.",
      });
    }

    const { data, error } = await supabase
      .from("amenity_bookings")
      .insert({
        amenity_id,
        property_id,
        user_id: req.user.id,
        booking_date,
        check_in_time,
        check_out_time,
        status,
      })
      .select()
      .single();

    if (error) {
      return res.status(409).json({
        error:
          "Booking conflict detected. Another reservation already exists for that slot.",
      });
    }

    const { data: property } = await supabase
      .from("properties")
      .select("owner_id")
      .eq("id", property_id)
      .maybeSingle();
    await Promise.all([
      createNotification(supabase, {
        userId: req.user.id,
        type: "booking",
        title: "Booking confirmed",
        message: `${amenityResult.data.name} · ${booking_date} ${formatTime(check_in_time)}`,
        entityType: "booking",
        entityId: data.id,
      }),
      createNotification(supabase, {
        userId: property?.owner_id,
        type: "booking",
        title: "New amenity booking",
        message: `${amenityResult.data.name} · ${booking_date} ${formatTime(check_in_time)}`,
        entityType: "booking",
        entityId: data.id,
      }),
      recordActivity(supabase, {
        propertyId: property_id,
        actorId: req.user.id,
        entityType: "booking",
        entityId: data.id,
        action: "booking_created",
        details: { amenity: amenityResult.data.name, booking_date },
      }),
    ]);

    return res.status(201).json({ booking: data });
  }),
);

router.patch(
  "/bookings/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const action = req.body?.action;
    if (!["check_in", "check_out", "cancel"].includes(action))
      return res
        .status(400)
        .json({ error: "Select check-in, check-out, or cancel." });
    const { data: booking, error } = await supabase
      .from("amenity_bookings")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    if (!booking) return res.status(404).json({ error: "Booking not found." });
    const profile = await getUserProfile(supabase, req.user.id);
    const isOwner =
      profile?.role === "tenant" && booking.user_id === req.user.id;
    const { data: property } = await supabase
      .from("properties")
      .select("owner_id, booking_cancellation_hours, timezone")
      .eq("id", booking.property_id)
      .maybeSingle();
    const isManager =
      profile?.role === "manager" && property?.owner_id === req.user.id;
    const { data: staffMembership } =
      profile?.role === "maintenance_staff"
        ? await supabase
            .from("property_members")
            .select("id, can_manage_bookings")
            .eq("user_id", req.user.id)
            .eq("property_id", booking.property_id)
            .eq("membership_role", "maintenance_staff")
            .maybeSingle()
        : { data: null };
    const isStaff = Boolean(staffMembership?.can_manage_bookings);
    if (!isOwner && !isManager && !isStaff)
      return res.status(403).json({ error: "You cannot manage this booking." });

    const now = new Date();
    let update;
    if (action === "cancel") {
      if (!isOwner && !isManager)
        return res.status(403).json({
          error: "Only the tenant or property manager can cancel this booking.",
        });
      if (booking.status !== "confirmed" || booking.checked_in_at)
        return res
          .status(400)
          .json({ error: "Only confirmed bookings can be cancelled." });
      const localNow = getLocalDateAndMinutes(property?.timezone, now);
      const minutesToStart = minutesUntilBooking(
        booking.booking_date,
        toMinutes(booking.check_in_time),
        localNow,
      );
      if (minutesToStart <= 0)
        return res.status(400).json({
          error: "Bookings cannot be cancelled after the reserved time has started.",
        });
      update = {
        status: "cancelled",
        cancelled_at: now.toISOString(),
        cancelled_by: req.user.id,
      };
    } else if (action === "check_in") {
      if (booking.status !== "confirmed" || booking.checked_in_at)
        return res
          .status(400)
          .json({ error: "This booking cannot be checked in." });
      const localNow = getLocalDateAndMinutes(property?.timezone, now);
      if (localNow.date !== booking.booking_date || localNow.minutes < toMinutes(booking.check_in_time) || localNow.minutes >= toMinutes(booking.check_out_time))
        return res.status(400).json({ error: "Check in during the reserved time slot." });
      update = { checked_in_at: now.toISOString() };
    } else {
      if (
        booking.status !== "confirmed" ||
        !booking.checked_in_at ||
        booking.checked_out_at
      )
        return res.status(400).json({ error: "Check in before checking out." });
      update = { checked_out_at: now.toISOString(), status: "completed" };
    }

    const { data, error: updateError } = await supabase
      .from("amenity_bookings")
      .update(update)
      .eq("id", booking.id)
      .eq("status", booking.status)
      .is("checked_out_at", null)
      .filter("checked_in_at", booking.checked_in_at ? "eq" : "is", booking.checked_in_at || null)
      .select()
      .maybeSingle();
    if (!updateError && !data)
      return res.status(409).json({ error: "Booking changed. Refresh before trying again." });
    if (updateError)
      return res.status(400).json({ error: publicDatabaseError(updateError) });
    if (action !== "cancel")
      await createNotification(supabase, {
        userId: booking.user_id,
        type: "booking",
        title: action === "check_in" ? "Amenity check-in recorded" : "Amenity check-out recorded",
        message: `${booking.booking_date} · ${formatTime(booking.check_in_time)}`,
        entityType: "booking",
        entityId: booking.id,
      });
    if (action === "cancel" && !isOwner)
      await createNotification(supabase, {
        userId: booking.user_id,
        type: "booking",
        title: "Booking cancelled",
        message: "Your amenity booking was cancelled by management.",
        entityType: "booking",
        entityId: booking.id,
      });
    await recordActivity(supabase, {
      propertyId: booking.property_id,
      actorId: req.user.id,
      entityType: "booking",
      entityId: booking.id,
      action: `booking_${action}`,
      details: {},
    });
    return res.json({ booking: data });
  }),
);

router.post(
  "/bookings/:id/disputes",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "tenant")
      return res
        .status(403)
        .json({ error: "Only tenants can raise booking disputes." });
    const details = String(req.body?.details || "").trim();
    if (!details)
      return res.status(400).json({ error: "Describe the booking issue." });
    const { data: booking, error: bookingError } = await supabase
      .from("amenity_bookings")
      .select("id, property_id, user_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (bookingError)
      return res.status(400).json({ error: publicDatabaseError(bookingError) });
    if (!booking || booking.user_id !== req.user.id)
      return res.status(404).json({ error: "Booking not found." });
    const { data: existing } = await supabase
      .from("booking_disputes")
      .select("id")
      .eq("booking_id", booking.id)
      .eq("status", "open")
      .maybeSingle();
    if (existing)
      return res
        .status(409)
        .json({ error: "There is already an open dispute for this booking." });
    const { data, error } = await supabase
      .from("booking_disputes")
      .insert({ booking_id: booking.id, raised_by: req.user.id, details })
      .select()
      .single();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    const { data: property } = await supabase
      .from("properties")
      .select("owner_id")
      .eq("id", booking.property_id)
      .maybeSingle();
    await createNotification(supabase, {
      userId: property?.owner_id,
      type: "booking_dispute",
      title: "Booking dispute raised",
      message: details,
      entityType: "booking_dispute",
      entityId: data.id,
    });
    await recordActivity(supabase, {
      propertyId: booking.property_id,
      actorId: req.user.id,
      entityType: "booking_dispute",
      entityId: data.id,
      action: "dispute_raised",
      details: {},
    });
    return res.status(201).json({ dispute: data });
  }),
);

router.get(
  "/manager/booking-disputes",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const propertyIds = await getOwnedPropertyIds(supabase, req.user.id);
    if (!propertyIds.length) return res.json({ disputes: [] });
    const { data: bookings, error: bookingsError } = await supabase
      .from("amenity_bookings")
      .select(
        "id, property_id, user_id, amenity_id, booking_date, check_in_time, check_out_time, status",
      )
      .in("property_id", propertyIds);
    if (bookingsError)
      return res.status(400).json({ error: publicDatabaseError(bookingsError) });
    const bookingById = new Map(
      (bookings || []).map((booking) => [booking.id, booking]),
    );
    const { data, error } = await supabase
      .from("booking_disputes")
      .select("*")
      .in("booking_id", [...bookingById.keys()])
      .order("created_at", { ascending: false });
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    const disputes = await Promise.all(
      (data || []).map(async (dispute) => {
        const booking = bookingById.get(dispute.booking_id);
        const [amenityResult, tenantResult] = await Promise.all([
          supabase
            .from("amenities")
            .select("name")
            .eq("id", booking.amenity_id)
            .maybeSingle(),
          supabase
            .from("profiles")
            .select("full_name")
            .eq("id", booking.user_id)
            .maybeSingle(),
        ]);
        return {
          ...dispute,
          booking,
          amenity: amenityResult.data,
          tenant: tenantResult.data,
        };
      }),
    );
    return res.json({ disputes });
  }),
);

router.patch(
  "/manager/booking-disputes/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const supabase = createSupabaseAdminClient();
    if (!supabase)
      return res.status(500).json({ error: "Supabase is not configured." });
    const profile = await getUserProfile(supabase, req.user.id);
    if (profile?.role !== "manager")
      return res.status(403).json({ error: "Manager access required." });
    const status = req.body?.status;
    const resolution = String(req.body?.resolution || "").trim();
    if (!["resolved", "dismissed"].includes(status) || !resolution)
      return res.status(400).json({
        error: "Choose a resolution status and provide resolution notes.",
      });
    const { data: dispute, error: disputeError } = await supabase
      .from("booking_disputes")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (disputeError)
      return res.status(400).json({ error: publicDatabaseError(disputeError) });
    if (!dispute) return res.status(404).json({ error: "Dispute not found." });
    const { data: booking } = await supabase
      .from("amenity_bookings")
      .select("property_id, user_id")
      .eq("id", dispute.booking_id)
      .maybeSingle();
    const { data: property } = await supabase
      .from("properties")
      .select("owner_id")
      .eq("id", booking?.property_id)
      .maybeSingle();
    if (!booking || property?.owner_id !== req.user.id)
      return res.status(403).json({ error: "You do not manage this dispute." });
    const { data, error } = await supabase
      .from("booking_disputes")
      .update({
        status,
        resolution,
        resolved_by: req.user.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", dispute.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: publicDatabaseError(error) });
    await createNotification(supabase, {
      userId: booking.user_id,
      type: "booking_dispute",
      title: "Booking dispute updated",
      message: resolution,
      entityType: "booking_dispute",
      entityId: dispute.id,
    });
    await recordActivity(supabase, {
      propertyId: booking.property_id,
      actorId: req.user.id,
      entityType: "booking_dispute",
      entityId: dispute.id,
      action: `dispute_${status}`,
      details: {},
    });
    return res.json({ dispute: data });
  }),
);

export default router;
