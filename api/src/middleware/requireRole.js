/**
 * requireRole(role) — RBAC middleware
 *
 * Usage:
 *   router.delete('/admin-users/:id', auth, requireRole('superadmin'), handler);
 *
 * Supported roles (most to least privileged): superadmin > admin
 */
const ROLE_RANK = { superadmin: 2, admin: 1 };

function requireRole(minRole) {
  return (req, res, next) => {
    const userRank = ROLE_RANK[req.user && req.user.role] || 0;
    const requiredRank = ROLE_RANK[minRole] || 0;
    if (userRank < requiredRank) {
      return res.status(403).json({
        error: `Forbidden: requires '${minRole}' role or higher`
      });
    }
    next();
  };
}

module.exports = requireRole;
