function getEffectiveTier(tiers, achievementPct) {
    if (!tiers || tiers.length === 0) return null;

    for (const tier of tiers) {
        if (achievementPct >= tier.from_percent && achievementPct < tier.to_percent) {
            return tier;
        }
    }

    return tiers[tiers.length - 1] || null;
}

function calculateEffectiveRate(baseRate, tierMultiplier) {
    return baseRate * tierMultiplier;
}

function calculateCommissionAmount(collectionAmount, effectiveRate) {
    return Math.round(collectionAmount * effectiveRate / 100 * 100) / 100;
}

module.exports = { getEffectiveTier, calculateEffectiveRate, calculateCommissionAmount };
