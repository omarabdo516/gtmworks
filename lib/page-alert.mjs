// The line a Company page shows from its address's `message` (#778): the actions that come back to a page name one of the
// product's own messages by its catalogue key, and the page draws that key's string in the reader's language. Anything
// else in the address, a crafted text among it, shows nothing, so a link cannot put words in gtmworks's mouth.
export const pageAlerts = Object.freeze([
  'changeSaved',
  'thisAgentRoleIsAssignedToAnotherActive',
  'theLastOwnerCannotBeRemovedOrHave',
  'couldNotSaveTheChangeCheckPermissionsAnd',
  'couldNotChangeThisAgentsAccess',
  'youCannotMoveTheCardToThisStage',
  'boardNeedsApproval',
  'boardDecideFirst',
]);
const known = new Set(pageAlerts);

// The address's value for a key the page may show, or undefined.
export function pageAlert(value, t) {
  return typeof value === 'string' && known.has(value) ? t(value) : undefined;
}
