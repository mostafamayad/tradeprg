/**
 * Pagination middleware — unified parser for all route pagination.
 *
 * Accepts page/limit query params (regardless of frontend naming convention;
 * routes can rename before passing). Returns clamped values + offset.
 *
 * Defaults: page=1, limit=0 (unpaginated), maxLimit=200
 */
function parsePagination(query, defaults = {}) {
  const defaultLimit = defaults.limit || 50;
  const maxLimit = defaults.maxLimit || 200;
  const page = Math.max(1, parseInt(query.page) || 1);
  let limit = parseInt(query.limit);
  if (isNaN(limit) || limit < 1) limit = 0;
  else limit = Math.min(maxLimit, limit);
  const offset = limit > 0 ? (page - 1) * limit : 0;
  return { page, limit, offset };
}

function buildPaginationResponse(total, { page, limit }) {
  if (limit <= 0) return null;
  return { page, limit, total, pages: Math.ceil(total / limit) };
}

module.exports = { parsePagination, buildPaginationResponse };
