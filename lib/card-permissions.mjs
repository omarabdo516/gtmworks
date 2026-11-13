export function canCreateCard({role}) {
 return ['owner','manager','contributor'].includes(role);
}
