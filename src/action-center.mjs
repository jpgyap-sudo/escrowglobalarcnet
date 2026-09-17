/**
 * Pure, read-only action derivation for the sandbox workspace.
 *
 * This module deliberately does not use Date.now(), storage, fetch, wallet
 * APIs, or command handlers. `now` is injected so the result is deterministic
 * and can be replayed in tests or a future notification service.
 */
export const ACTION_HOUR = 60 * 60 * 1000;
export const ACTION_DAY = 24 * ACTION_HOUR;
const SEVERITY_RANK = { urgent: 0, attention: 1, info: 2 };

const actionId = (order, milestone, actorId, kind) =>
  `${order.id}:${milestone?.id || 'order'}:${actorId}:${kind}`;

function action(order, milestone, actorId, kind, severity, title, body, ctaLabel, deadlineAt) {
  return {
    id: actionId(order, milestone, actorId, kind),
    kind,
    severity,
    title,
    body,
    cta: { label: ctaLabel, route: `#/deal/${encodeURIComponent(order.id)}` },
    deadlineAt: deadlineAt === undefined ? null : deadlineAt,
    orderId: order.id,
    milestoneId: milestone?.id || null,
    sourceStatus: milestone?.status || null
  };
}

function sortActions(items) {
  return items.slice().sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || (a.deadlineAt ?? Infinity) - (b.deadlineAt ?? Infinity)
    || a.id.localeCompare(b.id)
  );
}

function deadlineSeverity(deadlineAt, now, warningWindow = ACTION_DAY) {
  if (deadlineAt <= now) return 'urgent';
  return deadlineAt - now <= warningWindow ? 'urgent' : 'attention';
}

/** Derive actions for one order and one actor. The order is never mutated. */
export function deriveOrderActions(order, actor, now) {
  if (!order || typeof order !== 'object' || !Number.isFinite(now)) return [];
  const actorId = typeof actor === 'string' ? actor : actor?.id;
  const role = typeof actor === 'object' ? actor?.role : undefined;
  if (typeof actorId !== 'string' || !['buyer', 'seller', 'admin'].includes(role)) return [];

  const isBuyer = actorId === order.buyerId && role === 'buyer';
  const isSeller = actorId === order.sellerId && role === 'seller';
  const isReviewer = role === 'admin';
  const result = [];
  const add = (...args) => result.push(action(order, ...args));
  const milestones = Array.isArray(order.milestones) ? order.milestones : [];

  if (order.cancelled) return [action(order, null, actorId, 'agreement_cancelled', 'info', 'Agreement closed', 'This agreement was cancelled before the Action Center could move anything.', 'View agreement')];
  if (!order.acceptedAt) {
    if (isSeller) add(null, actorId, 'accept_agreement', 'attention', 'Review and accept the agreement', 'Check the exact scope, deadlines and fixed destinations before the buyer can fund.', 'Review terms');
    else if (isBuyer) add(null, actorId, 'awaiting_seller_acceptance', 'attention', 'Waiting for seller acceptance', 'Funding stays unavailable until the seller accepts the exact agreement.', 'View agreement');
    return sortActions(result);
  }
  if (!order.fundedAt) {
    if (isBuyer) add(null, actorId, 'fund_agreement', 'attention', 'Fund the agreed plan', 'Review the total and reserve, then fund the milestones in this simulation.', 'Review funding');
    return sortActions(result);
  }

  for (const milestone of milestones) {
    const terminal = ['released', 'refunded', 'settled'].includes(milestone.status);
    if (terminal) continue;
    const disputed = milestone.status === 'disputed';
    const proposal = milestone.proposal;
    if (proposal?.status === 'pending') {
      if (proposal.proposerId === actorId && (isBuyer || isSeller)) add(milestone, actorId, 'proposal_waiting', 'attention', 'Waiting for the other party', 'A bilateral proposal is pending. No funds move until the other original party accepts it.', 'View proposal', proposal.expiresAt);
      else if ((isBuyer || isSeller) && proposal.proposerId !== actorId) add(milestone, actorId, 'review_proposal', 'attention', 'Review a proposed change', 'Check the revised scope, retained principal and deadline before accepting or rejecting.', 'Review proposal', proposal.expiresAt);
    }
    if (disputed) {
      if (isReviewer) add(milestone, actorId, 'review_dispute', 'urgent', 'Review the frozen claim', 'Compare the claim with the original terms, accepted amendments and available evidence. Choose only the restricted outcome.', 'Open resolution');
      else if (isBuyer || isSeller) add(milestone, actorId, 'provide_dispute_evidence', 'attention', 'Prepare dispute evidence', 'Keep each claim tied to a checklist item. The disputed milestone remains frozen.', 'Open evidence');
      continue;
    }
    if (milestone.status === 'funded') {
      const goods = Boolean(order.commerce || order.fulfillment);
      if (goods) {
        if (!order.fulfillment?.shippedAt) {
          if (isSeller) add(milestone, actorId, 'ship_goods', 'attention', 'Ship the goods', 'Funding is recorded. Add the carrier reference and shipping evidence; shipment does not release payment.', 'Open shipment', milestone.dueAt);
          else if (isBuyer) add(milestone, actorId, 'awaiting_shipment', 'info', 'Waiting for shipment', 'The seller must record shipment before you can confirm physical receipt.', 'View delivery', milestone.dueAt);
        } else if (isBuyer && !order.fulfillment.receivedAt) {
          add(milestone, actorId, 'confirm_receipt', 'attention', 'Confirm physical receipt', 'Only confirm that the package arrived. Inspection and payment release remain separate.', 'Confirm receipt');
        } else if (isSeller) {
          add(milestone, actorId, 'awaiting_buyer_review', 'info', 'Waiting for buyer inspection', 'Receipt starts the inspection window; it does not automatically release the milestone.', order.fulfillment?.inspectionEndsAt);
        }
      } else if (isSeller) {
        add(milestone, actorId, 'submit_delivery', 'attention', 'Submit the next delivery', 'Attach delivery notes and an evidence reference that map to the agreed acceptance checklist.', 'Submit delivery', milestone.dueAt);
      } else if (isBuyer) {
        add(milestone, actorId, 'awaiting_delivery', 'info', 'Work is in progress', 'The seller must submit the agreed delivery before review or release is available.', 'View deal', milestone.dueAt);
      }
      const noDelivery = !milestone.deliveries?.length && !(order.fulfillment?.shippedAt);
      if (isBuyer && noDelivery && milestone.dueAt && now > milestone.dueAt + 2 * ACTION_DAY) add(milestone, actorId, 'late_refund_available', 'urgent', 'No-delivery refund may be available', 'The delivery deadline and 48-hour grace period have elapsed. Check the documented refund path.', 'Review refund', milestone.dueAt);
    }
    if (milestone.status === 'submitted') {
      const timed = order.snapshot?.acceptance === 'timed';
      if (isBuyer) {
        const severity = milestone.reviewEndsAt ? deadlineSeverity(milestone.reviewEndsAt, now, 2 * ACTION_DAY) : 'attention';
        add(milestone, actorId, 'review_delivery', severity, 'Review the submitted delivery', 'Compare every acceptance condition with the delivery. Approve, request an included revision, or use the permitted dispute path.', 'Review delivery', milestone.reviewEndsAt);
      } else if (isSeller) add(milestone, actorId, 'awaiting_buyer_review', 'info', 'Waiting for buyer review', 'The delivery is submitted. Keep the agreement checklist and evidence available for review.', milestone.reviewEndsAt);
      if (timed && milestone.reviewEndsAt && now >= milestone.reviewEndsAt && (isBuyer || isSeller)) add(milestone, actorId, 'review_deadline_elapsed', 'urgent', 'Review deadline elapsed', 'A future chain-authoritative execution may be eligible. This sandbox still requires an explicit action.', 'Review release', milestone.reviewEndsAt);
    }
  }
  return sortActions(result);
}

/** Derive a stable, priority-sorted action list for all visible orders. */
export function deriveActionCenter(orders, actor, now) {
  if (!Array.isArray(orders)) return [];
  return sortActions(orders.flatMap(order => deriveOrderActions(order, actor, now)));
}

export const actionSeverityRank = Object.freeze({ ...SEVERITY_RANK });
