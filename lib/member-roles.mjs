// The Member roles as the reference orders and explains them (#185, #187): the Team table puts the Owner first, then
// Manager, Contributor and Viewer; the invite picker explains each with the catalogue key beside it.
/** @type {Record<string,number>} */
const roleRank = { owner: 0, manager: 1, contributor: 2, viewer: 3 };

/** @type {Record<string,string>} */
export const roleDescription = { owner: 'settingsRoleOwnerD', manager: 'settingsRoleManagerD', contributor: 'settingsRoleContributorD', viewer: 'settingsRoleViewerD' };

/** The roles an invitation or an Invite link may give: never Administrator (#185, #950). */
export const inviteRoleKeys = ['manager', 'contributor', 'viewer'];

/**
 * The roles an Owner invites, in the order the reference lists them.
 * @param {(key:string) => string} t
 */
export const inviteRoles = t => inviteRoleKeys.map(key => ({ key, name: t(key), description: t(roleDescription[key]) }));

/**
 * The Team table's order: the Owner first, then Manager, Contributor and Viewer, each by name.
 * @param {any[]} members
 */
export const orderMembers = members => [...members].sort((a, b) => (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9) || (a.people?.name || '').localeCompare(b.people?.name || ''));
