import { PLANS } from '../config/constants.js';
import { SystemSetting, Subscription } from '../models/index.js';

/**
 * Plan definitions = code defaults + any overrides a super admin saved under
 * the `planOverrides` system setting. Cached briefly; every entitlement check
 * goes through here so the frontend never decides what a clinic may do.
 */
let cache = { at: 0, plans: null };
const TTL_MS = 30_000;

export async function getPlans() {
  if (cache.plans && cache.at > Date.now() - TTL_MS) return cache.plans;
  const setting = await SystemSetting.findOne({ key: 'planOverrides' }).lean();
  const overrides = setting?.value || {};
  const plans = {};
  for (const [name, base] of Object.entries(PLANS)) {
    const o = overrides[name] || {};
    plans[name] = {
      ...base,
      ...(o.price !== undefined ? { price: o.price } : {}),
      ...(o.maxDoctors !== undefined ? { maxDoctors: o.maxDoctors ?? Infinity } : {}),
      ...(o.maxBranches !== undefined ? { maxBranches: o.maxBranches ?? Infinity } : {}),
      ...(Array.isArray(o.features) ? { features: o.features } : {}),
    };
  }
  cache = { at: Date.now(), plans };
  return plans;
}

export const invalidatePlans = () => { cache = { at: 0, plans: null }; };

/** Trial that has run out, or a cancelled/expired plan, loses paid features. */
export function isSubscriptionLive(sub) {
  if (!sub) return true;   // legacy clinics without a record keep Starter access
  if (sub.status === 'ACTIVE') return true;
  if (sub.status === 'TRIALING') return !sub.trialEndsAt || new Date(sub.trialEndsAt) > new Date();
  if (sub.status === 'PAST_DUE') return true;   // grace period; billing chases it
  return false;
}

/** Everything the server will allow this clinic to do, in one object. */
export async function getEntitlements(clinicId) {
  const [plans, sub] = await Promise.all([getPlans(), Subscription.findOne({ clinicId }).lean()]);
  const plan = plans[sub?.plan || 'STARTER'] || plans.STARTER;
  const live = isSubscriptionLive(sub);
  // A lapsed subscription keeps core booking so patients aren't stranded,
  // but loses every paid feature until it's renewed.
  const features = live ? plan.features : PLANS.STARTER.features;
  return {
    plan: plan.name,
    status: sub?.status || 'ACTIVE',
    live,
    trialEndsAt: sub?.trialEndsAt || null,
    features,
    limits: {
      maxDoctors: Number.isFinite(plan.maxDoctors) ? plan.maxDoctors : null,
      maxBranches: Number.isFinite(plan.maxBranches) ? plan.maxBranches : null,
    },
    has: (f) => features.includes('*') || features.includes(f),
  };
}
