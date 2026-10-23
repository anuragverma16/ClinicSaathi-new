import { Subscription } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { getEntitlements } from '../services/plans.service.js';

/** Blocks a route unless the clinic's live plan includes the named feature. */
export const requireFeature = (feature) => async (req, _res, next) => {
  try {
    const ent = await getEntitlements(req.tenant.clinicId);
    if (!ent.has(feature)) {
      const code = ent.live ? 'PLAN_UPGRADE_REQUIRED' : 'SUBSCRIPTION_INACTIVE';
      const message = ent.live
        ? 'Upgrade your plan to use this'
        : 'Your subscription has lapsed. Renew it to use this feature.';
      return next(new ApiError(402, message, code, { feature, currentPlan: ent.plan }));
    }
    req.entitlements = ent;
    next();
  } catch (e) { next(e); }
};

/** Throws 402 if adding one more `kind` would exceed the plan limit. */
export async function assertWithinLimit(clinicId, kind, currentCount) {
  const ent = await getEntitlements(clinicId);
  const limit = kind === 'doctors' ? ent.limits.maxDoctors : ent.limits.maxBranches;
  if (limit !== null && currentCount >= limit) {
    throw new ApiError(402, `Your ${ent.plan.toLowerCase()} plan allows ${limit} ${kind}. Upgrade to add more.`,
      'PLAN_LIMIT_REACHED', { kind, limit, currentPlan: ent.plan });
  }
}

/**
 * Metered usage guard. WhatsApp and AI calls cost real money against a flat
 * monthly fee, so check remaining quota before spending.
 */
export async function checkQuota(clinicId, kind, amount = 1) {
  const sub = await Subscription.findOne({ clinicId });
  if (!sub) return { allowed: true, remaining: Infinity };
  const periodKey = new Date().toISOString().slice(0, 7);
  if (sub.usage.periodKey !== periodKey) {
    sub.usage.periodKey = periodKey;
    sub.usage.whatsappMessages = 0;
    sub.usage.aiTokens = 0;
    await sub.save();
  }
  const used = kind === 'whatsapp' ? sub.usage.whatsappMessages : sub.usage.aiTokens;
  const included = kind === 'whatsapp' ? sub.usage.whatsappIncluded : sub.usage.aiTokensIncluded;
  const remaining = included - used;
  if (remaining < amount && sub.overagePolicy === 'BLOCK') {
    return { allowed: false, remaining, reason: 'QUOTA_EXCEEDED' };
  }
  return { allowed: true, remaining, overage: remaining < amount };
}

export async function recordUsage(clinicId, kind, amount = 1) {
  const field = kind === 'whatsapp' ? 'usage.whatsappMessages' : 'usage.aiTokens';
  await Subscription.updateOne({ clinicId }, { $inc: { [field]: amount } });
}
